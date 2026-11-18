import type { NetworkAddress, NetworkDevice, NetworkInterface, NetworkLink } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  dedupeLinks,
  ensureDevice,
  ensureLinkEnds,
  formatRate,
  hostAddress,
  isRecord,
  noteUnmapped,
  numberLike,
  publishDocument,
  pushWarning,
  sortWarnings,
  splitCidr,
  statusUpDown,
  textOf,
  vlanId,
} from "./helpers.js";
import { translatorFail } from "./limits.js";
import type { TranslatorModule, TranslatorResult, TranslatorWarning } from "./types.js";

/**
 * Saved pyATS testbed JSON or Genie learn output. Credentials are ignored.
 * Interface learn data is an info object keyed by interface name. LLDP and
 * CDP learn data use interfaces / port_id / neighbors. Bandwidth is treated
 * as kilobits per second, which is the IOS bandwidth unit Genie copies.
 * Nothing in this file runs pyATS or connects to a device.
 */

const DEVICE_USED = new Set(["os", "type", "alias", "connections", "credentials", "custom", "platform"]);
const INTERFACE_USED = new Set([
  "oper_status",
  "enabled",
  "description",
  "bandwidth",
  "ipv4",
  "ipv6",
  "vrf",
  "switchport_mode",
  "access_vlan",
  "trunk_vlans",
  "native_vlan",
  "mtu",
  "port_channel",
]);

function connectionIp(connections: unknown): string {
  if (!isRecord(connections)) return "";
  for (const value of Object.values(connections)) {
    if (!isRecord(value)) continue;
    const address = hostAddress(value.ip) || hostAddress(value.host);
    if (address) return address;
    const protocol = isRecord(value.protocol) ? value.protocol : null;
    const nested = protocol ? hostAddress(protocol.ip) || hostAddress(protocol.host) : "";
    if (nested) return nested;
  }
  return "";
}

function addressesOf(value: unknown, family: "ipv4" | "ipv6"): NetworkAddress[] {
  if (!isRecord(value)) return [];
  const out: NetworkAddress[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const cidr = splitCidr(key);
    if (cidr && cidr.family === family) {
      out.push({ address: cidr.address, prefix: cidr.prefix });
      continue;
    }
    if (!isRecord(raw)) continue;
    const address = hostAddress(raw.ip) || hostAddress(raw.address);
    const prefix = numberLike(raw.prefix_length) ?? numberLike(raw.prefix);
    if (address && prefix != null) out.push({ address, prefix });
  }
  return out;
}

function mapInterface(device: string, name: string, row: Record<string, unknown>, warnings: TranslatorWarning[], pointer: string): NetworkInterface {
  noteUnmapped(warnings, pointer, row, INTERFACE_USED, "interface");
  const admin = statusUpDown(row.enabled);
  const oper = statusUpDown(row.oper_status);
  const mode = textOf(row.switchport_mode).toLowerCase();
  const switchportMode = mode === "access" || mode === "trunk" ? mode : "";
  const bandwidth = numberLike(row.bandwidth);
  const vrf = textOf(row.vrf);
  return blankInterface(device, name, {
    description: textOf(row.description),
    adminStatus: admin === "up" || admin === "down" ? admin : "",
    operStatus: oper === "up" || oper === "down" ? oper : "",
    speed: bandwidth == null ? "" : formatRate(bandwidth, "kbps"),
    vrf: vrf && vrf.toLowerCase() !== "default" ? vrf : "",
    ipv4: addressesOf(row.ipv4, "ipv4"),
    ipv6: addressesOf(row.ipv6, "ipv6"),
    switchportMode,
    accessVlan: switchportMode === "access" ? vlanId(row.access_vlan) : null,
    nativeVlan: switchportMode === "trunk" ? vlanId(row.native_vlan) : null,
    trunkVlans: Array.isArray(row.trunk_vlans)
      ? row.trunk_vlans.map((item) => vlanId(item)).filter((item): item is number => item != null)
      : null,
  });
}

function learnInfo(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.info)) return value.info;
  return value;
}

function addNeighbors(
  feature: unknown,
  localDevice: string,
  devices: NetworkDevice[],
  links: NetworkLink[],
  warnings: TranslatorWarning[],
  pointer: string,
) {
  const info = learnInfo(feature);
  const interfaces = info && isRecord(info.interfaces) ? info.interfaces : null;
  if (!interfaces) {
    if (feature != null) pushWarning(warnings, pointer, "Neighbor learn output has no interfaces object.");
    return;
  }
  for (const [localName, raw] of Object.entries(interfaces)) {
    if (!isRecord(raw) || localName === "total_entries") continue;
    if (isRecord(raw.port_id)) {
      for (const [remotePort, portRaw] of Object.entries(raw.port_id)) {
        if (!isRecord(portRaw) || !isRecord(portRaw.neighbors)) continue;
        for (const remoteName of Object.keys(portRaw.neighbors)) {
          const remote = remoteName.trim();
          const port = remotePort.trim();
          if (!remote || !port) continue;
          links.push(blankLink(localDevice, localName, ensureDevice(devices, remote), port));
        }
      }
      continue;
    }
    if (!isRecord(raw.neighbors)) continue;
    for (const [remoteName, neighbor] of Object.entries(raw.neighbors)) {
      const port = isRecord(neighbor) ? textOf(neighbor.port_id) || textOf(neighbor.port) : "";
      const remote = remoteName.trim();
      if (!remote || !port) {
        pushWarning(warnings, pointer, `Skipped a neighbor on ${localName} with no remote port.`);
        continue;
      }
      links.push(blankLink(localDevice, localName, ensureDevice(devices, remote), port));
    }
  }
}

function mapTestbed(devicesMap: Record<string, unknown>, warnings: TranslatorWarning[]) {
  const devices: NetworkDevice[] = [];
  let sawCredentials = false;
  for (const [name, raw] of Object.entries(devicesMap)) {
    if (!isRecord(raw)) continue;
    noteUnmapped(warnings, `/devices/${name}`, raw, DEVICE_USED, "testbed device");
    if ("credentials" in raw) sawCredentials = true;
    devices.push(
      blankDevice(name, {
        platform: textOf(raw.os) || textOf(raw.type),
        managementIp: connectionIp(raw.connections),
      }),
    );
  }
  return { devices, sawCredentials };
}

function looksLikeTestbed(devices: Record<string, unknown>): boolean {
  return Object.values(devices).some((item) => isRecord(item) && ("connections" in item || "os" in item || "credentials" in item));
}

function looksLikeLearn(devices: Record<string, unknown>): boolean {
  return Object.values(devices).some(
    (item) => isRecord(item) && ("interface" in item || "lldp" in item || "cdp" in item || "info" in item),
  );
}

function convertPyats(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A pyATS export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const devices: NetworkDevice[] = [];
  const interfaces: NetworkInterface[] = [];
  const links: NetworkLink[] = [];
  let sawCredentials = "credentials" in input || (isRecord(input.testbed) && "credentials" in input.testbed);

  const nestedTestbed = isRecord(input.testbed) && isRecord(input.testbed.devices) ? input.testbed.devices : null;
  const topDevices = isRecord(input.devices) ? input.devices : null;
  const testbed = nestedTestbed ?? (topDevices && looksLikeTestbed(topDevices) ? topDevices : null);
  const learnRoot = isRecord(input.learn)
    ? input.learn
    : topDevices && looksLikeLearn(topDevices) && !looksLikeTestbed(topDevices)
      ? topDevices
      : null;
  const singleInfo = isRecord(input.info) ? input : null;

  if (testbed) {
    const mapped = mapTestbed(testbed, warnings);
    devices.push(...mapped.devices);
    sawCredentials = sawCredentials || mapped.sawCredentials;
  }

  const learnDevices = learnRoot && isRecord(learnRoot.devices) ? learnRoot.devices : learnRoot;
  if (isRecord(learnDevices)) {
    for (const [name, raw] of Object.entries(learnDevices)) {
      if (!isRecord(raw)) continue;
      if (!devices.some((device) => device.name.toLowerCase() === name.toLowerCase())) devices.push(blankDevice(name));
      const info = isRecord(raw.interface) ? learnInfo(raw.interface) : isRecord(raw.info) ? raw.info : null;
      if (info) {
        for (const [iface, row] of Object.entries(info)) {
          if (!isRecord(row)) continue;
          interfaces.push(mapInterface(name, iface, row, warnings, `/learn/${name}/${iface}`));
        }
      }
      addNeighbors(raw.lldp, name, devices, links, warnings, `/learn/${name}/lldp`);
      addNeighbors(raw.cdp, name, devices, links, warnings, `/learn/${name}/cdp`);
    }
  }

  if (singleInfo && devices.length === 0) {
    const name = textOf(input.device) || textOf(input.name) || "device";
    devices.push(blankDevice(name));
    const info = learnInfo(input);
    if (info) {
      for (const [iface, row] of Object.entries(info)) {
        if (!isRecord(row) || iface === "device") continue;
        interfaces.push(mapInterface(name, iface, row, warnings, `/info/${iface}`));
      }
    }
  }

  if (sawCredentials) pushWarning(warnings, "", "Ignored credentials in this export. They were not copied.");
  const unique = dedupeLinks(links);
  ensureLinkEnds(devices, interfaces, unique);
  if (unique.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices, interfaces, links: unique, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const pyats: TranslatorModule = {
  id: "pyats",
  name: "Cisco pyATS",
  formatHint: "Saved pyATS testbed or Genie learn JSON",
  placeholder: `{
  "devices": {
    "core-rtr": { "os": "iosxe", "type": "router", "connections": { "cli": { "ip": "192.0.2.1" } } }
  }
}`,
  convert: convertPyats,
};

export default pyats;
