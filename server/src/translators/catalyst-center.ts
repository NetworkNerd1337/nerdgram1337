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
 * Saved Catalyst Center topology JSON. The published topology guide shows
 * node id and label, and link source, target, startPortName, endPortName,
 * and linkStatus. Inventory fields below are the network-device names used
 * when that list is bundled. Nothing in this file calls the controller.
 */

const NODE_USED = new Set(["id", "label", "ip", "deviceType", "nodeType", "role", "family", "platformId", "siteId", "additionalInfo"]);
const LINK_USED = new Set(["id", "source", "target", "startPortName", "endPortName", "linkStatus", "startPortSpeed"]);
const DEVICE_USED = new Set([
  "id",
  "instanceUuid",
  "hostname",
  "managementIpAddress",
  "platformId",
  "softwareType",
  "softwareVersion",
  "role",
  "family",
  "type",
]);
const SITE_USED = new Set(["id", "name", "groupNameHierarchy", "siteName"]);

type NodeInfo = { name: string; site: string };

function rows(value: unknown, keys: readonly string[]): unknown[] {
  if (value == null) return [];
  if (isRecord(value) && isRecord(value.response)) return rows(value.response, keys);
  const section = sectionList(value, [...keys, "response"]);
  return section.bad ? [] : section.items;
}

function topologyOf(input: Record<string, unknown>): { nodes: unknown[]; links: unknown[] } {
  const physical = isRecord(input.physicalTopology) ? input.physicalTopology : input;
  const body = isRecord(physical.response) ? physical.response : physical;
  return {
    nodes: rows(body.nodes ?? body, ["nodes"]),
    links: rows(isRecord(body) && "links" in body ? body.links : input.links, ["links"]),
  };
}

function mapInventory(items: unknown[], warnings: TranslatorWarning[]) {
  const byId = new Map<string, Record<string, unknown>>();
  const byName = new Map<string, Record<string, unknown>>();
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    noteUnmapped(warnings, `/network-device/${index}`, item, DEVICE_USED, "network device");
    const id = idKey(item.id) || idKey(item.instanceUuid);
    if (id) byId.set(id, item);
    const name = textOf(item.hostname);
    if (name) byName.set(name.toLowerCase(), item);
  });
  return { byId, byName };
}

function mapSites(items: unknown[], warnings: TranslatorWarning[]) {
  const byId = new Map<string, string>();
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    noteUnmapped(warnings, `/sites/${index}`, item, SITE_USED, "site");
    const name = textOf(item.name) || textOf(item.groupNameHierarchy);
    const id = idKey(item.id);
    if (id && name) byId.set(id, name);
  });
  return byId;
}

function mapNodes(
  items: unknown[],
  inventory: { byId: Map<string, Record<string, unknown>>; byName: Map<string, Record<string, unknown>> },
  sites: Map<string, string>,
  warnings: TranslatorWarning[],
) {
  const devices: NetworkDevice[] = [];
  const byId = new Map<string, NodeInfo>();
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/nodes/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, NODE_USED, "node");
    const label = textOf(item.label);
    if (!label) {
      pushWarning(warnings, pointer, "Skipped a node with no label.");
      return;
    }
    if (seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    const extra = inventory.byId.get(idKey(item.id)) ?? inventory.byName.get(label.toLowerCase());
    const siteId = idKey(item.siteId);
    const site = (siteId && sites.get(siteId)) || "";
    devices.push(
      blankDevice(label, {
        managementIp: hostAddress(extra?.managementIpAddress) || hostAddress(item.ip),
        model: textOf(extra?.platformId) || textOf(item.platformId),
        platform: textOf(extra?.softwareType) || textOf(item.family),
        role: textOf(extra?.role) || textOf(item.role),
        site,
      }),
    );
    const id = idKey(item.id);
    if (id) byId.set(id, { name: label, site });
  });
  return { devices, byId };
}

function mapLinks(items: unknown[], nodes: Map<string, NodeInfo>, warnings: TranslatorWarning[]): NetworkLink[] {
  const links: NetworkLink[] = [];
  items.forEach((item, index) => {
    const pointer = `/links/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, LINK_USED, "link");
    const source = nodes.get(idKey(item.source));
    const target = nodes.get(idKey(item.target));
    const start = textOf(item.startPortName);
    const end = textOf(item.endPortName);
    if (!source || !target || !start || !end) {
      pushWarning(warnings, pointer, "Skipped a link that does not resolve both nodes and port names.");
      return;
    }
    links.push(blankLink(source.name, start, target.name, end, textOf(item.linkStatus)));
  });
  return dedupeLinks(links);
}

function convertCatalyst(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A Catalyst Center export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const topology = topologyOf(input);
  const inventory = mapInventory(rows(input["network-device"] ?? input.networkDevice ?? input.devices, ["response", "devices"]), warnings);
  const sites = mapSites(rows(input.sites ?? input.siteTopology, ["sites", "response"]), warnings);
  const nodes = mapNodes(topology.nodes, inventory, sites, warnings);
  const links = mapLinks(topology.links, nodes.byId, warnings);
  const interfaces: NetworkInterface[] = [];
  ensureLinkEnds(nodes.devices, interfaces, links);
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: nodes.devices, interfaces, links, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const catalystCenter: TranslatorModule = {
  id: "catalyst-center",
  name: "Cisco Catalyst Center",
  formatHint: "Saved Catalyst Center physical topology JSON",
  placeholder: `{
  "response": {
    "nodes": [ { "id": "1", "label": "core-rtr" } ],
    "links": []
  }
}`,
  convert: convertCatalyst,
};

export default catalystCenter;
