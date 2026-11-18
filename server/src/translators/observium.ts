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
  idKey,
  isRecord,
  noteUnmapped,
  numberLike,
  publishDocument,
  pushWarning,
  sectionList,
  sortWarnings,
  splitCidr,
  textOf,
  vlanId,
} from "./helpers.js";
import { translatorFail } from "./limits.js";
import type { TranslatorModule, TranslatorResult, TranslatorWarning } from "./types.js";

/**
 * Saved Observium /api/v0/ JSON. The device list example is an object keyed
 * by id under devices, not only an array. Neighbour response keys are the
 * documented filters plus remote_hostname / remote_port, which the API page
 * does not spell out on each row. Nothing in this file calls Observium.
 */

const DEVICE_USED = new Set([
  "device_id",
  "hostname",
  "sysName",
  "hardware",
  "os",
  "location",
  "location_text",
  "vendor",
  "version",
  "type",
  "ip",
  "address",
  "ipv4_address",
  "sysObjectID",
  "sysDescr",
  "features",
  "status",
]);
const PORT_USED = new Set([
  "port_id",
  "device_id",
  "ifName",
  "port_short_label",
  "ifDescr",
  "port_label",
  "ifAlias",
  "ifSpeed",
  "ifVlan",
  "ifType",
  "hostname",
]);
const NEIGHBOUR_USED = new Set([
  "neighbour_id",
  "neighbor_id",
  "device_id",
  "port_id",
  "device_b",
  "port_b",
  "remote_port_id",
  "remote_hostname",
  "remote_port",
  "protocol",
  "platform",
  "version",
  "active",
]);
const ADDRESS_USED = new Set(["address_id", "af", "device_id", "port_id", "vrf", "address", "prefix", "prefixlen"]);

function objectRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const values = Object.values(value);
  if (values.length > 0 && values.every((item) => isRecord(item))) return values;
  return [];
}

function rows(warnings: TranslatorWarning[], value: unknown, label: string, keys: readonly string[]): unknown[] {
  if (value == null) return [];
  const section = sectionList(value, ["results", ...keys]);
  if (section.present && !section.bad) {
    if (section.next) pushWarning(warnings, `/${label}`, `Ignored next page URL on ${label}. NerdGram does not fetch it.`);
    if (section.items.length > 0) return section.items;
  }
  if (isRecord(value)) {
    for (const key of keys) {
      const nested = objectRows(value[key]);
      if (nested.length > 0) return nested;
    }
    const itself = objectRows(value);
    if (itself.length > 0 && !("status" in value)) return itself;
  }
  if (section.bad) pushWarning(warnings, `/${label}`, `${label} is not a list or an Observium envelope.`);
  return [];
}

function inactive(value: unknown): boolean {
  if (value === 0 || value === false) return true;
  const text = textOf(value).toLowerCase();
  return text === "0" || text === "false" || text === "no";
}

function mapDevices(items: unknown[], warnings: TranslatorWarning[]) {
  const devices: NetworkDevice[] = [];
  const ids = new Map<string, string>();
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/devices/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, DEVICE_USED, "device");
    let name = textOf(item.hostname);
    if (!name) {
      name = textOf(item.sysName);
      if (name) pushWarning(warnings, pointer, `Device name fell back to sysName "${name}" because hostname was empty.`);
    }
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const address = hostAddress(item.ip) || hostAddress(item.ipv4_address) || hostAddress(item.address);
    devices.push(
      blankDevice(name, {
        model: textOf(item.hardware),
        platform: textOf(item.os),
        site: textOf(item.location) || textOf(item.location_text),
        managementIp: address,
      }),
    );
    const id = idKey(item.device_id);
    if (id) ids.set(id, name);
  });
  return { devices, ids };
}

function portName(row: Record<string, unknown>): string {
  return textOf(row.ifName) || textOf(row.port_short_label) || textOf(row.ifDescr) || textOf(row.port_label);
}

function mapPorts(items: unknown[], deviceIds: Map<string, string>, warnings: TranslatorWarning[]) {
  const interfaces: NetworkInterface[] = [];
  const byId = new Map<string, { device: string; name: string }>();
  items.forEach((item, index) => {
    const pointer = `/ports/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, PORT_USED, "port");
    const device = deviceIds.get(idKey(item.device_id)) ?? "";
    const name = portName(item);
    if (!device || !name) {
      pushWarning(warnings, pointer, "Skipped a port whose device or name could not be resolved.");
      return;
    }
    const speed = numberLike(item.ifSpeed);
    const vlan = vlanId(item.ifVlan);
    interfaces.push(
      blankInterface(device, name, {
        description: textOf(item.ifAlias),
        speed: speed == null ? "" : formatRate(speed, "bps"),
        ...(vlan != null ? { switchportMode: "access", accessVlan: vlan } : {}),
      }),
    );
    const id = idKey(item.port_id);
    if (id) byId.set(id, { device, name });
  });
  return { interfaces, byId };
}

function assignAddresses(
  items: unknown[],
  interfaces: NetworkInterface[],
  ports: Map<string, { device: string; name: string }>,
  warnings: TranslatorWarning[],
) {
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    noteUnmapped(warnings, `/address/${index}`, item, ADDRESS_USED, "address");
    const port = ports.get(idKey(item.port_id));
    if (!port) return;
    const raw = textOf(item.address);
    const cidr = splitCidr(raw.includes("/") ? raw : "");
    const prefix = numberLike(item.prefix) ?? numberLike(item.prefixlen);
    const host = cidr?.address || hostAddress(raw);
    const length = cidr?.prefix ?? prefix;
    if (!host || length == null) return;
    const family = host.includes(":") || textOf(item.af).toLowerCase() === "ipv6" ? "ipv6" : "ipv4";
    const row = interfaces.find((entry) => entry.device === port.device && entry.name === port.name);
    if (!row) return;
    const stored: NetworkAddress = { address: host, prefix: length };
    const list = family === "ipv4" ? row.ipv4 : row.ipv6;
    list.push(stored);
  });
}

function mapNeighbours(
  items: unknown[],
  devices: NetworkDevice[],
  deviceIds: Map<string, string>,
  ports: Map<string, { device: string; name: string }>,
  warnings: TranslatorWarning[],
): NetworkLink[] {
  const links: NetworkLink[] = [];
  items.forEach((item, index) => {
    const pointer = `/neighbours/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, NEIGHBOUR_USED, "neighbour");
    if (inactive(item.active)) {
      pushWarning(warnings, pointer, "Skipped an inactive neighbour.");
      return;
    }
    const local = ports.get(idKey(item.port_id));
    const localDevice = local?.device || deviceIds.get(idKey(item.device_id)) || "";
    const localName = local?.name || "";
    if (!localDevice || !localName) {
      pushWarning(warnings, pointer, "Skipped a neighbour whose local port is not in this export.");
      return;
    }
    const remotePort = ports.get(idKey(item.remote_port_id)) ?? ports.get(idKey(item.port_b));
    let remoteDevice = remotePort?.device || deviceIds.get(idKey(item.device_b)) || "";
    let remoteName = remotePort?.name || textOf(item.port_b) || textOf(item.remote_port);
    const remoteHost = textOf(item.remote_hostname) || textOf(item.device_b);
    if (!remoteDevice && remoteHost && !/^\d+$/.test(remoteHost)) {
      remoteDevice = ensureDevice(devices, remoteHost, { platform: textOf(item.platform) });
    }
    if (!remoteName && remotePort) remoteName = remotePort.name;
    if (!remoteDevice || !remoteName) {
      pushWarning(warnings, pointer, "Skipped a neighbour whose remote device or port could not be resolved.");
      return;
    }
    links.push(blankLink(localDevice, localName, remoteDevice, remoteName));
  });
  return dedupeLinks(links);
}

function convertObservium(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "An Observium export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const deviceItems = rows(warnings, input.devices, "devices", ["devices"]);
  const portItems = rows(warnings, input.ports, "ports", ["ports"]);
  const neighbourItems = rows(warnings, input.neighbours ?? input.neighbors, "neighbours", ["neighbours", "neighbors"]);
  const addressItems = rows(warnings, input.address ?? input.addresses, "address", ["addresses", "address"]);
  const mapped = mapDevices(deviceItems, warnings);
  const ports = mapPorts(portItems, mapped.ids, warnings);
  assignAddresses(addressItems, ports.interfaces, ports.byId, warnings);
  const links = mapNeighbours(neighbourItems, mapped.devices, mapped.ids, ports.byId, warnings);
  ensureLinkEnds(mapped.devices, ports.interfaces, links);
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: mapped.devices, interfaces: ports.interfaces, links, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const observium: TranslatorModule = {
  id: "observium",
  name: "Observium",
  formatHint: "Saved Observium API export (devices, ports, neighbours)",
  placeholder: `{
  "devices": { "status": "ok", "devices": { "1": { "hostname": "core-rtr", "os": "ios" } } },
  "ports": { "status": "ok", "ports": [] },
  "neighbours": { "status": "ok", "neighbours": [] }
}`,
  convert: convertObservium,
};

export default observium;
