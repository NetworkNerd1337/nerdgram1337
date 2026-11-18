import type { NetworkDevice, NetworkInterface, NetworkLink } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  dedupeLinks,
  ensureLinkEnds,
  hostAddress,
  idKey,
  isRecord,
  noteUnmapped,
  publishDocument,
  pushWarning,
  sectionList,
  sortWarnings,
  textOf,
} from "./helpers.js";
import { translatorFail } from "./limits.js";
import type { TranslatorModule, TranslatorResult, TranslatorWarning } from "./types.js";

/**
 * Saved Zabbix JSON-RPC results. host.get inventory is not CDP/LLDP.
 * Links are taken only from a bundled map.get document (selectLinks and
 * selectSelements) whose elements are hosts. Nothing in this file calls Zabbix.
 */

const HOST_USED = new Set(["hostid", "host", "name", "interfaces", "inventory", "status"]);
const INTERFACE_USED = new Set(["interfaceid", "hostid", "ip", "dns", "port", "main", "type", "useip"]);
const INVENTORY_USED = new Set(["os", "model", "type", "location", "site_city", "name", "vendor"]);
const MAP_USED = new Set(["sysmapid", "name", "selements", "links"]);
const ELEMENT_USED = new Set(["selementid", "elementtype", "elementid", "elements", "label"]);
const LINK_USED = new Set(["linkid", "selementid1", "selementid2", "label"]);

const TYPE_LABEL: Record<string, string> = { "1": "agent", "2": "snmp", "3": "ipmi", "4": "jmx" };

function code(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return textOf(value);
}

function unwrap(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("result" in value && ("jsonrpc" in value || "id" in value)) return value.result;
  return value;
}

function listOf(value: unknown, keys: readonly string[]): unknown[] {
  const inner = unwrap(value);
  const section = sectionList(inner, [...keys, "result"]);
  if (section.present && !section.bad) return section.items;
  if (Array.isArray(inner)) return inner;
  return [];
}

function interfaceLabel(row: Record<string, unknown>): string {
  const kind = TYPE_LABEL[code(row.type)] ?? "interface";
  const address = textOf(row.ip) || textOf(row.dns) || "unknown";
  const port = textOf(row.port);
  return port ? `${kind} ${address}:${port}` : `${kind} ${address}`;
}

function mainScore(row: Record<string, unknown>): number {
  const main = code(row.main) === "1" ? 10 : 0;
  const type = code(row.type);
  const preference = type === "2" ? 3 : type === "1" ? 2 : 1;
  return main + preference;
}

function mapHosts(items: unknown[], warnings: TranslatorWarning[]) {
  const devices: NetworkDevice[] = [];
  const interfaces: NetworkInterface[] = [];
  const byId = new Map<string, { name: string; iface: string }>();
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/hosts/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, HOST_USED, "host");
    const visible = textOf(item.name);
    const technical = textOf(item.host);
    const name = visible || technical;
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const inventory = isRecord(item.inventory) ? item.inventory : null;
    if (inventory) noteUnmapped(warnings, `${pointer}/inventory`, inventory, INVENTORY_USED, "inventory");
    const hostInterfaces = Array.isArray(item.interfaces) ? item.interfaces.filter(isRecord) : [];
    const ranked = [...hostInterfaces].sort((a, b) => mainScore(b) - mainScore(a));
    const primary = ranked[0];
    devices.push(
      blankDevice(name, {
        managementIp: primary ? hostAddress(primary.ip) : "",
        platform: inventory ? textOf(inventory.os) : "",
        model: inventory ? textOf(inventory.model) : "",
        role: inventory ? textOf(inventory.type) : "",
        site: inventory ? textOf(inventory.location) || textOf(inventory.site_city) : "",
      }),
    );
    let primaryName = "";
    hostInterfaces.forEach((row) => {
      noteUnmapped(warnings, `${pointer}/interfaces`, row, INTERFACE_USED, "host interface");
      const label = interfaceLabel(row);
      interfaces.push(blankInterface(name, label));
      if (!primaryName && primary && row === primary) primaryName = label;
    });
    if (!primaryName) {
      primaryName = "zabbix";
      interfaces.push(blankInterface(name, primaryName));
      pushWarning(warnings, pointer, `Host ${name} has no Zabbix interface, so map links use the name "zabbix".`);
    }
    const id = idKey(item.hostid);
    if (id) byId.set(id, { name, iface: primaryName });
  });
  return { devices, interfaces, byId };
}

function hostFromElement(element: Record<string, unknown>, hosts: Map<string, { name: string; iface: string }>): { name: string; iface: string } | null {
  const type = code(element.elementtype);
  if (type && type !== "0") return null;
  const direct = hosts.get(idKey(element.elementid));
  if (direct) return direct;
  if (Array.isArray(element.elements)) {
    for (const entry of element.elements) {
      if (!isRecord(entry)) continue;
      const found = hosts.get(idKey(entry.hostid));
      if (found) return found;
    }
  }
  return null;
}

function mapLinks(
  maps: unknown[],
  hosts: Map<string, { name: string; iface: string }>,
  warnings: TranslatorWarning[],
): NetworkLink[] {
  const links: NetworkLink[] = [];
  maps.forEach((map, mapIndex) => {
    if (!isRecord(map)) return;
    noteUnmapped(warnings, `/maps/${mapIndex}`, map, MAP_USED, "map");
    const elements = new Map<string, { name: string; iface: string }>();
    const selements = Array.isArray(map.selements) ? map.selements : [];
    selements.forEach((element, index) => {
      if (!isRecord(element)) return;
      noteUnmapped(warnings, `/maps/${mapIndex}/selements/${index}`, element, ELEMENT_USED, "map element");
      const host = hostFromElement(element, hosts);
      const id = idKey(element.selementid);
      if (host && id) elements.set(id, host);
    });
    const rows = Array.isArray(map.links) ? map.links : [];
    rows.forEach((row, index) => {
      const pointer = `/maps/${mapIndex}/links/${index}`;
      if (!isRecord(row)) return;
      noteUnmapped(warnings, pointer, row, LINK_USED, "map link");
      const a = elements.get(idKey(row.selementid1));
      const b = elements.get(idKey(row.selementid2));
      if (!a || !b) {
        pushWarning(warnings, pointer, "Skipped a map link that does not join two hosts in this export.");
        return;
      }
      links.push(blankLink(a.name, a.iface, b.name, b.iface, textOf(row.label)));
    });
  });
  return dedupeLinks(links);
}

function convertZabbix(input: unknown): TranslatorResult {
  if (!isRecord(input) && !Array.isArray(input)) throw translatorFail(400, "A Zabbix export must be a JSON object or array.");
  const warnings: TranslatorWarning[] = [];
  const root = isRecord(input) ? input : { hosts: input };
  const hostItems = listOf(root.hosts ?? root.result ?? (Array.isArray(input) ? input : root), ["hosts"]);
  const extraInterfaces = listOf(root.interfaces, ["interfaces"]);
  const hosts = mapHosts(hostItems, warnings);
  if (extraInterfaces.length > 0 && hosts.interfaces.length === 0) {
    pushWarning(warnings, "/interfaces", "Host interfaces were separate from hosts, so they were not joined.");
  }
  const maps = listOf(root.maps ?? root.map, ["maps", "map"]);
  const links = mapLinks(maps, hosts.byId, warnings);
  ensureLinkEnds(hosts.devices, hosts.interfaces, links);
  if (links.length === 0) {
    pushWarning(
      warnings,
      "",
      "No links in this export. No links were created. Zabbix host inventory is not a topology.",
    );
  }
  return {
    document: publishDocument({ devices: hosts.devices, interfaces: hosts.interfaces, links, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const zabbix: TranslatorModule = {
  id: "zabbix",
  name: "Zabbix",
  formatHint: "Saved Zabbix host.get JSON, with an optional map.get topology",
  placeholder: `{
  "jsonrpc": "2.0",
  "result": [ { "hostid": "1", "host": "core-rtr", "name": "core-rtr", "interfaces": [], "inventory": {} } ],
  "id": 1
}`,
  convert: convertZabbix,
};

export default zabbix;
