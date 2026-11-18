import type { NetworkAddress, NetworkDevice, NetworkInterface, NetworkLink, NetworkVlan } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  dedupeLinks,
  ensureDevice,
  ensureLinkEnds,
  formatRate,
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
 * Saved Batfish question JSON plus an optional layer1 topology object.
 * Interface cells are { hostname, interface } or "hostname[interface]".
 * A layer-3 edge with no matching layer-1 edge is inferred. Nothing in
 * this file runs Batfish or reads a device config.
 */

const IFACE_USED = new Set([
  "Interface",
  "Access_VLAN",
  "Active",
  "Admin_Up",
  "All_Prefixes",
  "Allowed_VLANs",
  "Bandwidth",
  "Description",
  "Native_VLAN",
  "Primary_Address",
  "Switchport_Mode",
  "VRF",
]);
const EDGE_USED = new Set(["Interface", "IPs", "Remote_Interface", "Remote_IPs"]);
const VLAN_USED = new Set(["Node", "VLAN_ID", "Interfaces", "Name", "VLAN_Name"]);
const L1_USED = new Set(["node1", "node2"]);

type End = { host: string; iface: string };

function recordsOf(value: unknown): Record<string, unknown>[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.rows)) return value.rows.filter(isRecord);
  if (Array.isArray(value.answerElements)) {
    return value.answerElements.flatMap((element) => (isRecord(element) && Array.isArray(element.rows) ? element.rows.filter(isRecord) : []));
  }
  if (Array.isArray(value.columns) && Array.isArray(value.data)) {
    const columns = value.columns.map((item) => textOf(item));
    return value.data
      .filter(Array.isArray)
      .map((row) => {
        const record: Record<string, unknown> = {};
        columns.forEach((column, index) => {
          record[column] = (row as unknown[])[index];
        });
        return record;
      });
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return [];
  const columns = keys.filter((key) => Array.isArray(value[key]) || (isRecord(value[key]) && !Array.isArray(value[key])));
  if (columns.length === 0) return [value];
  const indexes = new Set<string>();
  for (const key of columns) {
    const column = value[key];
    if (Array.isArray(column)) column.forEach((_, index) => indexes.add(String(index)));
    else if (isRecord(column)) Object.keys(column).forEach((index) => indexes.add(index));
  }
  const rows: Record<string, unknown>[] = [];
  for (const index of [...indexes].sort((a, b) => Number(a) - Number(b))) {
    const row: Record<string, unknown> = {};
    for (const key of columns) {
      const column = value[key];
      if (Array.isArray(column)) row[key] = column[Number(index)];
      else if (isRecord(column)) row[key] = column[index];
    }
    rows.push(row);
  }
  return rows.length > 0 ? rows : [value];
}

function section(input: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in input) return input[key];
  }
  return null;
}

function endOf(value: unknown): End | null {
  if (isRecord(value)) {
    const host = textOf(value.hostname);
    const iface = textOf(value.interface) || textOf(value.interfaceName);
    if (host && iface) return { host, iface };
  }
  const text = textOf(value);
  const match = /^(.+)\[(.+)]$/.exec(text);
  if (!match?.[1] || !match[2]) return null;
  return { host: match[1], iface: match[2] };
}

function endKey(end: End): string {
  return `${end.host.toLowerCase()}\0${end.iface}`;
}

function pairKey(a: End, b: End): string {
  const left = endKey(a);
  const right = endKey(b);
  return left < right ? `${left}\0${right}` : `${right}\0${left}`;
}

function prefixes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean);
  const text = textOf(value);
  return text ? [text] : [];
}

function parseVlans(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((item) => vlanId(item)).filter((item): item is number => item != null);
  const text = textOf(value);
  if (!text) return [];
  const ids: number[] = [];
  for (const part of text.split(",")) {
    const piece = part.trim();
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
    if (range?.[1] && range[2]) {
      const start = vlanId(range[1]);
      const end = vlanId(range[2]);
      if (start != null && end != null) {
        for (let id = start; id <= end && id <= start + 64; id += 1) ids.push(id);
      }
      continue;
    }
    const id = vlanId(piece);
    if (id != null) ids.push(id);
  }
  return ids;
}

function speedOf(value: unknown): string {
  const number = numberLike(value);
  if (number == null || number <= 0) return "";
  return formatRate(number, number >= 1_000_000 ? "bps" : "kbps");
}

function mapInterfaces(rows: Record<string, unknown>[], warnings: TranslatorWarning[]) {
  const devices: NetworkDevice[] = [];
  const interfaces: NetworkInterface[] = [];
  const known = new Set<string>();
  rows.forEach((row, index) => {
    const pointer = `/interfaceProperties/${index}`;
    noteUnmapped(warnings, pointer, row, IFACE_USED, "interface");
    const end = endOf(row.Interface);
    if (!end) {
      pushWarning(warnings, pointer, "Skipped an interface row with no node and port.");
      return;
    }
    if (!known.has(end.host.toLowerCase())) {
      known.add(end.host.toLowerCase());
      devices.push(blankDevice(end.host));
    }
    const addresses = [...prefixes(row.All_Prefixes), ...prefixes(row.Primary_Address)];
    const ipv4: NetworkAddress[] = [];
    const ipv6: NetworkAddress[] = [];
    for (const prefix of addresses) {
      const cidr = splitCidr(prefix);
      if (!cidr) continue;
      const stored = { address: cidr.address, prefix: cidr.prefix };
      const list = cidr.family === "ipv4" ? ipv4 : ipv6;
      if (!list.some((item) => item.address === stored.address && item.prefix === stored.prefix)) list.push(stored);
    }
    const mode = textOf(row.Switchport_Mode).toLowerCase();
    const switchportMode = mode === "access" ? "access" : mode === "trunk" ? "trunk" : "";
    const admin = statusUpDown(row.Admin_Up);
    const oper = statusUpDown(row.Active);
    const vrf = textOf(row.VRF);
    interfaces.push(
      blankInterface(end.host, end.iface, {
        description: textOf(row.Description),
        adminStatus: admin === "up" || admin === "down" ? admin : "",
        operStatus: oper === "up" || oper === "down" ? oper : "",
        speed: speedOf(row.Bandwidth),
        ipv4,
        ipv6,
        vrf: vrf && vrf.toLowerCase() !== "default" ? vrf : "",
        switchportMode,
        accessVlan: switchportMode === "access" ? vlanId(row.Access_VLAN) : null,
        nativeVlan: switchportMode === "trunk" ? vlanId(row.Native_VLAN) : null,
        trunkVlans: switchportMode === "trunk" ? parseVlans(row.Allowed_VLANs) : null,
      }),
    );
  });
  return { devices, interfaces };
}

function layer1Pairs(value: unknown, warnings: TranslatorWarning[]): { pairs: Set<string>; links: NetworkLink[]; devices: NetworkDevice[] } {
  const body = isRecord(value) && Array.isArray(value.edges) ? value : isRecord(value) && isRecord(value.layer1_topology) ? value.layer1_topology : value;
  const edges = isRecord(body) && Array.isArray(body.edges) ? body.edges : [];
  const pairs = new Set<string>();
  const links: NetworkLink[] = [];
  const devices: NetworkDevice[] = [];
  edges.forEach((edge, index) => {
    const pointer = `/layer1_topology/edges/${index}`;
    if (!isRecord(edge)) return;
    noteUnmapped(warnings, pointer, edge, L1_USED, "layer 1 edge");
    const a = isRecord(edge.node1) ? { host: textOf(edge.node1.hostname), iface: textOf(edge.node1.interfaceName) } : null;
    const b = isRecord(edge.node2) ? { host: textOf(edge.node2.hostname), iface: textOf(edge.node2.interfaceName) } : null;
    if (!a?.host || !a.iface || !b?.host || !b.iface) {
      pushWarning(warnings, pointer, "Skipped a layer 1 edge that does not name both ends.");
      return;
    }
    pairs.add(pairKey(a, b));
    ensureDevice(devices, a.host);
    ensureDevice(devices, b.host);
    links.push(blankLink(a.host, a.iface, b.host, b.iface));
  });
  return { pairs, links, devices };
}

function mapLayer3(rows: Record<string, unknown>[], physical: Set<string>, devices: NetworkDevice[], warnings: TranslatorWarning[]): NetworkLink[] {
  const links: NetworkLink[] = [];
  rows.forEach((row, index) => {
    const pointer = `/layer3Edges/${index}`;
    noteUnmapped(warnings, pointer, row, EDGE_USED, "layer 3 edge");
    const a = endOf(row.Interface);
    const b = endOf(row.Remote_Interface);
    if (!a || !b) {
      pushWarning(warnings, pointer, "Skipped a layer 3 edge that does not name both interfaces.");
      return;
    }
    const inferred = !physical.has(pairKey(a, b));
    ensureDevice(devices, a.host);
    ensureDevice(devices, b.host);
    links.push(blankLink(a.host, a.iface, b.host, b.iface, "", inferred));
  });
  return links;
}

function mapVlans(rows: Record<string, unknown>[], warnings: TranslatorWarning[]): NetworkVlan[] {
  const vlans: NetworkVlan[] = [];
  const seen = new Set<number>();
  rows.forEach((row, index) => {
    noteUnmapped(warnings, `/switchedVlanProperties/${index}`, row, VLAN_USED, "VLAN");
    const id = vlanId(row.VLAN_ID);
    if (id == null || seen.has(id)) return;
    seen.add(id);
    vlans.push({ id, name: textOf(row.Name) || textOf(row.VLAN_Name) });
  });
  return vlans;
}

function convertBatfish(input: unknown): TranslatorResult {
  if (!isRecord(input) && !Array.isArray(input)) throw translatorFail(400, "A Batfish export must be a JSON object or array.");
  const warnings: TranslatorWarning[] = [];
  const root = isRecord(input) ? input : { interfaceProperties: input };
  const ifaceRows = recordsOf(section(root, ["interfaceProperties", "interface_properties"]) ?? (Array.isArray(input) ? input : null));
  const mapped = mapInterfaces(ifaceRows, warnings);
  const layer1 = layer1Pairs(section(root, ["layer1_topology", "layer1"]), warnings);
  for (const device of layer1.devices) ensureDevice(mapped.devices, device.name);
  const layer3 = mapLayer3(recordsOf(section(root, ["layer3Edges", "layer3_edges"])), layer1.pairs, mapped.devices, warnings);
  const links = dedupeLinks([...layer1.links, ...layer3]);
  const vlans = mapVlans(recordsOf(section(root, ["switchedVlanProperties", "switched_vlan_properties"])), warnings);
  ensureLinkEnds(mapped.devices, mapped.interfaces, links);
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: mapped.devices, interfaces: mapped.interfaces, links, vlans }),
    warnings: sortWarnings(warnings),
  };
}

const batfish: TranslatorModule = {
  id: "batfish",
  name: "Batfish",
  formatHint: "Saved Batfish question JSON, with an optional layer1 topology",
  placeholder: `{
  "interfaceProperties": [],
  "layer3Edges": [],
  "layer1_topology": { "edges": [] }
}`,
  convert: convertBatfish,
};

export default batfish;
