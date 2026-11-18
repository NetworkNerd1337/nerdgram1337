import { canonicalIp } from "../network/ip.js";
import type { NetworkDevice, NetworkInterface, NetworkLink, NetworkVlan } from "../network/types.js";
import type {
  CanonicalAddress,
  CanonicalDevice,
  CanonicalDocument,
  CanonicalInterface,
  CanonicalLink,
  CanonicalVlan,
  TranslatorWarning,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function pushWarning(warnings: TranslatorWarning[], path: string, message: string): void {
  if (warnings.some((item) => item.message === message)) return;
  warnings.push({ path, message });
}

export function noteUnmapped(
  warnings: TranslatorWarning[],
  pointer: string,
  record: Record<string, unknown>,
  used: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(record).sort()) {
    if (used.has(key)) continue;
    pushWarning(warnings, `${pointer}/${key}`, `Ignored unmapped ${label} field "${key}".`);
  }
}

export function integerLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

export function numberLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Join key for numeric ids and the string ids some APIs return. */
export function idKey(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

export function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function nestedText(value: unknown, keys: readonly string[]): string {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  for (const key of keys) {
    const item = textOf(value[key]);
    if (item) return item;
  }
  return "";
}

/** A related object that was not expanded past its id. */
export function collapsedRef(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  return typeof value === "string" && /^\d+$/.test(value.trim());
}

export type SectionList = {
  present: boolean;
  items: unknown[];
  next: string;
  bad: boolean;
};

/**
 * A section is a raw array, a NetBox envelope (`results`), or a named array
 * (`devices`, `ports`, `links`). `next` is a page URL that must not be fetched.
 */
export function sectionList(value: unknown, keys: readonly string[]): SectionList {
  if (value == null) return { present: false, items: [], next: "", bad: false };
  if (Array.isArray(value)) return { present: true, items: value, next: "", bad: false };
  if (!isRecord(value)) return { present: true, items: [], next: "", bad: true };
  const next = textOf(value.next);
  if (Array.isArray(value.results)) return { present: true, items: value.results, next, bad: false };
  for (const key of keys) {
    if (Array.isArray(value[key])) return { present: true, items: value[key] as unknown[], next, bad: false };
  }
  return { present: true, items: [], next, bad: true };
}

export function splitCidr(value: string): { address: string; prefix: number; family: "ipv4" | "ipv6" } | null {
  const text = value.trim();
  const slash = text.lastIndexOf("/");
  if (slash <= 0) return null;
  const rawAddress = text.slice(0, slash).trim();
  const prefix = Number(text.slice(slash + 1));
  if (!Number.isInteger(prefix)) return null;
  const family = rawAddress.includes(":") ? "ipv6" : "ipv4";
  const max = family === "ipv4" ? 32 : 128;
  if (prefix < 0 || prefix > max) return null;
  const address = canonicalIp(rawAddress, family);
  if (!address) return null;
  return { address, prefix, family };
}

/** An IPv4 or IPv6 address, or the host half of a CIDR. Empty when the text is not an address. */
export function hostAddress(value: unknown): string {
  const text = textOf(value);
  if (!text) return "";
  const cidr = splitCidr(text);
  if (cidr) return cidr.address;
  return canonicalIp(text, text.includes(":") ? "ipv6" : "ipv4") ?? "";
}

/**
 * Short speed text. `kbps` is kilobits per second: 10000000 becomes `10G`.
 * `bps` is bits per second: 10000000000 becomes `10G`.
 * The unit is the largest one that divides evenly.
 */
export function formatRate(value: number, unit: "bps" | "kbps"): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const bps = unit === "kbps" ? value * 1000 : value;
  if (!Number.isFinite(bps) || bps <= 0) return "";
  const steps: { div: number; suffix: string }[] = [
    { div: 1_000_000_000_000, suffix: "T" },
    { div: 1_000_000_000, suffix: "G" },
    { div: 1_000_000, suffix: "M" },
    { div: 1_000, suffix: "K" },
  ];
  for (const step of steps) {
    if (bps >= step.div && bps % step.div === 0) return `${bps / step.div}${step.suffix}`;
  }
  if (bps % 1 === 0) return String(bps);
  return "";
}

export function statusUpDown(value: unknown): "" | "up" | "down" | "other" {
  if (value == null || value === "") return "";
  if (value === true || value === 1 || value === "1") return "up";
  if (value === false || value === 0 || value === "0") return "down";
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "up") return "up";
    if (text === "down") return "down";
    if (!text) return "";
  }
  return "other";
}

export function blankDevice(name: string, extra: Partial<NetworkDevice> = {}): NetworkDevice {
  return {
    platform: "",
    model: "",
    role: "",
    site: "",
    managementIp: "",
    diagram: "",
    ...extra,
    name,
  };
}

export function blankInterface(device: string, name: string, extra: Partial<NetworkInterface> = {}): NetworkInterface {
  return {
    description: "",
    speed: "",
    adminStatus: "",
    operStatus: "",
    ipv4: [],
    ipv6: [],
    vrf: "",
    switchportMode: "",
    accessVlan: null,
    trunkVlans: null,
    nativeVlan: null,
    lag: "",
    ...extra,
    device,
    name,
  };
}

export function blankLink(aDevice: string, aInterface: string, bDevice: string, bInterface: string, label = ""): NetworkLink {
  return {
    a: { device: aDevice, interface: aInterface },
    b: { device: bDevice, interface: bInterface },
    label,
  };
}

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function cleanAddress(address: CanonicalAddress): CanonicalAddress | null {
  const family = address.address.includes(":") ? "ipv6" : "ipv4";
  const canonical = canonicalIp(address.address, family);
  if (!canonical) return null;
  if (!Number.isInteger(address.prefix)) return null;
  return { address: canonical, prefix: address.prefix };
}

function publishDevice(device: NetworkDevice): CanonicalDevice {
  const out: CanonicalDevice = { name: device.name };
  if (device.platform) out.platform = device.platform;
  if (device.model) out.model = device.model;
  if (device.role) out.role = device.role;
  if (device.site) out.site = device.site;
  if (device.managementIp) out.managementIp = device.managementIp;
  if (device.diagram) out.diagram = device.diagram;
  return out;
}

function publishInterface(item: NetworkInterface): CanonicalInterface {
  const out: CanonicalInterface = { device: item.device, name: item.name };
  if (item.description) out.description = item.description;
  if (item.speed) out.speed = item.speed;
  if (item.adminStatus) out.adminStatus = item.adminStatus;
  if (item.operStatus) out.operStatus = item.operStatus;
  const ipv4 = item.ipv4.map(cleanAddress).filter((address): address is CanonicalAddress => address != null);
  const ipv6 = item.ipv6.map(cleanAddress).filter((address): address is CanonicalAddress => address != null);
  if (ipv4.length > 0) out.ipv4 = ipv4;
  if (ipv6.length > 0) out.ipv6 = ipv6;
  if (item.vrf) out.vrf = item.vrf;
  if (item.switchportMode) out.switchportMode = item.switchportMode;
  if (item.accessVlan != null) out.accessVlan = item.accessVlan;
  if (item.trunkVlans) out.trunkVlans = [...item.trunkVlans];
  if (item.nativeVlan != null) out.nativeVlan = item.nativeVlan;
  if (item.lag) out.lag = item.lag;
  return out;
}

function publishLink(link: NetworkLink): CanonicalLink {
  const out: CanonicalLink = {
    a: { device: link.a.device, interface: link.a.interface },
    b: { device: link.b.device, interface: link.b.interface },
  };
  if (link.label) out.label = link.label;
  return out;
}

function publishVlan(vlan: NetworkVlan): CanonicalVlan {
  const out: CanonicalVlan = { id: vlan.id };
  if (vlan.name) out.name = vlan.name;
  return out;
}

/** Drop empty optional fields and sort so the same export always writes the same document. */
export function publishDocument(document: {
  devices: NetworkDevice[];
  interfaces: NetworkInterface[];
  links: NetworkLink[];
  vlans: NetworkVlan[];
}): CanonicalDocument {
  const devices = [...document.devices].sort((a, b) => cmp(a.name, b.name)).map(publishDevice);
  const interfaces = [...document.interfaces]
    .sort((a, b) => cmp(a.device, b.device) || cmp(a.name, b.name))
    .map(publishInterface);
  const links = [...document.links]
    .sort(
      (a, b) =>
        cmp(a.a.device, b.a.device) ||
        cmp(a.a.interface, b.a.interface) ||
        cmp(a.b.device, b.b.device) ||
        cmp(a.b.interface, b.b.interface) ||
        cmp(a.label, b.label),
    )
    .map(publishLink);
  const vlans = [...document.vlans].sort((a, b) => a.id - b.id).map(publishVlan);
  return { schemaVersion: 1, format: "network", devices, interfaces, links, vlans };
}

export function linkKey(link: NetworkLink): string {
  const left = `${link.a.device.toLowerCase()}\0${link.a.interface}`;
  const right = `${link.b.device.toLowerCase()}\0${link.b.interface}`;
  return left < right ? `${left}\0${right}` : `${right}\0${left}`;
}

export function dedupeLinks(links: NetworkLink[]): NetworkLink[] {
  const seen = new Set<string>();
  const out: NetworkLink[] = [];
  for (const link of links) {
    if (!link.a.device || !link.a.interface || !link.b.device || !link.b.interface) continue;
    if (link.a.device.toLowerCase() === link.b.device.toLowerCase() && link.a.interface === link.b.interface) continue;
    const key = linkKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

export function sortWarnings(warnings: TranslatorWarning[]): TranslatorWarning[] {
  return [...warnings].sort((a, b) => cmp(a.path, b.path) || cmp(a.message, b.message));
}

export function vlanId(value: unknown): number | null {
  const id = integerLike(value);
  if (id == null || id < 1 || id > 4094) return null;
  return id;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
