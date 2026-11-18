import { clickTargetKind, resolveDiagramTarget } from "../diagramLinks.js";
import { canonicalIp } from "./ip.js";
import type {
  NetworkAddress,
  NetworkDevice,
  NetworkDocument,
  NetworkEndpoint,
  NetworkInterface,
  NetworkLink,
  NetworkVlan,
  SchemaIssue,
} from "./types.js";

const DEVICE_FIELDS = new Set(["name", "platform", "model", "role", "site", "managementIp", "diagram"]);
const INTERFACE_FIELDS = new Set([
  "device",
  "name",
  "description",
  "speed",
  "adminStatus",
  "operStatus",
  "ipv4",
  "ipv6",
  "vrf",
  "switchportMode",
  "accessVlan",
  "trunkVlans",
  "nativeVlan",
  "lag",
]);
const ADDRESS_FIELDS = new Set(["address", "prefix"]);
const LINK_FIELDS = new Set(["a", "b", "label", "inferred"]);
const ENDPOINT_FIELDS = new Set(["device", "interface"]);
const VLAN_FIELDS = new Set(["id", "name"]);
const ROOT_FIELDS = new Set(["schemaVersion", "format", "devices", "interfaces", "links", "vlans", "neighbors"]);
const NEIGHBOR_FIELDS = new Set(["cdp", "lldp", "localDevice"]);

export function validateNetwork(value: unknown): { document: NetworkDocument | null; issues: SchemaIssue[] } {
  const issues: SchemaIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "", message: "Network data must be a JSON object." });
    return { document: null, issues };
  }
  rejectUnknown(value, ROOT_FIELDS, "", issues);
  if (value.schemaVersion !== 1) {
    issues.push({ path: "/schemaVersion", message: "schemaVersion must be 1." });
  }
  if (value.format != null && value.format !== "network") {
    issues.push({ path: "/format", message: 'format must be "network" when it is set.' });
  }

  const devices = readDevices(value.devices, issues);
  const interfaces = readInterfaces(value.interfaces, issues);
  const links = value.links == null ? [] : readLinks(value.links, issues);
  const vlans = value.vlans == null ? [] : readVlans(value.vlans, issues);
  const neighbors = readNeighbors(value.neighbors, issues);

  if (issues.length > 0 || !devices || !interfaces || !links || !vlans || !neighbors) {
    return { document: null, issues };
  }

  const names = new Map<string, string>();
  devices.forEach((device, index) => {
    const key = device.name.toLowerCase();
    const previous = names.get(key);
    if (previous != null) {
      issues.push({ path: `/devices/${index}/name`, message: `duplicate device "${previous}".` });
      return;
    }
    names.set(key, device.name);
  });

  interfaces.forEach((item, index) => {
    if (!names.has(item.device.toLowerCase())) {
      issues.push({ path: `/interfaces/${index}/device`, message: `no device named "${item.device}".` });
    }
  });
  links.forEach((link, index) => {
    for (const side of ["a", "b"] as const) {
      const end = link[side];
      if (!names.has(end.device.toLowerCase())) {
        issues.push({ path: `/links/${index}/${side}/device`, message: `no device named "${end.device}".` });
      }
    }
  });

  if (issues.length > 0) return { document: null, issues };
  return {
    document: { schemaVersion: 1, devices, interfaces, links, vlans, neighbors },
    issues: [],
  };
}

function readDevices(value: unknown, issues: SchemaIssue[]): NetworkDevice[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path: "/devices", message: "devices must be an array." });
    return null;
  }
  let ok = true;
  const devices: NetworkDevice[] = [];
  value.forEach((item, index) => {
    const path = `/devices/${index}`;
    if (!isRecord(item)) {
      issues.push({ path, message: "must be an object." });
      ok = false;
      return;
    }
    rejectUnknown(item, DEVICE_FIELDS, path, issues);
    const name = requiredString(item.name, `${path}/name`, "name", issues);
    if (!name) {
      ok = false;
      return;
    }
    const diagram = childDiagram(item.diagram, `${path}/diagram`, issues);
    if (diagram == null) {
      ok = false;
      return;
    }
    devices.push({
      name,
      platform: optionalString(item.platform, `${path}/platform`, "platform", issues),
      model: optionalString(item.model, `${path}/model`, "model", issues),
      role: optionalString(item.role, `${path}/role`, "role", issues),
      site: optionalString(item.site, `${path}/site`, "site", issues),
      managementIp: optionalString(item.managementIp, `${path}/managementIp`, "managementIp", issues),
      diagram,
    });
  });
  return ok && !issues.some((issue) => issue.path.startsWith("/devices/")) ? devices : null;
}

function readInterfaces(value: unknown, issues: SchemaIssue[]): NetworkInterface[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path: "/interfaces", message: "interfaces must be an array." });
    return null;
  }
  const interfaces: NetworkInterface[] = [];
  let ok = true;
  value.forEach((item, index) => {
    const path = `/interfaces/${index}`;
    if (!isRecord(item)) {
      issues.push({ path, message: "must be an object." });
      ok = false;
      return;
    }
    rejectUnknown(item, INTERFACE_FIELDS, path, issues);
    const device = requiredString(item.device, `${path}/device`, "device", issues);
    const name = requiredString(item.name, `${path}/name`, "name", issues);
    const adminStatus = statusOf(item.adminStatus, `${path}/adminStatus`, "adminStatus", issues);
    const operStatus = statusOf(item.operStatus, `${path}/operStatus`, "operStatus", issues);
    const ipv4 = item.ipv4 == null ? [] : readAddresses(item.ipv4, `${path}/ipv4`, "ipv4", issues);
    const ipv6 = item.ipv6 == null ? [] : readAddresses(item.ipv6, `${path}/ipv6`, "ipv6", issues);
    const mode = switchportOf(item.switchportMode, `${path}/switchportMode`, issues);
    const accessVlan = item.accessVlan == null ? null : vlanId(item.accessVlan, `${path}/accessVlan`, issues);
    const nativeVlan = item.nativeVlan == null ? null : vlanId(item.nativeVlan, `${path}/nativeVlan`, issues);
    const trunkVlans = item.trunkVlans == null ? null : readVlanList(item.trunkVlans, `${path}/trunkVlans`, issues);
    if (!device || !name || adminStatus == null || operStatus == null || !ipv4 || !ipv6 || mode == null) {
      ok = false;
      return;
    }
    if ((item.accessVlan != null && accessVlan == null) || (item.nativeVlan != null && nativeVlan == null)) ok = false;
    if (item.trunkVlans != null && !trunkVlans) ok = false;
    interfaces.push({
      device,
      name,
      description: optionalString(item.description, `${path}/description`, "description", issues),
      speed: optionalString(item.speed, `${path}/speed`, "speed", issues),
      adminStatus,
      operStatus,
      ipv4,
      ipv6,
      vrf: optionalString(item.vrf, `${path}/vrf`, "vrf", issues),
      switchportMode: mode,
      accessVlan,
      trunkVlans,
      nativeVlan,
      lag: optionalString(item.lag, `${path}/lag`, "lag", issues),
    });
  });
  return ok ? interfaces : null;
}

function readAddresses(
  value: unknown,
  path: string,
  family: "ipv4" | "ipv6",
  issues: SchemaIssue[],
): NetworkAddress[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path, message: `${family} must be an array.` });
    return null;
  }
  const max = family === "ipv4" ? 32 : 128;
  const addresses: NetworkAddress[] = [];
  let ok = true;
  value.forEach((item, index) => {
    const itemPath = `${path}/${index}`;
    if (!isRecord(item)) {
      issues.push({ path: itemPath, message: "must be an object with address and prefix." });
      ok = false;
      return;
    }
    rejectUnknown(item, ADDRESS_FIELDS, itemPath, issues);
    const address = requiredString(item.address, `${itemPath}/address`, "address", issues);
    const prefixOk = Number.isInteger(item.prefix) && (item.prefix as number) >= 0 && (item.prefix as number) <= max;
    if (!prefixOk) {
      issues.push({ path: `${itemPath}/prefix`, message: `prefix must be an integer from 0 to ${max}.` });
      ok = false;
    }
    if (!address) {
      ok = false;
      return;
    }
    if (!canonicalIp(address, family)) {
      issues.push({
        path: `${itemPath}/address`,
        message: family === "ipv4" ? "address must be an IPv4 address." : "address must be an IPv6 address.",
      });
      ok = false;
      return;
    }
    if (prefixOk) addresses.push({ address, prefix: item.prefix as number });
  });
  return ok ? addresses : null;
}

function readLinks(value: unknown, issues: SchemaIssue[]): NetworkLink[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path: "/links", message: "links must be an array." });
    return null;
  }
  const links: NetworkLink[] = [];
  let ok = true;
  value.forEach((item, index) => {
    const path = `/links/${index}`;
    if (!isRecord(item)) {
      issues.push({ path, message: "must be an object with a and b." });
      ok = false;
      return;
    }
    rejectUnknown(item, LINK_FIELDS, path, issues);
    const a = readEndpoint(item.a, `${path}/a`, issues);
    const b = readEndpoint(item.b, `${path}/b`, issues);
    if (!a || !b) {
      ok = false;
      return;
    }
    const inferred = optionalFlag(item.inferred, `${path}/inferred`, "inferred", issues);
    if (inferred == null) {
      ok = false;
      return;
    }
    links.push({
      a,
      b,
      label: optionalString(item.label, `${path}/label`, "label", issues),
      inferred,
    });
  });
  return ok ? links : null;
}

function readEndpoint(value: unknown, path: string, issues: SchemaIssue[]): NetworkEndpoint | null {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object with device and interface." });
    return null;
  }
  rejectUnknown(value, ENDPOINT_FIELDS, path, issues);
  const device = requiredString(value.device, `${path}/device`, "device", issues);
  const iface = requiredString(value.interface, `${path}/interface`, "interface", issues);
  if (!device || !iface) return null;
  return { device, interface: iface };
}

function readVlanList(value: unknown, path: string, issues: SchemaIssue[]): number[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "trunkVlans must be an array of VLAN ids." });
    return null;
  }
  const ids: number[] = [];
  let ok = true;
  value.forEach((item, index) => {
    const id = vlanId(item, `${path}/${index}`, issues);
    if (id == null) ok = false;
    else ids.push(id);
  });
  return ok ? ids : null;
}

function readVlans(value: unknown, issues: SchemaIssue[]): NetworkVlan[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path: "/vlans", message: "vlans must be an array." });
    return null;
  }
  const vlans: NetworkVlan[] = [];
  const seen = new Set<number>();
  let ok = true;
  value.forEach((item, index) => {
    const path = `/vlans/${index}`;
    if (!isRecord(item)) {
      issues.push({ path, message: "must be an object." });
      ok = false;
      return;
    }
    rejectUnknown(item, VLAN_FIELDS, path, issues);
    const id = vlanId(item.id, `${path}/id`, issues);
    if (id == null) {
      ok = false;
      return;
    }
    if (seen.has(id)) issues.push({ path: `${path}/id`, message: `duplicate VLAN ${id}.` });
    seen.add(id);
    vlans.push({ id, name: optionalString(item.name, `${path}/name`, "name", issues) });
  });
  return ok ? vlans : null;
}

function readNeighbors(value: unknown, issues: SchemaIssue[]): NetworkDocument["neighbors"] | null {
  if (value == null) return { cdp: "", lldp: "", localDevice: "" };
  if (!isRecord(value)) {
    issues.push({ path: "/neighbors", message: "neighbors must be an object." });
    return null;
  }
  rejectUnknown(value, NEIGHBOR_FIELDS, "/neighbors", issues);
  return {
    cdp: optionalString(value.cdp, "/neighbors/cdp", "cdp", issues),
    lldp: optionalString(value.lldp, "/neighbors/lldp", "lldp", issues),
    localDevice: optionalString(value.localDevice, "/neighbors/localDevice", "localDevice", issues),
  };
}

function statusOf(value: unknown, path: string, label: string, issues: SchemaIssue[]): "" | "up" | "down" | null {
  if (value == null || value === "") return "";
  if (value === "up" || value === "down") return value;
  issues.push({ path, message: `${label} must be up or down.` });
  return null;
}

function switchportOf(value: unknown, path: string, issues: SchemaIssue[]): "" | "access" | "trunk" | null {
  if (value == null || value === "") return "";
  if (value === "access" || value === "trunk") return value;
  issues.push({ path, message: "switchportMode must be access or trunk." });
  return null;
}

function vlanId(value: unknown, path: string, issues: SchemaIssue[]): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4094) return value;
  issues.push({ path, message: "must be an integer from 1 to 4094." });
  return null;
}

function requiredString(value: unknown, path: string, label: string, issues: SchemaIssue[]): string {
  if (typeof value !== "string" || !value.trim()) {
    issues.push({ path, message: `${label} is required.` });
    return "";
  }
  return value.trim();
}

function childDiagram(value: unknown, path: string, issues: SchemaIssue[]): string | null {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    issues.push({ path, message: "diagram must be a string." });
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/[\u0000-\u001f"\\?#]/.test(trimmed) || clickTargetKind(trimmed) === "unsafe" || clickTargetKind(trimmed) === "external") {
    issues.push({ path, message: "diagram must be a workspace .mmd path." });
    return null;
  }
  const resolved = resolveDiagramTarget(trimmed, "");
  if (!resolved.ok) {
    issues.push({ path, message: "diagram must be a workspace .mmd path." });
    return null;
  }
  return resolved.path;
}

function optionalFlag(value: unknown, path: string, label: string, issues: SchemaIssue[]): boolean | null {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  issues.push({ path, message: `${label} must be a boolean.` });
  return null;
}

function optionalString(value: unknown, path: string, label: string, issues: SchemaIssue[]): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    issues.push({ path, message: `${label} must be a string.` });
    return "";
  }
  return value.trim();
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, issues: SchemaIssue[]): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    issues.push({ path: path ? `${path}/${key}` : `/${key}`, message: `unexpected property "${key}".` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
