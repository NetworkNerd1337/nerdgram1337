/**
 * Cisco IOS, IOS-XE, and NX-OS `show ip route` pastes.
 *
 * Several devices can sit in one paste. A prompt (`host#` or `host>`) starts
 * a device and supplies its name. Connected and local routes supply interface
 * addresses. A next hop that belongs to another pasted device is an adjacency.
 * One that does not is an unknown-next-hop stub. ARP is not a link by itself.
 * With a MAC address table, a host is placed on the switchport that learned
 * its MAC. A port with many MACs is an uplink, not a host port.
 */

export type RouteHosts = "ports" | "port-counts" | "vlan-counts";

export const TRUNK_MAC_MIN = 8;

export type RouteIssue = { message: string };

export type RouteNode = { id: string; label: string; className: string };
export type RouteEdge = { source: string; target: string; label: string };

export type RouteDiagram = {
  errors: RouteIssue[];
  warnings: RouteIssue[];
  nodes: RouteNode[];
  edges: RouteEdge[];
  unknownNextHops: number;
};

type Section = "route" | "arp" | "mac" | "skip";

type LocalAddress = { ip: string; iface: string };
type ConnectedSubnet = { prefix: string; iface: string };
type Routed = { prefix: string; protocol: string; nextHop: string };
type ArpEntry = { ip: string; mac: string; iface: string };
type MacEntry = { vlan: string; mac: string; port: string };

type Device = {
  name: string;
  unnamed: boolean;
  locals: LocalAddress[];
  connected: ConnectedSubnet[];
  routes: Routed[];
  arp: ArpEntry[];
  macs: MacEntry[];
};

const UNSUPPORTED =
  "This is not Cisco IOS, IOS-XE, or NX-OS show ip route output. Other routing-table formats are not parsed.";

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const CIDR = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/;
const MAC = /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i;
const PROMPT = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63})[>#](.*)$/;

const IOS_PROTOCOL: Record<string, string> = {
  C: "connected",
  L: "local",
  S: "static",
  R: "RIP",
  B: "BGP",
  D: "EIGRP",
  EX: "EIGRP",
  O: "OSPF",
  IA: "OSPF",
  E1: "OSPF",
  E2: "OSPF",
  N1: "OSPF",
  N2: "OSPF",
  I: "IS-IS",
  L1: "IS-IS",
  L2: "IS-IS",
};

export function looksLikeIpRoute(text: string): boolean {
  return (
    /show\s+ip\s+route\b/i.test(text) ||
    /IP Route Table for VRF/i.test(text) ||
    /Codes:\s*L\s*-\s*local,\s*C\s*-\s*connected/i.test(text) ||
    /ubest\/mbest/i.test(text) ||
    /\bis directly connected,/i.test(text)
  );
}

/** Cisco `show ip arp`, `show arp`, or `show mac address-table`. Not a routing table. */
export function looksLikeArpMac(text: string): boolean {
  return (
    /show\s+ip\s+arp\b/i.test(text) ||
    /(?:^|\n)\s*show\s+arp\b/i.test(text) ||
    /show\s+mac\s+address-table\b/i.test(text) ||
    /show\s+mac\s+address\s+table\b/i.test(text) ||
    /^Protocol\s+Address/im.test(text) ||
    /IP ARP Table/i.test(text) ||
    (/Mac Address/i.test(text) && /\bPorts?\b/i.test(text))
  );
}

export const MIXED_LAYER_NOTE =
  "This paste also includes ARP or MAC output. That is supported with the routing table. Choose ARP and MAC tables (L2) for a layer 2 view.";

export const ARP_NEEDS_MAC =
  "A MAC address table is needed to place hosts on ports. ARP alone does not draw links.";

export function resolveRouteHosts(value: string | undefined): RouteHosts {
  const text = value?.trim().toLowerCase() ?? "";
  if (text === "" || text === "ports") return "ports";
  if (text === "port-counts" || text === "vlan-counts") return text;
  throw new Error("Hosts must be ports, port-counts, or vlan-counts.");
}

export function buildRouteDiagram(
  text: string,
  options: { localDevice?: string; hosts?: RouteHosts } = {},
): RouteDiagram {
  const hosts = options.hosts ?? "ports";
  const localName = cleanName(options.localDevice ?? "");
  if (isForeignRouteTable(text) && !looksLikeIpRoute(text)) {
    return empty(UNSUPPORTED);
  }
  const devices = splitDevices(text, localName);
  parseDevices(devices);
  const active = devices.filter(
    (device) => device.connected.length + device.routes.length + device.locals.length + device.arp.length + device.macs.length > 0,
  );
  const routeCount = active.reduce((sum, device) => sum + device.connected.length + device.routes.length + device.locals.length, 0);
  if (!looksLikeIpRoute(text) || routeCount === 0) {
    return empty(looksLikeIpRoute(text) ? "No routes were found in that Cisco show ip route paste." : UNSUPPORTED);
  }
  const diagram = assemble(active, hosts);
  if (looksLikeArpMac(text)) diagram.warnings.push({ message: MIXED_LAYER_NOTE });
  return diagram;
}

const ARP_MAC_UNSUPPORTED =
  "This is not Cisco IOS, IOS-XE, or NX-OS ARP or MAC address-table output.";

/** Layer 2 view: switches, hosts from the MAC table, and uplink stubs. ARP does not draw links by itself. */
export function buildArpMacDiagram(
  text: string,
  options: { localDevice?: string; hosts?: RouteHosts } = {},
): RouteDiagram {
  const hosts = options.hosts ?? "ports";
  const localName = cleanName(options.localDevice ?? "");
  if (looksLikeIpRoute(text) && !looksLikeArpMac(text)) {
    return empty("This looks like a routing table. Choose Routing table (L3) for show ip route.");
  }
  if (isForeignRouteTable(text) && !looksLikeArpMac(text)) return empty(ARP_MAC_UNSUPPORTED);
  const devices = splitDevices(text, localName);
  parseDevices(devices);
  const active = devices.filter((device) => device.arp.length + device.macs.length > 0);
  if (active.length === 0 || !looksLikeArpMac(text)) {
    return empty(looksLikeArpMac(text) ? "No ARP or MAC entries were found in that Cisco paste." : ARP_MAC_UNSUPPORTED);
  }
  return assembleLayer2(active, hosts);
}

function empty(message: string): RouteDiagram {
  return { errors: [{ message }], warnings: [], nodes: [], edges: [], unknownNextHops: 0 };
}

function isForeignRouteTable(text: string): boolean {
  return /\binet\.0\b/i.test(text) || /^\s*(?:show|display)\s+route\b/im.test(text);
}

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function splitDevices(text: string, localName: string): Device[] {
  const devices: Device[] = [];
  const unnamed = startDevice(localName || "Unnamed device", !localName);
  let current: Device | null = null;
  let section: Section = "route";
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const ensure = (): Device => {
    if (current) return current;
    current = unnamed;
    if (!devices.includes(unnamed)) devices.push(unnamed);
    return current;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const prompt = matchPrompt(line);
    if (prompt) {
      current = findDevice(devices, prompt.name, false);
      const next = prompt.command ? sectionFor(prompt.command) : null;
      if (next) section = next;
      continue;
    }
    const bare = /^show\b/i.test(line) ? sectionFor(line) : null;
    if (bare) {
      section = bare;
      continue;
    }
    const header = headerSection(line);
    if (header) section = header;
    if (section === "skip") continue;
    pushLine(ensure(), section, line);
  }
  return devices;
}

function matchPrompt(line: string): { name: string; command: string } | null {
  const match = line.match(PROMPT);
  if (!match?.[1]) return null;
  const command = (match[2] ?? "").trim();
  if (command && !/^show\b/i.test(command)) return null;
  return { name: match[1], command };
}

function startDevice(name: string, unnamed: boolean): Device {
  return { name, unnamed, locals: [], connected: [], routes: [], arp: [], macs: [] };
}

function findDevice(devices: Device[], name: string, unnamed: boolean): Device {
  const found = devices.find((device) => device.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const created = startDevice(name, unnamed);
  devices.push(created);
  return created;
}

function pushLine(device: Device, section: Section, line: string): void {
  if (section === "route") device.routes.push({ prefix: "", protocol: "", nextHop: `\0${line}` });
  else if (section === "arp") device.arp.push({ ip: "", mac: "", iface: line });
  else if (section === "mac") device.macs.push({ vlan: "", mac: "", port: line });
}

function sectionFor(command: string): Section | null {
  const text = command.trim().toLowerCase();
  if (!text) return null;
  if (/^show\s+ip\s+route\b/.test(text)) return "route";
  if (/^show\s+ip\s+arp\b/.test(text) || /^show\s+arp\b/.test(text)) return "arp";
  if (/^show\s+mac\s+address-table\b/.test(text) || /^show\s+mac\s+address\s+table\b/.test(text)) return "mac";
  if (/^show\b/.test(text)) return "skip";
  return null;
}

function headerSection(line: string): Section | null {
  if (/^codes:\s*l\s*-\s*local/i.test(line) || /IP Route Table for VRF/i.test(line) || /^Gateway of last resort/i.test(line)) {
    return "route";
  }
  if (/^Protocol\s+Address/i.test(line) || /IP ARP Table/i.test(line) || /^Address\s+Age\s+MAC Address/i.test(line)) return "arp";
  if (/Mac Address/i.test(line) && /Port/i.test(line)) return "mac";
  return null;
}

function parseDevices(devices: Device[]): void {
  for (const device of devices) {
    const routeLines = device.routes.map((route) => route.nextHop.slice(1));
    const arpLines = device.arp.map((entry) => entry.iface);
    const macLines = device.macs.map((entry) => entry.port);
    device.routes = [];
    device.arp = [];
    device.macs = [];
    parseRouteLines(device, routeLines);
    parseArpLines(device, arpLines);
    parseMacLines(device, macLines);
  }
}

function parseRouteLines(device: Device, lines: string[]): void {
  let pending = "";
  let pendingProtocol = "";
  for (const line of lines) {
    if (isNoise(line)) continue;
    const nxPrefix = line.match(/^(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}),\s+ubest\/mbest:/i);
    if (nxPrefix?.[1] && normalizeCidr(nxPrefix[1])) {
      pending = normalizeCidr(nxPrefix[1]) ?? "";
      pendingProtocol = /attached/i.test(line) ? "attached" : "";
      continue;
    }
    const nxVia = line.match(/^\*+\s*via\s+(\S+?),(.*)$/i);
    if (nxVia && pending) {
      applyNxVia(device, pending, nxVia[1] ?? "", nxVia[2] ?? "", pendingProtocol);
      continue;
    }
    const ios = line.match(/^([A-Za-z][A-Za-z0-9*+]{0,8}(?:\s+[A-Za-z0-9*+]+)?)\s+(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})\s+(.*)$/);
    if (ios?.[2] && normalizeCidr(ios[2])) {
      pending = normalizeCidr(ios[2]) ?? "";
      pendingProtocol = iosProtocol(ios[1] ?? "");
      applyIosRest(device, pending, pendingProtocol, ios[3] ?? "");
      continue;
    }
    const continuation = line.match(/^(?:\[\d+\/\d+\]\s+)?via\s+(\d{1,3}(?:\.\d{1,3}){3})\b/i);
    if (continuation?.[1] && pending && pendingProtocol !== "connected" && pendingProtocol !== "local") {
      device.routes.push({ prefix: pending, protocol: pendingProtocol || "static", nextHop: continuation[1] });
    }
  }
}

function isNoise(line: string): boolean {
  return (
    /^codes:/i.test(line) ||
    /^gateway of last resort/i.test(line) ||
    /is variably subnetted/i.test(line) ||
    /is subnetted/i.test(line) ||
    /^\*+\s+denotes/i.test(line) ||
    /^'/.test(line) ||
    /^IP Route Table/i.test(line)
  );
}

function applyIosRest(device: Device, prefix: string, protocol: string, rest: string): void {
  const connected = rest.match(/is directly connected,\s*(\S+)/i);
  if (connected?.[1]) {
    rememberConnected(device, prefix, protocol, connected[1]);
    return;
  }
  const via = rest.match(/via\s+(\d{1,3}(?:\.\d{1,3}){3})\b/i);
  if (via?.[1] && protocol !== "connected" && protocol !== "local") {
    device.routes.push({ prefix, protocol: protocol || "static", nextHop: via[1] });
  }
}

function applyNxVia(device: Device, prefix: string, viaToken: string, rest: string, attached: string): void {
  const parts = rest.split(",").map((part) => part.trim()).filter(Boolean);
  const protocolToken = parts.map(protocolTokenOf).find((part) => part) ?? "";
  const protocol = nxProtocol(protocolToken, attached);
  const iface = parts.find((part) => looksLikeInterface(part)) ?? "";
  if (!IPV4.test(viaToken)) return;
  if (protocol === "connected" || protocol === "local") {
    rememberConnected(device, prefix, protocol, iface || "connected");
    if (protocol === "local" || prefix.endsWith("/32")) device.locals.push({ ip: viaToken, iface: iface || "connected" });
    else if (protocol === "connected") device.locals.push({ ip: viaToken, iface: iface || "connected" });
    return;
  }
  device.routes.push({ prefix, protocol, nextHop: viaToken });
}

function rememberConnected(device: Device, prefix: string, protocol: string, iface: string): void {
  const cleaned = iface.replace(/[,.]$/, "");
  if (protocol === "local" || prefix.endsWith("/32")) {
    const host = prefix.split("/")[0] ?? "";
    if (IPV4.test(host)) device.locals.push({ ip: host, iface: cleaned });
    return;
  }
  device.connected.push({ prefix, iface: cleaned });
}

function protocolTokenOf(part: string): string {
  if (/^\[\d+\/\d+\]$/.test(part)) return "";
  if (/^\d+:\d+/.test(part) || /^\d+[wdh]\d*[wdh]?$/i.test(part)) return "";
  if (/^(intra|inter|type-\d+|external|internal)$/i.test(part)) return "";
  if (looksLikeInterface(part)) return "";
  return part;
}

function looksLikeInterface(part: string): boolean {
  if (/^\[/.test(part)) return false;
  return (
    /^(vlan|vl|eth|ethernet|gi|gigabitethernet|fa|fastethernet|te|tengigabitethernet|po|port-channel|lo|loopback|mgmt|tu|tunnel)/i.test(
      part,
    ) || /\d\/\d/.test(part)
  );
}

function iosProtocol(code: string): string {
  const token = code.replace(/[*+]/g, " ").trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  return IOS_PROTOCOL[token] ?? (token || "static");
}

function nxProtocol(token: string, attached: string): string {
  const lower = token.toLowerCase();
  if (lower === "local") return "local";
  if (lower === "direct") return "connected";
  if (!token && attached === "attached") return "connected";
  if (lower.startsWith("static")) return "static";
  if (lower.startsWith("ospf")) return "OSPF";
  if (lower.startsWith("bgp")) return "BGP";
  if (lower.startsWith("eigrp")) return "EIGRP";
  if (lower.startsWith("rip")) return "RIP";
  if (lower.startsWith("isis")) return "IS-IS";
  return token || "static";
}

function parseArpLines(device: Device, lines: string[]): void {
  for (const line of lines) {
    const ios = line.match(/^(?:Internet)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\S+\s+([0-9a-f.]+)\s+\S+\s+(\S+)/i);
    const nx = line.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+\S+\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s+(\S+)/i);
    const match = ios ?? nx;
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const mac = match[2].toLowerCase();
    if (!IPV4.test(match[1]) || !MAC.test(mac)) continue;
    device.arp.push({ ip: match[1], mac, iface: match[3] });
  }
}

function parseMacLines(device: Device, lines: string[]): void {
  for (const line of lines) {
    const macMatch = line.match(/([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})/i);
    if (!macMatch?.[1]) continue;
    const mac = macMatch[1].toLowerCase();
    const vlan = line.match(/^(\d+)\b/)?.[1] ?? "";
    const port = line.trim().split(/\s+/).at(-1) ?? "";
    if (!vlan || !port || /^[0-9a-f.]+$/i.test(port)) continue;
    device.macs.push({ vlan, mac, port });
  }
}

function assemble(devices: Device[], hosts: RouteHosts): RouteDiagram {
  const warnings: RouteIssue[] = [];
  if (devices.some((device) => device.unnamed)) {
    warnings.push({ message: "No CLI prompt was found, so this paste is one unnamed device." });
  }
  if (devices.length === 1) {
    warnings.push({
      message: "This shows only this device's view. Paste routing tables from neighboring devices to build the adjacency map.",
    });
  }
  const used = new Set<string>();
  const idOf = new Map<string, string>();
  const nodes: RouteNode[] = [];
  const edges: RouteEdge[] = [];
  const edgeKeys = new Set<string>();
  const own = ownership(devices);
  const addNode = (key: string, label: string, className: string): string => {
    const existing = idOf.get(key);
    if (existing) return existing;
    const id = fresh(label, used);
    idOf.set(key, id);
    nodes.push({ id, label, className });
    return id;
  };
  const ref = (value: string): string => idOf.get(value) ?? value;
  const addEdge = (source: string, target: string, label: string) => {
    const from = ref(source);
    const to = ref(target);
    const key = [from, to].sort().join("|") + `|${label}`;
    if (edgeKeys.has(key) || from === to) return;
    edgeKeys.add(key);
    edges.push({ source: from, target: to, label });
  };

  for (const device of devices) addNode(`device:${device.name}`, device.name, "");
  drawSubnets(devices, addNode, addEdge);
  const unknown = drawRoutes(devices, own, addNode, addEdge);
  if (unknown > 0) {
    warnings.push({
      message:
        unknown === 1
          ? "1 next hop did not match any pasted device."
          : `${unknown} next hops did not match any pasted device.`,
    });
  }
  drawHosts(devices, hosts, addNode, addEdge, warnings);
  return { errors: [], warnings, nodes, edges, unknownNextHops: unknown };
}

function ownership(devices: Device[]): Map<string, string> {
  const counts = new Map<string, Set<string>>();
  for (const device of devices) {
    for (const local of device.locals) {
      const names = counts.get(local.ip) ?? new Set<string>();
      names.add(device.name);
      counts.set(local.ip, names);
    }
  }
  const owned = new Map<string, string>();
  for (const [ip, names] of counts) {
    if (names.size === 1) owned.set(ip, [...names][0] ?? "");
  }
  return owned;
}

function drawSubnets(
  devices: Device[],
  addNode: (key: string, label: string, className: string) => string,
  addEdge: (source: string, target: string, label: string) => void,
): void {
  const byPrefix = new Map<string, { device: string; iface: string }[]>();
  for (const device of devices) {
    for (const subnet of device.connected) {
      const list = byPrefix.get(subnet.prefix) ?? [];
      list.push({ device: device.name, iface: subnet.iface });
      byPrefix.set(subnet.prefix, list);
    }
  }
  const single = devices.length === 1;
  for (const [prefix, members] of byPrefix) {
    const unique = dedupeMembers(members);
    const length = Number(prefix.split("/")[1] ?? "0");
    const pointToPoint = (length === 30 || length === 31) && unique.length === 2;
    if (pointToPoint && unique[0] && unique[1]) {
      addEdge(`device:${unique[0].device}`, `device:${unique[1].device}`, prefix);
      continue;
    }
    if (unique.length >= 2 || single) {
      const segment = addNode(`subnet:${prefix}`, prefix, "segment");
      for (const member of unique) addEdge(`device:${member.device}`, segment, member.iface);
    }
  }
}

function dedupeMembers(members: { device: string; iface: string }[]): { device: string; iface: string }[] {
  const seen = new Set<string>();
  const unique: { device: string; iface: string }[] = [];
  for (const member of members) {
    const key = member.device.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(member);
  }
  return unique;
}

function drawRoutes(
  devices: Device[],
  owned: Map<string, string>,
  addNode: (key: string, label: string, className: string) => string,
  addEdge: (source: string, target: string, label: string) => void,
): number {
  const grouped = new Map<string, { from: string; to: string; protocol: string; count: number; sample: string[]; unknown: boolean }>();
  const unknownIps = new Set<string>();
  for (const device of devices) {
    for (const route of device.routes) {
      const owner = owned.get(route.nextHop);
      const unknown = !owner || owner === device.name;
      if (unknown) unknownIps.add(route.nextHop);
      const target = unknown ? `unknown:${route.nextHop}` : `device:${owner}`;
      const key = `${device.name}\0${target}\0${route.protocol}`;
      const bucket = grouped.get(key) ?? {
        from: `device:${device.name}`,
        to: target,
        protocol: route.protocol,
        count: 0,
        sample: [] as string[],
        unknown,
      };
      bucket.count += 1;
      if (bucket.sample.length < 3 && !bucket.sample.includes(route.prefix)) bucket.sample.push(route.prefix);
      grouped.set(key, bucket);
    }
  }
  for (const bucket of grouped.values()) {
    const target = bucket.unknown ? addNode(bucket.to, `unknown next hop ${bucket.to.slice("unknown:".length)}`, "stub") : bucket.to;
    const detail = bucket.count > 3 ? `${bucket.count} prefixes` : bucket.sample.join(", ");
    addEdge(bucket.from, target, `${detail} ${bucket.protocol}`.trim());
  }
  return unknownIps.size;
}

function assembleLayer2(devices: Device[], hosts: RouteHosts): RouteDiagram {
  const warnings: RouteIssue[] = [];
  if (devices.some((device) => device.unnamed)) {
    warnings.push({ message: "No CLI prompt was found, so this paste is one unnamed device." });
  }
  const used = new Set<string>();
  const idOf = new Map<string, string>();
  const nodes: RouteNode[] = [];
  const edges: RouteEdge[] = [];
  const edgeKeys = new Set<string>();
  const addNode = (key: string, label: string, className: string): string => {
    const existing = idOf.get(key);
    if (existing) return existing;
    const id = fresh(label, used);
    idOf.set(key, id);
    nodes.push({ id, label, className });
    return id;
  };
  const ref = (value: string): string => idOf.get(value) ?? value;
  const addEdge = (source: string, target: string, label: string) => {
    const from = ref(source);
    const to = ref(target);
    const key = [from, to].sort().join("|") + `|${label}`;
    if (edgeKeys.has(key) || from === to) return;
    edgeKeys.add(key);
    edges.push({ source: from, target: to, label });
  };
  for (const device of devices) addNode(`device:${device.name}`, device.name, "");
  drawLayer2Hosts(devices, hosts, addNode, addEdge, warnings);
  return { errors: [], warnings, nodes, edges, unknownNextHops: 0 };
}

function drawLayer2Hosts(
  devices: Device[],
  hosts: RouteHosts,
  addNode: (key: string, label: string, className: string) => string,
  addEdge: (source: string, target: string, label: string) => void,
  warnings: RouteIssue[],
): void {
  const macs = devices.flatMap((device) => device.macs.map((entry) => ({ ...entry, device: device.name })));
  if (macs.length === 0) {
    if (devices.some((device) => device.arp.length > 0)) warnings.push({ message: ARP_NEEDS_MAC });
    return;
  }
  const perPort = new Map<string, number>();
  for (const entry of macs) {
    const key = `${entry.device}\0${entry.port}`;
    perPort.set(key, (perPort.get(key) ?? 0) + 1);
  }
  const trunk = new Set([...perPort.entries()].filter(([, count]) => count >= TRUNK_MAC_MIN).map(([key]) => key));
  if (trunk.size > 0) {
    warnings.push({
      message: `Ports with ${TRUNK_MAC_MIN} or more MAC addresses were treated as uplinks and drawn as stubs.`,
    });
  }
  for (const key of trunk) {
    const [device, port] = key.split("\0");
    if (!device || !port) continue;
    const stub = addNode(`uplink:${device}:${port}`, `uplink ${port}`, "stub");
    addEdge(`device:${device}`, stub, port);
  }
  const arpByMac = new Map<string, string>();
  for (const device of devices) {
    for (const entry of device.arp) if (!arpByMac.has(entry.mac)) arpByMac.set(entry.mac, entry.ip);
  }
  const ownIps = new Set(devices.flatMap((device) => device.locals.map((local) => local.ip)));
  type Placed = { label: string; device: string; port: string; vlan: string };
  const placed: Placed[] = [];
  const seen = new Set<string>();
  for (const entry of macs) {
    if (trunk.has(`${entry.device}\0${entry.port}`)) continue;
    const ip = arpByMac.get(entry.mac);
    if (ip && ownIps.has(ip)) continue;
    const identity = `${entry.device}\0${entry.mac}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    placed.push({ label: ip || entry.mac, device: entry.device, port: entry.port, vlan: entry.vlan });
  }
  if (hosts === "ports") {
    for (const host of placed) {
      const node = addNode(`host:${host.device}:${host.label}`, host.label, "host");
      addEdge(`device:${host.device}`, node, host.vlan ? `${host.port} vlan ${host.vlan}` : host.port);
    }
    return;
  }
  const groups = new Map<string, { device: string; label: string; count: number }>();
  for (const host of placed) {
    const key = hosts === "vlan-counts" ? `${host.device}\0vlan\0${host.vlan}` : `${host.device}\0port\0${host.port}`;
    const label = hosts === "vlan-counts" ? `VLAN ${host.vlan}` : host.port;
    const bucket = groups.get(key) ?? { device: host.device, label, count: 0 };
    bucket.count += 1;
    groups.set(key, bucket);
  }
  for (const [key, bucket] of groups) {
    const noun = bucket.count === 1 ? "host" : "hosts";
    const node = addNode(`count:${key}`, `${bucket.label} · ${bucket.count} ${noun}`, "host");
    addEdge(`device:${bucket.device}`, node, bucket.label);
  }
}

function drawHosts(
  devices: Device[],
  hosts: RouteHosts,
  addNode: (key: string, label: string, className: string) => string,
  addEdge: (source: string, target: string, label: string) => void,
  warnings: RouteIssue[],
): void {
  const arp = devices.flatMap((device) => device.arp);
  const macs = devices.flatMap((device) => device.macs.map((entry) => ({ ...entry, device: device.name })));
  if (arp.length > 0 && macs.length === 0) {
    warnings.push({ message: "ARP was pasted without a MAC address table, so no hosts were placed on ports." });
    return;
  }
  if (arp.length === 0 || macs.length === 0) return;
  const perPort = new Map<string, number>();
  for (const entry of macs) {
    const key = `${entry.device}\0${entry.port}`;
    perPort.set(key, (perPort.get(key) ?? 0) + 1);
  }
  const trunk = new Set([...perPort.entries()].filter(([, count]) => count >= TRUNK_MAC_MIN).map(([key]) => key));
  if (trunk.size > 0) {
    warnings.push({ message: `Ports with ${TRUNK_MAC_MIN} or more MAC addresses were treated as uplinks and were not used as host ports.` });
  }
  const ownIps = new Set(devices.flatMap((device) => device.locals.map((local) => local.ip)));
  const byMac = new Map<string, { device: string; port: string; vlan: string }>();
  for (const entry of macs) {
    if (trunk.has(`${entry.device}\0${entry.port}`) || byMac.has(entry.mac)) continue;
    byMac.set(entry.mac, entry);
  }
  type Placed = { ip: string; device: string; port: string; vlan: string };
  const placed: Placed[] = [];
  for (const entry of arp) {
    if (ownIps.has(entry.ip)) continue;
    const hit = byMac.get(entry.mac);
    if (!hit) continue;
    placed.push({ ip: entry.ip, device: hit.device, port: hit.port, vlan: hit.vlan });
  }
  if (hosts === "ports") {
    for (const host of placed) {
      const node = addNode(`host:${host.ip}`, host.ip, "host");
      addEdge(`device:${host.device}`, node, host.vlan ? `${host.port} vlan ${host.vlan}` : host.port);
    }
    return;
  }
  const groups = new Map<string, { device: string; label: string; count: number }>();
  for (const host of placed) {
    const key = hosts === "vlan-counts" ? `${host.device}\0vlan\0${host.vlan}` : `${host.device}\0port\0${host.port}`;
    const label = hosts === "vlan-counts" ? `VLAN ${host.vlan}` : host.port;
    const bucket = groups.get(key) ?? { device: host.device, label, count: 0 };
    bucket.count += 1;
    groups.set(key, bucket);
  }
  for (const [key, bucket] of groups) {
    const noun = bucket.count === 1 ? "host" : "hosts";
    const node = addNode(`count:${key}`, `${bucket.label} · ${bucket.count} ${noun}`, "host");
    addEdge(`device:${bucket.device}`, node, bucket.label);
  }
}

function fresh(label: string, used: Set<string>): string {
  let id = label
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!id || !/^[A-Za-z_]/.test(id)) id = `n_${id || "node"}`.slice(0, 64);
  let next = id;
  let n = 2;
  while (used.has(next.toLowerCase())) {
    next = `${id.slice(0, 56)}_${n}`;
    n += 1;
  }
  used.add(next.toLowerCase());
  return next;
}

function normalizeCidr(value: string): string | null {
  const match = value.match(CIDR);
  if (!match?.[1] || !match[2]) return null;
  const ip = ipToInt(match[1]);
  const prefix = Number(match[2]);
  if (ip == null || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  return `${intToIp(network)}/${prefix}`;
}

function ipToInt(ip: string): number | null {
  if (!IPV4.test(ip)) return null;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => part > 255)) return null;
  return (((parts[0] ?? 0) * 256 + (parts[1] ?? 0)) * 256 + (parts[2] ?? 0)) * 256 + (parts[3] ?? 0);
}

function intToIp(value: number): string {
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}
