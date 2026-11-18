import type { NetworkDevice, NetworkInterface, NetworkLink } from "../network/types.js";
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
  sectionList,
  sortWarnings,
  textOf,
  vlanId,
} from "./helpers.js";
import { translatorFail } from "./limits.js";
import type { TranslatorModule, TranslatorResult, TranslatorWarning } from "./types.js";

/**
 * Saved Netdisco API JSON. Device and port field names follow the device and
 * device_port columns the neighbor worker writes (ip, dns, port, remote_ip,
 * remote_port). The public wiki does not include the swagger response schema,
 * so remote_name and a neighbors list with those columns are both accepted.
 * MAC/ARP node tables are not links. Nothing in this file calls Netdisco.
 */

const DEVICE_USED = new Set(["ip", "dns", "name", "model", "vendor", "os", "location", "description", "serial"]);
const PORT_USED = new Set([
  "ip",
  "port",
  "descr",
  "name",
  "speed",
  "vlan",
  "remote_ip",
  "remote_port",
  "remote_id",
  "remote_type",
  "remote_name",
  "is_uplink",
]);
const NEIGHBOR_USED = new Set([
  "ip",
  "port",
  "remote_ip",
  "remote_port",
  "remote_id",
  "remote_name",
  "remote_dns",
  "remote_type",
  "local_ip",
  "local_port",
]);

function rows(warnings: TranslatorWarning[], value: unknown, label: string): unknown[] {
  const section = sectionList(value, [label, "results"]);
  if (!section.present) return [];
  if (section.next) pushWarning(warnings, `/${label}`, `Ignored next page URL on ${label}. NerdGram does not fetch it.`);
  if (section.bad) {
    pushWarning(warnings, `/${label}`, `${label} is not a list.`);
    return [];
  }
  return section.items;
}

function deviceName(row: Record<string, unknown>): string {
  return textOf(row.dns) || textOf(row.name) || hostAddress(row.ip) || textOf(row.ip);
}

function mapDevices(items: unknown[], warnings: TranslatorWarning[]) {
  const devices: NetworkDevice[] = [];
  const byIp = new Map<string, string>();
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/devices/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, DEVICE_USED, "device");
    const name = deviceName(item);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    devices.push(
      blankDevice(name, {
        managementIp: hostAddress(item.ip),
        model: textOf(item.model),
        platform: textOf(item.vendor) || textOf(item.os),
        site: textOf(item.location),
      }),
    );
    const ip = hostAddress(item.ip) || textOf(item.ip);
    if (ip) byIp.set(ip, name);
  });
  return { devices, byIp };
}

function mapPorts(items: unknown[], byIp: Map<string, string>, warnings: TranslatorWarning[]) {
  const interfaces: NetworkInterface[] = [];
  items.forEach((item, index) => {
    const pointer = `/ports/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, PORT_USED, "port");
    const ip = hostAddress(item.ip) || textOf(item.ip);
    const device = byIp.get(ip) ?? "";
    const name = textOf(item.port) || textOf(item.name);
    if (!device || !name) {
      pushWarning(warnings, pointer, "Skipped a port whose device or name could not be resolved.");
      return;
    }
    const speed = numberLike(item.speed);
    const vlan = vlanId(item.vlan);
    interfaces.push(
      blankInterface(device, name, {
        description: textOf(item.descr),
        speed: speed == null ? "" : formatRate(speed, "bps"),
        ...(vlan != null ? { switchportMode: "access", accessVlan: vlan } : {}),
      }),
    );
  });
  return interfaces;
}

function neighborRows(ports: unknown[], neighbors: unknown[]): unknown[] {
  const fromPorts = ports.filter((item) => isRecord(item) && (textOf(item.remote_port) || textOf(item.remote_ip) || textOf(item.remote_name)));
  return neighbors.length > 0 ? neighbors : fromPorts;
}

function mapNeighbors(
  items: unknown[],
  devices: NetworkDevice[],
  byIp: Map<string, string>,
  warnings: TranslatorWarning[],
): NetworkLink[] {
  const links: NetworkLink[] = [];
  items.forEach((item, index) => {
    const pointer = `/neighbors/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, NEIGHBOR_USED, "neighbor");
    const localIp = hostAddress(item.ip) || hostAddress(item.local_ip) || textOf(item.ip) || textOf(item.local_ip);
    const localDevice = byIp.get(localIp) ?? "";
    const localPort = textOf(item.port) || textOf(item.local_port);
    const remoteIp = hostAddress(item.remote_ip) || textOf(item.remote_ip);
    let remoteDevice = byIp.get(remoteIp) ?? "";
    const remotePort = textOf(item.remote_port);
    const remoteLabel = textOf(item.remote_name) || textOf(item.remote_dns);
    if (!remoteDevice && remoteLabel) remoteDevice = ensureDevice(devices, remoteLabel);
    else if (!remoteDevice && remoteIp) remoteDevice = ensureDevice(devices, remoteIp);
    if (!localDevice || !localPort || !remoteDevice || !remotePort) {
      pushWarning(warnings, pointer, "Skipped a neighbor that does not name both devices and ports.");
      return;
    }
    links.push(blankLink(localDevice, localPort, remoteDevice, remotePort));
  });
  return dedupeLinks(links);
}

function convertNetdisco(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A Netdisco export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  if ("nodes" in input) {
    pushWarning(warnings, "/nodes", "Ignored nodes. A MAC or ARP table is not topology.");
  }
  const deviceItems = rows(warnings, input.devices, "devices");
  const portItems = rows(warnings, input.ports, "ports");
  const neighborItems = rows(warnings, input.neighbors ?? input.neighbours, "neighbors");
  const mapped = mapDevices(deviceItems, warnings);
  const interfaces = mapPorts(portItems, mapped.byIp, warnings);
  const links = mapNeighbors(neighborRows(portItems, neighborItems), mapped.devices, mapped.byIp, warnings);
  ensureLinkEnds(mapped.devices, interfaces, links);
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: mapped.devices, interfaces, links, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const netdisco: TranslatorModule = {
  id: "netdisco",
  name: "Netdisco",
  formatHint: "Saved Netdisco API export (devices, ports, neighbors)",
  placeholder: `{
  "devices": [ { "ip": "192.0.2.1", "dns": "core-rtr" } ],
  "ports": [ { "ip": "192.0.2.1", "port": "GigabitEthernet1/0/1" } ],
  "neighbors": []
}`,
  convert: convertNetdisco,
};

export default netdisco;
