import type { NetworkAddress, NetworkDevice, NetworkInterface, NetworkLink } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  dedupeLinks,
  formatRate,
  hostAddress,
  idKey,
  isRecord,
  noteUnmapped,
  plural,
  publishDocument,
  pushWarning,
  sectionList,
  sortWarnings,
  splitCidr,
  statusUpDown,
  textOf,
  vlanId,
} from "./helpers.js";
import { translatorFail } from "./limits.js";
import type { TranslatorModule, TranslatorResult, TranslatorWarning } from "./types.js";

/**
 * Saved LibreNMS API JSON. Device name is `hostname`, then `sysName`, then
 * `display`. `managementIp` is the device `ip` field when that value is an
 * address. The device list example truncates the object; add-device documents
 * `$ip` as that address. `ifSpeed` is bits per second (`"10000000000"` is 10G).
 * `ifHighSpeed` is megabits per second and is used only when `ifSpeed` is
 * missing or 0. `ifAdminStatus` and `ifOperStatus` are `up` or `down` in the
 * ports example. Numeric 1 and 2 are accepted from older rows.
 * Nothing in this file calls LibreNMS.
 */

const DEVICE_USED = new Set(["device_id", "hostname", "sysName", "display", "hardware", "os", "location", "ip"]);
const PORT_USED = new Set([
  "port_id",
  "device_id",
  "ifName",
  "ifAlias",
  "ifDescr",
  "ifSpeed",
  "ifHighSpeed",
  "ifAdminStatus",
  "ifOperStatus",
  "vlans",
  "ifVrf",
  "addresses",
  "ips",
]);
const LINK_USED = new Set([
  "id",
  "local_port_id",
  "local_device_id",
  "remote_port_id",
  "remote_device_id",
  "remote_hostname",
  "remote_port",
  "remote_platform",
  "active",
]);
const IP_USED = new Set(["port_id", "ipv4_address", "ipv4_prefixlen", "ipv6_address", "ipv6_prefixlen", "ipv6_compressed", "address"]);

type PortRef = { device: string; name: string };
type AddressRow = { portId: string; address: NetworkAddress };

function locationOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  return textOf(value.name) || textOf(value.location);
}

function readNamed(warnings: TranslatorWarning[], root: Record<string, unknown>, key: string, inner: string[]): unknown[] | null {
  if (!(key in root)) return null;
  const section = sectionList(root[key], [key, ...inner, "results"]);
  if (section.next) pushWarning(warnings, `/${key}`, `Ignored next page URL on ${key}. NerdGram does not fetch it.`);
  if (section.bad) {
    pushWarning(warnings, `/${key}`, `${key} is not a list or a LibreNMS ${key} envelope.`);
    return [];
  }
  return section.items;
}

function mapDevices(items: unknown[], warnings: TranslatorWarning[]): { devices: NetworkDevice[]; ids: Map<string, string> } {
  const devices: NetworkDevice[] = [];
  const ids = new Map<string, string>();
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/devices/${index}`;
    if (!isRecord(item)) {
      pushWarning(warnings, pointer, "Skipped a device that is not an object.");
      return;
    }
    noteUnmapped(warnings, pointer, item, DEVICE_USED, "device");
    const hostname = textOf(item.hostname);
    const sysName = textOf(item.sysName);
    const display = textOf(item.display);
    const name = hostname || sysName || display;
    if (!name) {
      pushWarning(warnings, pointer, "Skipped a device with no hostname.");
      return;
    }
    if (!hostname && sysName) pushWarning(warnings, pointer, `Device ${item.device_id ?? index + 1} has no hostname, so sysName was used.`);
    else if (!hostname && !sysName && display) pushWarning(warnings, pointer, `Device ${item.device_id ?? index + 1} has no hostname, so display was used.`);
    if (seen.has(name.toLowerCase())) {
      pushWarning(warnings, pointer, `Duplicate device "${name}" was skipped.`);
      return;
    }
    seen.add(name.toLowerCase());
    const ip = hostAddress(item.ip);
    if (textOf(item.ip) && !ip) pushWarning(warnings, `${pointer}/ip`, `Device ${name} ip is not an IP address, so managementIp was left empty.`);
    devices.push(
      blankDevice(name, {
        model: textOf(item.hardware),
        platform: textOf(item.os),
        site: locationOf(item.location),
        managementIp: ip,
      }),
    );
    const id = idKey(item.device_id);
    if (id) ids.set(id, name);
  });
  return { devices, ids };
}

function portSpeed(item: Record<string, unknown>, warnings: TranslatorWarning[], pointer: string, label: string): string {
  const speed = item.ifSpeed;
  const parsed = speed == null || speed === "" ? null : typeof speed === "number" ? speed : Number(textOf(speed));
  if (parsed != null && Number.isFinite(parsed) && parsed > 0) return formatRate(parsed, "bps");
  if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
    pushWarning(warnings, `${pointer}/ifSpeed`, `Port ${label} ifSpeed is not a number, so speed was left empty.`);
    return "";
  }
  const high = item.ifHighSpeed;
  const mbps = high == null || high === "" ? null : typeof high === "number" ? high : Number(textOf(high));
  if (mbps != null && Number.isFinite(mbps) && mbps > 0) return formatRate(mbps * 1_000_000, "bps");
  return "";
}

function portStatus(value: unknown, warnings: TranslatorWarning[], pointer: string, label: string, field: "ifAdminStatus" | "ifOperStatus"): "" | "up" | "down" {
  const status = statusUpDown(value);
  if (status === "other") {
    pushWarning(warnings, `${pointer}/${field}`, `Port ${label} ${field} "${String(value)}" is not up or down, so it was left empty.`);
    return "";
  }
  return status;
}

function vrfOf(value: unknown, warnings: TranslatorWarning[], pointer: string): string {
  if (value == null || value === "" || value === 0 || value === "0") return "";
  const text = textOf(value);
  if (!text) return "";
  if (/^\d+$/.test(text)) {
    pushWarning(warnings, `${pointer}/ifVrf`, "Port ifVrf is an id, not a name, so vrf was left empty.");
    return "";
  }
  return text;
}

function vlansOf(value: unknown, warnings: TranslatorWarning[], pointer: string, label: string): { mode: "" | "access" | "trunk"; access: number | null; native: number | null; trunk: number[] | null } {
  const empty = { mode: "" as const, access: null, native: null, trunk: null };
  if (value == null) return empty;
  if (!Array.isArray(value)) {
    pushWarning(warnings, `${pointer}/vlans`, `Port ${label} vlans is not a list, so switchport mode was left empty.`);
    return empty;
  }
  const untagged: number[] = [];
  const tagged: number[] = [];
  let unclear = false;
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = vlanId(item.vlan);
    if (id == null) continue;
    const flag = item.untagged;
    const isUntagged = flag === 1 || flag === "1" || flag === true;
    const isTagged = flag === 0 || flag === "0" || flag === false;
    if (isUntagged) untagged.push(id);
    else if (isTagged) tagged.push(id);
    else unclear = true;
  }
  if (tagged.length > 0) {
    return { mode: "trunk", access: null, native: untagged.length === 1 ? untagged[0]! : null, trunk: tagged };
  }
  if (untagged.length === 1 && !unclear) return { mode: "access", access: untagged[0]!, native: null, trunk: null };
  if (untagged.length > 0 || unclear) {
    pushWarning(warnings, `${pointer}/vlans`, `Port ${label} VLAN rows do not set a switchport mode, so switchport mode was left empty.`);
  }
  return empty;
}

function mapPorts(items: unknown[], deviceIds: Map<string, string>, warnings: TranslatorWarning[]): { interfaces: NetworkInterface[]; byId: Map<string, PortRef>; addresses: AddressRow[] } {
  const interfaces: NetworkInterface[] = [];
  const byId = new Map<string, PortRef>();
  const addresses: AddressRow[] = [];
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/ports/${index}`;
    if (!isRecord(item)) {
      pushWarning(warnings, pointer, "Skipped a port that is not an object.");
      return;
    }
    noteUnmapped(warnings, pointer, item, PORT_USED, "port");
    const name = textOf(item.ifName);
    const device = deviceIds.get(idKey(item.device_id)) ?? "";
    if (!device || !name) {
      pushWarning(warnings, pointer, `Skipped port ${name || idKey(item.port_id) || String(index + 1)} because its device is not in this export.`);
      return;
    }
    const pair = `${device.toLowerCase()}\0${name}`;
    if (seen.has(pair)) {
      pushWarning(warnings, pointer, `Duplicate interface ${device} ${name} was skipped.`);
      return;
    }
    seen.add(pair);
    const label = `${device} ${name}`;
    const vlans = vlansOf(item.vlans, warnings, pointer, label);
    interfaces.push(
      blankInterface(device, name, {
        description: textOf(item.ifAlias) || textOf(item.ifDescr),
        speed: portSpeed(item, warnings, pointer, label),
        adminStatus: portStatus(item.ifAdminStatus, warnings, pointer, label, "ifAdminStatus"),
        operStatus: portStatus(item.ifOperStatus, warnings, pointer, label, "ifOperStatus"),
        vrf: vrfOf(item.ifVrf, warnings, pointer),
        switchportMode: vlans.mode,
        accessVlan: vlans.access,
        nativeVlan: vlans.native,
        trunkVlans: vlans.trunk,
      }),
    );
    const id = idKey(item.port_id);
    if (id) byId.set(id, { device, name });
    const nested = Array.isArray(item.addresses) ? item.addresses : Array.isArray(item.ips) ? item.ips : [];
    for (const row of nested) addresses.push(...readAddressRow(row, id));
  });
  return { interfaces, byId, addresses };
}

function readAddressRow(item: unknown, fallbackPort: string): AddressRow[] {
  if (!isRecord(item)) return [];
  const portId = idKey(item.port_id) || fallbackPort;
  const rows: AddressRow[] = [];
  const v4 = addressFrom(textOf(item.ipv4_address), item.ipv4_prefixlen);
  const v6text = textOf(item.ipv6_address) || textOf(item.ipv6_compressed);
  const v6 = addressFrom(v6text, item.ipv6_prefixlen);
  const generic = splitCidr(textOf(item.address));
  if (v4) rows.push({ portId, address: v4 });
  if (v6) rows.push({ portId, address: v6 });
  if (!v4 && !v6 && generic) rows.push({ portId, address: generic });
  return rows;
}

function addressFrom(address: string, prefixValue: unknown): NetworkAddress | null {
  if (!address) return null;
  const cidr = splitCidr(address.includes("/") ? address : "");
  if (cidr) return { address: cidr.address, prefix: cidr.prefix };
  const prefix = typeof prefixValue === "number" ? prefixValue : Number(textOf(prefixValue));
  if (!Number.isInteger(prefix)) return null;
  const family = address.includes(":") ? "ipv6" : "ipv4";
  const canonical = hostAddress(address);
  if (!canonical) return null;
  const max = family === "ipv4" ? 32 : 128;
  if (prefix < 0 || prefix > max) return null;
  return { address: canonical, prefix };
}

function assignAddresses(rows: AddressRow[], interfaces: NetworkInterface[], byId: Map<string, PortRef>, warnings: TranslatorWarning[]): void {
  const byPair = new Map(interfaces.map((item) => [`${item.device.toLowerCase()}\0${item.name}`, item]));
  let skipped = 0;
  for (const row of rows) {
    const ref = byId.get(row.portId);
    const iface = ref ? byPair.get(`${ref.device.toLowerCase()}\0${ref.name}`) : undefined;
    if (!iface) {
      skipped += 1;
      continue;
    }
    const list = row.address.address.includes(":") ? iface.ipv6 : iface.ipv4;
    if (!list.some((item) => item.address === row.address.address && item.prefix === row.address.prefix)) list.push(row.address);
  }
  if (skipped > 0) pushWarning(warnings, "/ips", `Ignored ${plural(skipped, "port address")} that ${skipped === 1 ? "does" : "do"} not match a port in this export.`);
}

function isInactive(value: unknown): boolean {
  return value === false || value === 0 || value === "0" || (typeof value === "string" && value.trim().toLowerCase() === "false");
}

function ensureDevice(devices: NetworkDevice[], name: string, platform: string): string {
  const found = devices.find((device) => device.name.toLowerCase() === name.toLowerCase());
  if (found) return found.name;
  devices.push(blankDevice(name, { platform }));
  return name;
}

function mapLinks(
  items: unknown[],
  devices: NetworkDevice[],
  deviceIds: Map<string, string>,
  ports: Map<string, PortRef>,
  warnings: TranslatorWarning[],
): NetworkLink[] {
  const links: NetworkLink[] = [];
  let inactive = 0;
  items.forEach((item, index) => {
    const pointer = `/links/${index}`;
    if (!isRecord(item)) {
      pushWarning(warnings, pointer, "Skipped a link that is not an object.");
      return;
    }
    noteUnmapped(warnings, pointer, item, LINK_USED, "link");
    if (isInactive(item.active)) {
      inactive += 1;
      return;
    }
    const local = ports.get(idKey(item.local_port_id));
    const localDevice = deviceIds.get(idKey(item.local_device_id)) ?? local?.device ?? "";
    const localName = local?.name ?? "";
    if (!localDevice || !localName) {
      pushWarning(warnings, pointer, `Link ${idKey(item.id) || index + 1} has no local port in this export, so it was skipped.`);
      return;
    }
    const remoteId = idKey(item.remote_device_id);
    const remoteKnown = remoteId ? deviceIds.get(remoteId) : "";
    const remotePort = ports.get(idKey(item.remote_port_id));
    const remoteName = textOf(item.remote_hostname);
    let remoteDevice = remoteKnown || remotePort?.device || "";
    let remoteInterface = remotePort?.name || textOf(item.remote_port);
    if (!remoteDevice && remoteName && remoteInterface) {
      remoteDevice = ensureDevice(devices, remoteName, textOf(item.remote_platform));
    }
    if (remoteKnown && remotePort?.device && remotePort.device.toLowerCase() !== remoteKnown.toLowerCase()) {
      remoteInterface = textOf(item.remote_port) || remotePort.name;
    }
    if (!remoteDevice || !remoteInterface) {
      pushWarning(warnings, pointer, `Link ${idKey(item.id) || index + 1} has no remote device in this export, so it was skipped.`);
      return;
    }
    links.push(blankLink(localDevice, localName, remoteDevice, remoteInterface));
  });
  if (inactive > 0) pushWarning(warnings, "/links", `Ignored ${plural(inactive, "inactive link")}.`);
  return dedupeLinks(links);
}

function addPlaceholderInterfaces(devices: NetworkDevice[], interfaces: NetworkInterface[], links: NetworkLink[]): void {
  const known = new Set(interfaces.map((item) => `${item.device.toLowerCase()}\0${item.name}`));
  const deviceNames = new Set(devices.map((device) => device.name.toLowerCase()));
  for (const link of links) {
    for (const end of [link.a, link.b]) {
      if (!deviceNames.has(end.device.toLowerCase())) continue;
      const key = `${end.device.toLowerCase()}\0${end.interface}`;
      if (known.has(key)) continue;
      interfaces.push(blankInterface(end.device, end.interface));
      known.add(key);
    }
  }
}

function collectAddresses(root: Record<string, unknown>, nested: AddressRow[], warnings: TranslatorWarning[]): AddressRow[] {
  const rows = [...nested];
  const section = readNamed(warnings, root, "ips", ["addresses", "ips"]) ?? readNamed(warnings, root, "addresses", ["addresses"]);
  if (!section) return rows;
  section.forEach((item) => {
    if (isRecord(item)) noteUnmapped(warnings, "/ips", item, IP_USED, "port address");
    rows.push(...readAddressRow(item, ""));
  });
  return rows;
}

function convertLibreNms(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A LibreNMS export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const deviceItems = readNamed(warnings, input, "devices", ["devices"]) ?? [];
  const portItems = readNamed(warnings, input, "ports", ["ports", "port"]) ?? [];
  const linkItems = readNamed(warnings, input, "links", ["links"]) ?? [];
  const mappedDevices = mapDevices(deviceItems, warnings);
  const mappedPorts = mapPorts(portItems, mappedDevices.ids, warnings);
  const addresses = collectAddresses(input, mappedPorts.addresses, warnings);
  assignAddresses(addresses, mappedPorts.interfaces, mappedPorts.byId, warnings);
  const links = mapLinks(linkItems, mappedDevices.devices, mappedDevices.ids, mappedPorts.byId, warnings);
  addPlaceholderInterfaces(mappedDevices.devices, mappedPorts.interfaces, links);
  if (mappedDevices.devices.length > 0 && mappedPorts.interfaces.length === 0 && links.length === 0) {
    pushWarning(warnings, "", "No interfaces in this export.");
  }
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: mappedDevices.devices, interfaces: mappedPorts.interfaces, links, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const librenms: TranslatorModule = {
  id: "librenms",
  name: "LibreNMS",
  formatHint: "Saved LibreNMS API export (devices, ports, links)",
  placeholder: `{
  "devices": { "status": "ok", "devices": [ { "hostname": "core-rtr" } ] },
  "ports": { "status": "ok", "ports": [] },
  "links": { "status": "ok", "links": [] }
}`,
  convert: convertLibreNms,
};

export default librenms;
