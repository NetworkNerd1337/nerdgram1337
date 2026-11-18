import { parseNeighborSource } from "../neighbors/index.js";
import { normalizeInterface } from "../neighbors/normalize.js";
import { canonicalIp, ipv4Network, ipv6Network } from "./ip.js";
import type {
  NetworkDevice,
  NetworkDocument,
  NetworkInterface,
  NetworkLink,
} from "./types.js";
import { compressVlans } from "./vlans.js";

export type NetIssue = {
  row: number;
  message: string;
  path?: string;
};

export type NetworkGenerateOptions = {
  view: "l3" | "l2";
  includeDown: boolean;
  groupBy: "" | "vrf" | "site" | "role" | "platform";
  vlan: number | null;
  grouping: boolean;
  localDevice: string;
};

export type BuiltNode = {
  key: string;
  label: string;
  group: string;
  className: string;
  diagram: string;
};

export type BuiltEdge = {
  source: string;
  target: string;
  label: string;
  /** Drawn as a dashed Mermaid edge when true. */
  dashed?: boolean;
};

type DeviceRecord = NetworkDevice & { key: string };

type IfaceRecord = {
  index: number;
  deviceKey: string;
  key: string;
  display: string;
  vrf: string;
  down: boolean;
  lagKey: string;
  lagDisplay: string;
  raw: NetworkInterface;
};

type Endpoint = {
  deviceKey: string;
  deviceName: string;
  ifaceKey: string;
  ifaceDisplay: string;
  lagKey: string;
  lagDisplay: string;
};

const RESERVED = new Set([
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "class",
  "classdef",
  "click",
  "style",
  "linkstyle",
  "direction",
  "default",
]);

export function buildNetwork(
  document: NetworkDocument,
  options: NetworkGenerateOptions,
): { nodes: BuiltNode[]; edges: BuiltEdge[]; errors: NetIssue[]; warnings: NetIssue[] } {
  const errors: NetIssue[] = [];
  const warnings: NetIssue[] = [];
  const devices = indexDevices(document, errors);
  const interfaces = indexInterfaces(document, devices, errors);
  if (errors.length > 0) return { nodes: [], edges: [], errors, warnings };

  const vlanNames = new Map<number, string>();
  for (const vlan of document.vlans) {
    if (vlan.name && !vlanNames.has(vlan.id)) vlanNames.set(vlan.id, vlan.name);
  }

  if (options.view === "l3") {
    const layer3 = buildLayer3(devices, interfaces, options, warnings, inferredPairs(document));
    return { nodes: layer3.nodes, edges: layer3.edges, errors, warnings };
  }
  const links = collectLinks(document, devices, interfaces, options, errors, warnings);
  if (errors.length > 0) return { nodes: [], edges: [], errors, warnings };
  const layer2 = buildLayer2(devices, interfaces, links, vlanNames, options, warnings);
  return { ...layer2, errors, warnings };
}

function indexDevices(document: NetworkDocument, errors: NetIssue[]): Map<string, DeviceRecord> {
  const devices = new Map<string, DeviceRecord>();
  document.devices.forEach((device, index) => {
    const key = device.name.toLowerCase();
    if (devices.has(key)) {
      errors.push({ row: 0, path: `/devices/${index}/name`, message: `/devices/${index}/name: duplicate device "${device.name}".` });
      return;
    }
    devices.set(key, { ...device, key });
  });
  return devices;
}

function indexInterfaces(
  document: NetworkDocument,
  devices: Map<string, DeviceRecord>,
  errors: NetIssue[],
): Map<string, IfaceRecord> {
  const interfaces = new Map<string, IfaceRecord>();
  document.interfaces.forEach((item, index) => {
    const deviceKey = item.device.toLowerCase();
    const device = devices.get(deviceKey);
    if (!device) {
      errors.push({
        row: 0,
        path: `/interfaces/${index}/device`,
        message: `/interfaces/${index}/device: no device named "${item.device}".`,
      });
      return;
    }
    const normalized = normalizeInterface(item.name);
    if (!normalized.key) {
      errors.push({ row: 0, path: `/interfaces/${index}/name`, message: `/interfaces/${index}/name: interface name is empty.` });
      return;
    }
    const lag = item.lag ? normalizeInterface(item.lag) : { display: "", key: "", isMac: false };
    if (item.lag && !lag.key) {
      errors.push({ row: 0, path: `/interfaces/${index}/lag`, message: `/interfaces/${index}/lag: LAG name is empty.` });
      return;
    }
    const id = `${deviceKey}\0${normalized.key}`;
    if (interfaces.has(id)) {
      errors.push({
        row: 0,
        path: `/interfaces/${index}/name`,
        message: `/interfaces/${index}/name: ${device.name} already has ${normalized.display}.`,
      });
      return;
    }
    interfaces.set(id, {
      index,
      deviceKey,
      key: normalized.key,
      display: normalized.display,
      vrf: vrfKey(item.vrf),
      down: item.adminStatus === "down" || item.operStatus === "down",
      lagKey: lag.key,
      lagDisplay: lag.display,
      raw: item,
    });
  });
  return interfaces;
}

function pairKey(left: string, right: string): string {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/** Device pairs whose links are all marked inferred. Pairs with any solid link are left out. */
function inferredPairs(document: NetworkDocument): Set<string> {
  const inferred = new Set<string>();
  const solid = new Set<string>();
  for (const link of document.links) {
    const key = pairKey(link.a.device, link.b.device);
    if (link.inferred) inferred.add(key);
    else solid.add(key);
  }
  for (const key of solid) inferred.delete(key);
  return inferred;
}

function buildLayer3(
  devices: Map<string, DeviceRecord>,
  interfaces: Map<string, IfaceRecord>,
  options: NetworkGenerateOptions,
  warnings: NetIssue[],
  inferred: Set<string>,
): { nodes: BuiltNode[]; edges: BuiltEdge[] } {
  type Member = {
    deviceKey: string;
    ifaceDisplay: string;
    ifaceKey: string;
    address: string;
    prefix: number;
    vrf: string;
    speed: string;
  };
  const groups = new Map<string, Member[]>();
  const annotations = new Map<string, string[]>();
  const vrfsByDevice = new Map<string, Set<string>>();
  const addressed: Member[] = [];

  const addMember = (member: Member, loopback: boolean) => {
    addressed.push(member);
    const id = `${member.vrf}\0${member.prefix}\0${member.address.includes(":") ? "6" : "4"}\0${networkOf(member)}`;
    if (loopback) {
      const list = annotations.get(member.deviceKey) ?? [];
      list.push(annotation(member));
      annotations.set(member.deviceKey, list);
      touchVrf(vrfsByDevice, member.deviceKey, member.vrf);
      return;
    }
    const list = groups.get(id) ?? [];
    list.push(member);
    groups.set(id, list);
  };

  for (const item of interfaces.values()) {
    if (item.down && !options.includeDown) continue;
    for (const family of ["ipv4", "ipv6"] as const) {
      for (const address of item.raw[family]) {
        const host = canonicalIp(address.address, family);
        const network = family === "ipv4" ? ipv4Network(address.address, address.prefix) : ipv6Network(address.address, address.prefix);
        if (!host || !network) continue;
        const member: Member = {
          deviceKey: item.deviceKey,
          ifaceDisplay: item.display,
          ifaceKey: item.key,
          address: host,
          prefix: address.prefix,
          vrf: item.vrf,
          speed: item.raw.speed.trim(),
        };
        const loopback = (family === "ipv4" && address.prefix === 32) || (family === "ipv6" && address.prefix === 128);
        addMember(member, loopback);
      }
    }
  }

  warnDuplicateAddresses(addressed, devices, warnings);

  const edges: BuiltEdge[] = [];
  const segmentNodes: BuiltNode[] = [];
  for (const members of groups.values()) {
    const sorted = [...members].sort(compareMembers);
    const first = sorted[0];
    if (!first) continue;
    const network = networkOf(first);
    const devicesInGroup = new Set(sorted.map((member) => member.deviceKey));
    const pointToPoint =
      devicesInGroup.size === 2 &&
      sorted.length === 2 &&
      (first.prefix === 30 || first.prefix === 31 || first.prefix === 127);
    const sameAddress =
      sorted.length >= 2 &&
      new Set(sorted.map((member) => member.deviceKey)).size > 1 &&
      sorted.every((member) => member.address === first.address);
    if (pointToPoint && sameAddress) {
      for (const member of sorted) {
        const list = annotations.get(member.deviceKey) ?? [];
        list.push(annotation(member));
        annotations.set(member.deviceKey, list);
        touchVrf(vrfsByDevice, member.deviceKey, member.vrf);
      }
      continue;
    }
    if (pointToPoint) {
      const [left, right] = orderPair(sorted[0]!, sorted[1]!);
      const dashed = inferred.has(pairKey(left.deviceKey, right.deviceKey));
      edges.push({
        source: left.deviceKey,
        target: right.deviceKey,
        label: p2pLabel(left, right, network),
        ...(dashed ? { dashed: true } : {}),
      });
      touchVrf(vrfsByDevice, left.deviceKey, left.vrf);
      touchVrf(vrfsByDevice, right.deviceKey, right.vrf);
      continue;
    }
    if (devicesInGroup.size >= 2 || sorted.length >= 3) {
      const vrf = first.vrf;
      const key = `net_${vrf || "default"}_${network}`;
      segmentNodes.push({
        key,
        label: vrf ? `${vrf} · ${network}` : network,
        group: options.grouping && options.groupBy === "vrf" ? vrfLabel(vrf) : "",
        className: "segment",
        diagram: "",
      });
      for (const member of sorted) {
        edges.push({
          source: member.deviceKey,
          target: key,
          label: endpointText(member.ifaceDisplay, member.address, member.speed),
        });
        touchVrf(vrfsByDevice, member.deviceKey, member.vrf);
      }
      continue;
    }
    for (const member of sorted) {
      const list = annotations.get(member.deviceKey) ?? [];
      list.push(annotation(member));
      annotations.set(member.deviceKey, list);
      touchVrf(vrfsByDevice, member.deviceKey, member.vrf);
    }
  }

  const nodes = deviceNodes(devices, annotations, (device) => {
    if (!options.grouping || !options.groupBy) return "";
    if (options.groupBy === "vrf") return vrfGroupLabel(vrfsByDevice.get(device.key));
    if (options.groupBy === "site" || options.groupBy === "role") return device[options.groupBy] ?? "";
    return "";
  });
  return { nodes: [...nodes, ...segmentNodes.sort((a, b) => a.key.localeCompare(b.key))], edges: sortEdges(edges) };
}

function buildLayer2(
  devices: Map<string, DeviceRecord>,
  interfaces: Map<string, IfaceRecord>,
  links: LinkEnd[],
  vlanNames: Map<number, string>,
  options: NetworkGenerateOptions,
  warnings: NetIssue[],
): { nodes: BuiltNode[]; edges: BuiltEdge[]; warnings: NetIssue[] } {
  const bundles = new Map<string, LinkEnd[]>();
  for (const link of links) {
    const key = bundleKey(link);
    const list = bundles.get(key) ?? [];
    list.push(link);
    bundles.set(key, list);
  }

  const edges: BuiltEdge[] = [];
  for (const members of bundles.values()) {
    const sorted = [...members].sort((a, b) => a.a.ifaceKey.localeCompare(b.a.ifaceKey) || a.b.ifaceKey.localeCompare(b.b.ifaceKey));
    const label = bundleLabel(sorted, interfaces, vlanNames);
    if (options.vlan != null && !bundleCarries(sorted, interfaces, options.vlan)) continue;
    const first = sorted[0];
    if (!first) continue;
    const dashed = sorted.every((member) => member.inferred);
    edges.push({
      source: first.a.deviceKey,
      target: first.b.deviceKey,
      label,
      ...(dashed ? { dashed: true } : {}),
    });
  }

  const nodes = deviceNodes(devices, new Map(), (device) => {
    if (!options.grouping) return "";
    if (options.groupBy !== "site" && options.groupBy !== "role" && options.groupBy !== "platform") return "";
    return device[options.groupBy] ?? "";
  });
  return { nodes, edges: sortEdges(edges), warnings };
}

type LinkEnd = { a: Endpoint; b: Endpoint; path: string; label: string; inferred: boolean };

function collectLinks(
  document: NetworkDocument,
  devices: Map<string, DeviceRecord>,
  interfaces: Map<string, IfaceRecord>,
  options: NetworkGenerateOptions,
  errors: NetIssue[],
  warnings: NetIssue[],
): LinkEnd[] {
  const raw: { link: NetworkLink; path: string }[] = document.links.map((link, index) => ({
    link,
    path: `/links/${index}`,
  }));
  appendNeighborLinks(document, options, raw, errors, warnings);

  const seen = new Set<string>();
  const links: LinkEnd[] = [];
  let duplicates = 0;
  for (const item of raw) {
    const a = endpointOf(item.link.a, item.path, "a", devices, interfaces, options, errors, warnings);
    const b = endpointOf(item.link.b, item.path, "b", devices, interfaces, options, errors, warnings);
    if (!a || !b) continue;
    if (a.deviceKey === b.deviceKey) {
      warnings.push({
        row: 0,
        path: item.path,
        message: `${item.path}: both ends are ${a.deviceName}. A link has to join two devices.`,
      });
      continue;
    }
    if (endsDown(a, b, interfaces, options)) continue;
    const [left, right] = a.deviceKey < b.deviceKey || (a.deviceKey === b.deviceKey && a.ifaceKey <= b.ifaceKey) ? [a, b] : [b, a];
    const id = `${left.deviceKey}\0${left.ifaceKey}\0${right.deviceKey}\0${right.ifaceKey}`;
    if (seen.has(id)) {
      duplicates += 1;
      continue;
    }
    seen.add(id);
    links.push({ a: left, b: right, path: item.path, label: item.link.label.trim(), inferred: item.link.inferred });
  }
  if (duplicates > 0) {
    warnings.push({
      row: 0,
      message: `Combined ${duplicates} duplicate link${duplicates === 1 ? "" : "s"}.`,
    });
  }
  if (links.length === 0 && errors.length === 0) {
    const supplied = document.links.length > 0 || Boolean(document.neighbors.cdp.trim() || document.neighbors.lldp.trim());
    warnings.push({
      row: 0,
      path: "/links",
      message: supplied
        ? "Every link uses a shutdown or down interface. Set includeDown to show them."
        : "No links were supplied. Add a links array, or CDP or LLDP text under neighbors.",
    });
  }
  return links;
}

function appendNeighborLinks(
  document: NetworkDocument,
  options: NetworkGenerateOptions,
  raw: { link: NetworkLink; path: string }[],
  errors: NetIssue[],
  warnings: NetIssue[],
): void {
  const localDevice = options.localDevice || document.neighbors.localDevice;
  for (const kind of ["cdp", "lldp"] as const) {
    const text = document.neighbors[kind].trim();
    if (!text) continue;
    const parsed = parseNeighborSource(kind, text, { localDevice });
    for (const issue of parsed.errors) {
      errors.push({
        row: issue.row,
        path: `/neighbors/${kind}`,
        message: `/neighbors/${kind}: ${issue.message}`,
      });
    }
    for (const issue of parsed.warnings) {
      warnings.push({
        row: issue.row,
        path: `/neighbors/${kind}`,
        message: `/neighbors/${kind}: ${issue.message}`,
      });
    }
    if (parsed.errors.length > 0) continue;
    for (const link of parsed.links) {
      raw.push({
        link: {
          a: { device: link.localDevice, interface: link.localPort },
          b: { device: link.remoteDevice, interface: link.remotePort },
          label: "",
          inferred: false,
        },
        path: `/neighbors/${kind}`,
      });
    }
  }
}

function endpointOf(
  end: { device: string; interface: string },
  path: string,
  side: "a" | "b",
  devices: Map<string, DeviceRecord>,
  interfaces: Map<string, IfaceRecord>,
  options: NetworkGenerateOptions,
  errors: NetIssue[],
  warnings: NetIssue[],
): Endpoint | null {
  const device = devices.get(end.device.toLowerCase());
  if (!device) {
    errors.push({
      row: 0,
      path: `${path}/${side}/device`,
      message: `${path}/${side}/device: no device named "${end.device}".`,
    });
    return null;
  }
  const normalized = normalizeInterface(end.interface);
  if (!normalized.key) {
    errors.push({
      row: 0,
      path: `${path}/${side}/interface`,
      message: `${path}/${side}/interface: interface name is empty.`,
    });
    return null;
  }
  const record = interfaces.get(`${device.key}\0${normalized.key}`);
  if (!record && path.startsWith("/links/")) {
    warnings.push({
      row: 0,
      path: `${path}/${side}/interface`,
      message: `${path}/${side}/interface: ${device.name} has no interface record for ${normalized.display}. The link is still drawn.`,
    });
  }
  if (record?.down && !options.includeDown) return null;
  return {
    deviceKey: device.key,
    deviceName: device.name,
    ifaceKey: normalized.key,
    ifaceDisplay: record?.display || normalized.display,
    lagKey: record?.lagKey ?? "",
    lagDisplay: record?.lagDisplay ?? "",
  };
}

function endsDown(a: Endpoint, b: Endpoint, interfaces: Map<string, IfaceRecord>, options: NetworkGenerateOptions): boolean {
  if (options.includeDown) return false;
  return [a, b].some((end) => interfaces.get(`${end.deviceKey}\0${end.ifaceKey}`)?.down);
}

function bundleKey(link: LinkEnd): string {
  const left = link.a.lagKey ? `${link.a.deviceKey}\0lag:${link.a.lagKey}` : `${link.a.deviceKey}\0if:${link.a.ifaceKey}`;
  const right = link.b.lagKey ? `${link.b.deviceKey}\0lag:${link.b.lagKey}` : `${link.b.deviceKey}\0if:${link.b.ifaceKey}`;
  return left < right ? `${left}\0${right}` : `${right}\0${left}`;
}

function bundleLabel(members: LinkEnd[], interfaces: Map<string, IfaceRecord>, vlanNames: Map<number, string>): string {
  const first = members[0];
  if (!first) return "";
  const lines: string[] = [];
  const names = [...new Set(members.map((member) => member.label).filter(Boolean))];
  if (names.length > 0) lines.push(names.join(", "));
  const lagNames = [first.a.lagDisplay, first.b.lagDisplay].filter(Boolean);
  const uniqueLags = [...new Set(lagNames)];
  if (uniqueLags.length > 0) {
    const title = uniqueLags.length === 1 ? uniqueLags[0] : `${uniqueLags[0]} – ${uniqueLags[1]}`;
    lines.push(`${title} ×${members.length}`);
  }
  const pairs = members.map((member) => `${member.a.ifaceDisplay} – ${member.b.ifaceDisplay}`);
  lines.push(pairs.join(", "));
  const described = descriptionLine(members, interfaces);
  if (described) lines.push(described);
  const speeds = speedLine(members, interfaces);
  if (speeds) lines.push(speeds);
  const left = switchportFor(first.a, interfaces);
  const right = switchportFor(first.b, interfaces);
  const vlanLine = vlanLabel(left, right, vlanNames);
  if (vlanLine) lines.push(vlanLine);
  return lines.join("\n");
}

type Switchport = {
  mode: "" | "access" | "trunk";
  access: number | null;
  trunks: number[] | null;
  native: number | null;
};

function switchportFor(end: Endpoint, interfaces: Map<string, IfaceRecord>): Switchport {
  const member = interfaces.get(`${end.deviceKey}\0${end.ifaceKey}`);
  const lag = end.lagKey ? interfaces.get(`${end.deviceKey}\0${end.lagKey}`) : undefined;
  const chosen = lag && hasSwitchport(lag) ? lag : member;
  if (!chosen) return { mode: "", access: null, trunks: null, native: null };
  return {
    mode: chosen.raw.switchportMode,
    access: chosen.raw.accessVlan,
    trunks: chosen.raw.trunkVlans,
    native: chosen.raw.nativeVlan,
  };
}

function hasSwitchport(item: IfaceRecord): boolean {
  return Boolean(item.raw.switchportMode || item.raw.accessVlan || item.raw.trunkVlans || item.raw.nativeVlan);
}

function vlanLabel(left: Switchport, right: Switchport, names: Map<number, string>): string {
  const access = [left, right].filter((item) => effectiveMode(item) === "access" && item.access);
  const trunks = [left, right].filter((item) => effectiveMode(item) === "trunk");
  const parts: string[] = [];
  if (access.length > 0) {
    const ids = [...new Set(access.map((item) => item.access).filter((id): id is number => id != null))].sort((a, b) => a - b);
    const text = ids
      .map((id) => {
        const name = names.get(id);
        return name ? `${id} ${name}` : String(id);
      })
      .join("/");
    parts.push(ids.length === 1 ? `access ${text}` : `access ${text}`);
  }
  if (trunks.length > 0) {
    const allowed = intersectTrunks(trunks);
    const natives = [...new Set(trunks.map((item) => item.native).filter((id): id is number => id != null && id !== 1))].sort(
      (a, b) => a - b,
    );
    const bits: string[] = [];
    if (allowed === "all") bits.push("trunk");
    else if (allowed.length > 0) bits.push(compressVlans(allowed));
    else bits.push("trunk");
    if (natives.length > 0) {
      const text = natives
        .map((id) => {
          const name = names.get(id);
          return name ? `${id} ${name}` : String(id);
        })
        .join("/");
      bits.push(`native ${text}`);
    }
    parts.push(bits.join(" "));
  }
  return parts.join("\n");
}

function effectiveMode(item: Switchport): "" | "access" | "trunk" {
  if (item.mode) return item.mode;
  if (item.trunks || item.native) return "trunk";
  if (item.access) return "access";
  return "";
}

function intersectTrunks(items: Switchport[]): number[] | "all" {
  const explicit = items.map((item) => item.trunks).filter((list): list is number[] => list != null);
  if (explicit.length === 0) return "all";
  let current = new Set(explicit[0]);
  for (const list of explicit.slice(1)) {
    const next = new Set(list);
    current = new Set([...current].filter((id) => next.has(id)));
  }
  return [...current].sort((a, b) => a - b);
}

function bundleCarries(members: LinkEnd[], interfaces: Map<string, IfaceRecord>, vlan: number): boolean {
  const first = members[0];
  if (!first) return false;
  const ends = [switchportFor(first.a, interfaces), switchportFor(first.b, interfaces)];
  return ends.some((item) => carries(item, vlan));
}

function carries(item: Switchport, vlan: number): boolean {
  const mode = effectiveMode(item);
  if (mode === "access") return item.access === vlan;
  if (mode === "trunk") {
    if (item.native === vlan) return true;
    if (item.trunks == null) return true;
    return item.trunks.includes(vlan);
  }
  return false;
}

function descriptionLine(members: LinkEnd[], interfaces: Map<string, IfaceRecord>): string {
  const parts: string[] = [];
  for (const member of members) {
    const left = descriptionOf(member.a, interfaces);
    const right = descriptionOf(member.b, interfaces);
    const text = left && right ? (left === right ? left : `${left} – ${right}`) : left || right;
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.join(", ");
}

function descriptionOf(end: Endpoint, interfaces: Map<string, IfaceRecord>): string {
  return textOf(end, interfaces, "description");
}

function speedLine(members: LinkEnd[], interfaces: Map<string, IfaceRecord>): string {
  const parts: string[] = [];
  for (const member of members) {
    const left = speedOf(member.a, interfaces);
    const right = speedOf(member.b, interfaces);
    const text = left && right ? (left === right ? left : `${left} – ${right}`) : left || right;
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.join(", ");
}

function speedOf(end: Endpoint, interfaces: Map<string, IfaceRecord>): string {
  return textOf(end, interfaces, "speed");
}

function textOf(end: Endpoint, interfaces: Map<string, IfaceRecord>, field: "description" | "speed"): string {
  const member = interfaces.get(`${end.deviceKey}\0${end.ifaceKey}`)?.raw[field].trim() ?? "";
  if (member) return member;
  if (!end.lagKey) return "";
  return interfaces.get(`${end.deviceKey}\0${end.lagKey}`)?.raw[field].trim() ?? "";
}

function deviceNodes(
  devices: Map<string, DeviceRecord>,
  annotations: Map<string, string[]>,
  groupOf: (device: DeviceRecord) => string,
): BuiltNode[] {
  return [...devices.values()]
    .sort((a, b) => a.key.localeCompare(b.key) || a.name.localeCompare(b.name))
    .map((device) => {
      const notes = [...new Set(annotations.get(device.key) ?? [])].sort((a, b) => a.localeCompare(b));
      const management = managementLine(device, notes);
      const platform = device.platform.trim();
      const model = device.model.trim();
      const lines = [device.name, ...(platform ? [platform] : []), ...(model ? [model] : []), ...(management ? [management] : []), ...notes];
      return {
        key: device.key,
        label: lines.join("\n"),
        group: groupOf(device),
        className: className(device.role),
        diagram: device.diagram,
      };
    });
}

function managementLine(device: DeviceRecord, notes: string[]): string {
  const ip = device.managementIp.trim();
  if (!ip) return "";
  const shown = notes.some((note) => note.split(/\s+/).some((part) => part === ip || part.startsWith(`${ip}/`)));
  if (shown) return "";
  return `mgmt ${ip}`;
}

function annotation(member: { ifaceDisplay: string; address: string; prefix: number; vrf: string; speed: string }): string {
  const speed = member.speed ? ` ${member.speed}` : "";
  const vrf = member.vrf ? ` ${member.vrf}` : "";
  return `${member.ifaceDisplay} ${member.address}/${member.prefix}${speed}${vrf}`;
}

function endpointText(iface: string, address: string, speed: string): string {
  return speed ? `${iface} ${address} ${speed}` : `${iface} ${address}`;
}

function networkOf(member: { address: string; prefix: number }): string {
  return (member.address.includes(":") ? ipv6Network(member.address, member.prefix) : ipv4Network(member.address, member.prefix)) ?? "";
}

function p2pLabel(
  left: { ifaceDisplay: string; address: string; vrf: string; speed: string },
  right: { ifaceDisplay: string; address: string; speed: string },
  network: string,
): string {
  const title = left.vrf ? `${left.vrf} · ${network}` : network;
  return `${title}\n${endpointText(left.ifaceDisplay, left.address, left.speed)} – ${endpointText(right.ifaceDisplay, right.address, right.speed)}`;
}

function orderPair<T extends { deviceKey: string; ifaceKey: string }>(left: T, right: T): [T, T] {
  if (left.deviceKey < right.deviceKey || (left.deviceKey === right.deviceKey && left.ifaceKey <= right.ifaceKey)) return [left, right];
  return [right, left];
}

function compareMembers(a: { deviceKey: string; ifaceKey: string; address: string }, b: { deviceKey: string; ifaceKey: string; address: string }): number {
  return a.deviceKey.localeCompare(b.deviceKey) || a.ifaceKey.localeCompare(b.ifaceKey) || a.address.localeCompare(b.address);
}

function sortEdges(edges: BuiltEdge[]): BuiltEdge[] {
  return [...edges].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.label.localeCompare(b.label));
}

function touchVrf(map: Map<string, Set<string>>, deviceKey: string, vrf: string): void {
  const set = map.get(deviceKey) ?? new Set<string>();
  set.add(vrf);
  map.set(deviceKey, set);
}

function vrfKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "default") return "";
  return trimmed;
}

function vrfLabel(key: string): string {
  return key || "default";
}

/** One VRF stays in that subgraph. Several VRFs share a subgraph named for the set. */
function vrfGroupLabel(set: Set<string> | undefined): string {
  if (!set || set.size === 0) return "";
  return [...set]
    .map((key) => vrfLabel(key))
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

function warnDuplicateAddresses(
  members: { deviceKey: string; address: string; prefix: number; vrf: string }[],
  devices: Map<string, DeviceRecord>,
  warnings: NetIssue[],
): void {
  const buckets = new Map<string, { address: string; prefix: number; vrf: string; names: Set<string> }>();
  for (const member of members) {
    const key = `${member.vrf}\0${member.address}\0${member.prefix}`;
    const bucket = buckets.get(key) ?? {
      address: member.address,
      prefix: member.prefix,
      vrf: member.vrf,
      names: new Set<string>(),
    };
    bucket.names.add(devices.get(member.deviceKey)?.name ?? member.deviceKey);
    buckets.set(key, bucket);
  }
  const rows = [...buckets.values()]
    .filter((bucket) => bucket.names.size > 1)
    .sort((a, b) => a.address.localeCompare(b.address) || a.prefix - b.prefix || a.vrf.localeCompare(b.vrf));
  for (const bucket of rows) {
    const names = [...bucket.names].sort((a, b) => a.localeCompare(b));
    const vrf = bucket.vrf ? ` in ${bucket.vrf}` : "";
    warnings.push({
      row: 0,
      message: `${bucket.address}/${bucket.prefix}${vrf} is configured on more than one device (${names.join(", ")}).`,
    });
  }
}

function className(role: string): string {
  const cleaned = role.trim();
  if (!cleaned) return "";
  let name = cleaned
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!name || !/^[A-Za-z_]/.test(name)) name = `c_${name || "class"}`;
  if (RESERVED.has(name.toLowerCase())) name = `c_${name}`;
  return name.slice(0, 64);
}
