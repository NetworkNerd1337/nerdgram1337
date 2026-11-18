import type { NetworkDevice, NetworkInterface, NetworkLink } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  dedupeLinks,
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
  textOf,
} from "./helpers.js";
import { translatorFail } from "./limits.js";
import type { TranslatorModule, TranslatorResult, TranslatorWarning } from "./types.js";

/**
 * Saved SolarWinds SWIS Query JSON. The envelope is { results: [...] }.
 * Orion.Nodes.IPAddress, MachineType, Vendor, and Location are the 2024.4
 * names. Interface Speed and InterfaceSpeed are bits per second. AdminStatus
 * 1 is Up and 2 is Down. Nothing in this file calls Orion.
 */

const NODE_USED = new Set([
  "NodeID",
  "Caption",
  "DisplayName",
  "IPAddress",
  "IP_Address",
  "IP",
  "MachineType",
  "Vendor",
  "Location",
  "Uri",
]);
const INTERFACE_USED = new Set([
  "NodeID",
  "InterfaceID",
  "IfName",
  "InterfaceName",
  "Caption",
  "Name",
  "InterfaceCaption",
  "Alias",
  "InterfaceAlias",
  "Speed",
  "InterfaceSpeed",
  "AdminStatus",
  "OperStatus",
  "Uri",
]);
const TOPOLOGY_USED = new Set([
  "SrcNodeID",
  "SrcInterfaceID",
  "DestNodeID",
  "DestInterfaceID",
  "SrcType",
  "DestType",
  "LayerType",
  "Uri",
]);

const SHADOW = "orion.shadownodes";

function rows(warnings: TranslatorWarning[], value: unknown, label: string): unknown[] {
  const section = sectionList(value, ["results", label]);
  if (!section.present) return [];
  if (section.next) pushWarning(warnings, `/${label}`, `Ignored next page URL on ${label}. NerdGram does not fetch it.`);
  if (section.bad) {
    pushWarning(warnings, `/${label}`, `${label} is not a list or a SWIS results envelope.`);
    return [];
  }
  return section.items;
}

function snmpStatus(value: unknown): "" | "up" | "down" | "other" {
  const number = numberLike(value);
  if (number == null || value === "") return "";
  if (number === 1) return "up";
  if (number === 2) return "down";
  return "other";
}

function mapNodes(items: unknown[], warnings: TranslatorWarning[]) {
  const devices: NetworkDevice[] = [];
  const byId = new Map<string, string>();
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/nodes/${index}`;
    if (!isRecord(item)) {
      pushWarning(warnings, pointer, "Skipped a node that is not an object.");
      return;
    }
    noteUnmapped(warnings, pointer, item, NODE_USED, "node");
    const name = textOf(item.Caption) || textOf(item.DisplayName);
    if (!name) {
      pushWarning(warnings, pointer, "Skipped a node with no Caption or DisplayName.");
      return;
    }
    if (seen.has(name.toLowerCase())) {
      pushWarning(warnings, pointer, `Duplicate node "${name}" was skipped.`);
      return;
    }
    seen.add(name.toLowerCase());
    const address = hostAddress(item.IPAddress) || hostAddress(item.IP_Address) || hostAddress(item.IP);
    devices.push(
      blankDevice(name, {
        managementIp: address,
        model: textOf(item.MachineType),
        platform: textOf(item.Vendor),
        site: textOf(item.Location),
      }),
    );
    const id = idKey(item.NodeID);
    if (id) byId.set(id, name);
  });
  return { devices, byId };
}

function interfaceName(row: Record<string, unknown>): string {
  return (
    textOf(row.IfName) ||
    textOf(row.InterfaceName) ||
    textOf(row.Caption) ||
    textOf(row.InterfaceCaption) ||
    textOf(row.Name)
  );
}

function mapInterfaces(items: unknown[], nodes: Map<string, string>, warnings: TranslatorWarning[]) {
  const interfaces: NetworkInterface[] = [];
  const byId = new Map<string, { device: string; name: string }>();
  items.forEach((item, index) => {
    const pointer = `/interfaces/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, INTERFACE_USED, "interface");
    const device = nodes.get(idKey(item.NodeID)) ?? "";
    const name = interfaceName(item);
    if (!device || !name) {
      pushWarning(warnings, pointer, "Skipped an interface whose node or name could not be resolved.");
      return;
    }
    const admin = snmpStatus(item.AdminStatus);
    const oper = snmpStatus(item.OperStatus);
    if (admin === "other") pushWarning(warnings, `${pointer}/AdminStatus`, `AdminStatus ${String(item.AdminStatus)} is not Up (1) or Down (2).`);
    if (oper === "other") pushWarning(warnings, `${pointer}/OperStatus`, `OperStatus ${String(item.OperStatus)} is not Up (1) or Down (2).`);
    const speedValue = numberLike(item.Speed) ?? numberLike(item.InterfaceSpeed);
    interfaces.push(
      blankInterface(device, name, {
        description: textOf(item.Alias) || textOf(item.InterfaceAlias),
        speed: speedValue == null ? "" : formatRate(speedValue, "bps"),
        adminStatus: admin === "up" || admin === "down" ? admin : "",
        operStatus: oper === "up" || oper === "down" ? oper : "",
      }),
    );
    const id = idKey(item.InterfaceID);
    if (id) byId.set(id, { device, name });
  });
  return { interfaces, byId };
}

function mapTopology(
  items: unknown[],
  nodes: Map<string, string>,
  ports: Map<string, { device: string; name: string }>,
  warnings: TranslatorWarning[],
): NetworkLink[] {
  const links: NetworkLink[] = [];
  items.forEach((item, index) => {
    const pointer = `/topology/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, TOPOLOGY_USED, "topology");
    const srcType = textOf(item.SrcType).toLowerCase();
    const destType = textOf(item.DestType).toLowerCase();
    if (srcType === SHADOW || destType === SHADOW) {
      pushWarning(warnings, pointer, "Skipped a topology row that ends on Orion.ShadowNodes.");
      return;
    }
    const src = ports.get(idKey(item.SrcInterfaceID));
    const dest = ports.get(idKey(item.DestInterfaceID));
    const srcDevice = src?.device || nodes.get(idKey(item.SrcNodeID)) || "";
    const destDevice = dest?.device || nodes.get(idKey(item.DestNodeID)) || "";
    if (!src || !dest || !srcDevice || !destDevice) {
      pushWarning(warnings, pointer, "Skipped a topology row whose nodes or interfaces are not in this export.");
      return;
    }
    links.push(blankLink(srcDevice, src.name, destDevice, dest.name));
  });
  return dedupeLinks(links);
}

function convertOrion(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "An Orion export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const nodeItems = rows(warnings, input.nodes ?? input["Orion.Nodes"], "nodes");
  const interfaceItems = rows(warnings, input.interfaces ?? input["Orion.NPM.Interfaces"], "interfaces");
  const topologyItems = rows(
    warnings,
    input.topology ?? input.topologyConnections ?? input["Orion.TopologyConnections"],
    "topology",
  );
  const nodes = mapNodes(nodeItems, warnings);
  const ports = mapInterfaces(interfaceItems, nodes.byId, warnings);
  const links = mapTopology(topologyItems, nodes.byId, ports.byId, warnings);
  ensureLinkEnds(nodes.devices, ports.interfaces, links);
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: nodes.devices, interfaces: ports.interfaces, links, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const orion: TranslatorModule = {
  id: "orion",
  name: "SolarWinds Orion",
  formatHint: "Saved SWIS Query JSON (nodes, interfaces, topology connections)",
  placeholder: `{
  "nodes": { "results": [ { "NodeID": 1, "Caption": "core-rtr", "IPAddress": "192.0.2.1" } ] },
  "interfaces": { "results": [] },
  "topology": { "results": [] }
}`,
  convert: convertOrion,
};

export default orion;
