import type { NetworkDevice, NetworkInterface, NetworkLink, NetworkVlan } from "../network/types.js";
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
  nestedText,
  noteUnmapped,
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
import type { CanonicalAddress, TranslatorModule, TranslatorResult, TranslatorWarning } from "./types.js";

/**
 * Saved Nautobot REST list payloads. Nautobot 2 uses location, not site.
 * Cable ends are termination_a / termination_b, a terminations map, or
 * a_terminations / b_terminations. Interface addresses come from
 * ip-address-to-interface rows. Nothing in this file calls Nautobot.
 */

const DEVICE_USED = new Set([
  "id",
  "name",
  "device_type",
  "platform",
  "role",
  "device_role",
  "location",
  "site",
  "primary_ip",
  "primary_ip4",
  "status",
  "url",
  "display",
  "object_type",
]);
const INTERFACE_USED = new Set([
  "id",
  "device",
  "name",
  "description",
  "enabled",
  "speed",
  "mode",
  "untagged_vlan",
  "tagged_vlans",
  "lag",
  "vrf",
  "status",
  "url",
  "display",
  "type",
  "object_type",
]);
const CABLE_USED = new Set([
  "id",
  "label",
  "status",
  "url",
  "display",
  "type",
  "object_type",
  "terminations",
  "a_terminations",
  "b_terminations",
  "termination_a",
  "termination_b",
  "termination_a_type",
  "termination_a_id",
  "termination_b_type",
  "termination_b_id",
]);
const IP_USED = new Set([
  "id",
  "address",
  "ip_address",
  "interface",
  "interfaces",
  "vm_interface",
  "assigned_object_type",
  "assigned_object_id",
  "assigned_object",
  "object_type",
  "display",
  "url",
  "status",
]);
const VLAN_USED = new Set(["id", "vid", "name", "display", "url", "status", "object_type"]);

type Ref = { device: string; name: string };

function bareRef(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return /^\d+$/.test(text) || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(text);
}

function takeSection(warnings: TranslatorWarning[], value: unknown, label: string): unknown[] | null {
  const section = sectionList(value, ["results", label]);
  if (!section.present) return null;
  if (section.next) pushWarning(warnings, `/${label}`, `Ignored next page URL on ${label}. NerdGram does not fetch it.`);
  if (section.bad) {
    pushWarning(warnings, `/${label}`, `${label} is not a list or a results envelope.`);
    return [];
  }
  return section.items;
}

function readRoot(input: Record<string, unknown>, warnings: TranslatorWarning[]) {
  const ipKey = ["ip-address-to-interface", "ip_address_to_interface", "ip-addresses", "ip_addresses"].find((key) => key in input);
  if (["devices", "interfaces", "cables", "vlans"].some((key) => key in input) || ipKey) {
    return {
      devices: takeSection(warnings, input.devices, "devices") ?? [],
      interfaces: takeSection(warnings, input.interfaces, "interfaces") ?? [],
      cables: takeSection(warnings, input.cables, "cables") ?? [],
      vlans: takeSection(warnings, input.vlans, "vlans") ?? [],
      ips: takeSection(warnings, ipKey ? input[ipKey] : undefined, ipKey ?? "ip-addresses") ?? [],
    };
  }
  const section = sectionList(input, ["results"]);
  if (section.next) pushWarning(warnings, "", "Ignored next page URL. NerdGram does not fetch it.");
  const first = section.items.find(isRecord);
  if (!first) return { devices: [], interfaces: [], cables: [], vlans: [], ips: [] };
  if ("termination_a" in first || "terminations" in first || "a_terminations" in first) {
    return { devices: [], interfaces: [], cables: section.items, vlans: [], ips: [] };
  }
  if ("vid" in first && first.device == null) return { devices: [], interfaces: [], cables: [], vlans: section.items, ips: [] };
  if (first.device != null && first.device_type == null && first.location == null && first.primary_ip4 == null) {
    return { devices: [], interfaces: section.items, cables: [], vlans: [], ips: [] };
  }
  return { devices: section.items, interfaces: [], cables: [], vlans: [], ips: [] };
}

function managementAddress(value: unknown, warnings: TranslatorWarning[], path: string): string {
  if (value == null) return "";
  if (bareRef(value)) {
    pushWarning(warnings, path, "primary IP was not expanded, so managementIp was left empty.");
    return "";
  }
  if (!isRecord(value)) return "";
  return hostAddress(value.address);
}

function mapDevices(items: unknown[], warnings: TranslatorWarning[]) {
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
    const name = textOf(item.name);
    if (!name) {
      pushWarning(warnings, pointer, "Skipped a device with no name.");
      return;
    }
    if (seen.has(name.toLowerCase())) {
      pushWarning(warnings, pointer, `Duplicate device "${name}" was skipped.`);
      return;
    }
    seen.add(name.toLowerCase());
    const location = nestedText(item.location, ["name", "display"]);
    const site = nestedText(item.site, ["name", "display"]);
    if (!location && site) {
      pushWarning(warnings, `${pointer}/site`, `Device ${name} has site and no location. site was used as the location.`);
    }
    if (bareRef(item.device_type)) {
      pushWarning(warnings, `${pointer}/device_type`, `Device ${name} device_type was not expanded, so model was left empty.`);
    }
    const primary = isRecord(item.primary_ip4) || bareRef(item.primary_ip4) ? item.primary_ip4 : item.primary_ip;
    devices.push(
      blankDevice(name, {
        model: nestedText(item.device_type, ["model", "display"]),
        platform: nestedText(item.platform, ["name", "display"]),
        role: nestedText(isRecord(item.role) ? item.role : item.device_role, ["name", "display"]),
        site: location || site,
        managementIp: managementAddress(primary, warnings, `${pointer}/primary_ip4`),
      }),
    );
    const id = idKey(item.id);
    if (id) ids.set(id, name);
  });
  return { devices, ids };
}

function resolveDevice(value: unknown, ids: Map<string, string>): string {
  if (isRecord(value)) {
    const named = textOf(value.name) || textOf(value.display);
    if (named) return named;
    const id = idKey(value.id);
    return id && ids.has(id) ? ids.get(id) ?? "" : "";
  }
  const id = idKey(value);
  return id && ids.has(id) ? ids.get(id) ?? "" : "";
}

function mapInterfaces(items: unknown[], deviceIds: Map<string, string>, warnings: TranslatorWarning[]) {
  const interfaces: NetworkInterface[] = [];
  const byId = new Map<string, Ref>();
  items.forEach((item, index) => {
    const pointer = `/interfaces/${index}`;
    if (!isRecord(item)) {
      pushWarning(warnings, pointer, "Skipped an interface that is not an object.");
      return;
    }
    noteUnmapped(warnings, pointer, item, INTERFACE_USED, "interface");
    const device = resolveDevice(item.device, deviceIds);
    const name = textOf(item.name);
    if (!device || !name) {
      pushWarning(warnings, pointer, "Skipped an interface with no device or name.");
      return;
    }
    const mode = textOf(item.mode).toLowerCase();
    const untagged = vlanId(isRecord(item.untagged_vlan) ? item.untagged_vlan.vid : undefined);
    let switchportMode: "" | "access" | "trunk" = "";
    let accessVlan: number | null = null;
    let nativeVlan: number | null = null;
    let trunkVlans: number[] | null = null;
    if (mode === "access") {
      switchportMode = "access";
      accessVlan = untagged;
    } else if (mode === "tagged" || mode === "tagged-all") {
      switchportMode = "trunk";
      nativeVlan = untagged;
      trunkVlans = [];
      if (Array.isArray(item.tagged_vlans)) {
        for (const vlan of item.tagged_vlans) {
          const id = vlanId(isRecord(vlan) ? vlan.vid : undefined);
          if (id != null && !trunkVlans.includes(id)) trunkVlans.push(id);
        }
      }
      if (mode === "tagged-all" && trunkVlans.length === 0) {
        pushWarning(warnings, pointer, `Interface ${name} is tagged-all with no VLAN ids.`);
      }
    } else if (mode && mode !== "q-in-q") {
      pushWarning(warnings, `${pointer}/mode`, `Interface mode "${mode}" was not mapped.`);
    } else if (mode === "q-in-q") {
      pushWarning(warnings, `${pointer}/mode`, "q-in-q was not mapped.");
    }
    const admin = statusUpDown(item.enabled);
    const speed = formatRate(typeof item.speed === "number" ? item.speed : Number(textOf(item.speed)), "kbps");
    interfaces.push(
      blankInterface(device, name, {
        description: textOf(item.description),
        speed,
        adminStatus: admin === "up" || admin === "down" ? admin : "",
        vrf: nestedText(item.vrf, ["name", "display"]),
        switchportMode,
        accessVlan,
        nativeVlan,
        trunkVlans,
        lag: nestedText(item.lag, ["name", "display"]),
      }),
    );
    const id = idKey(item.id);
    if (id) byId.set(id, { device, name });
  });
  return { interfaces, byId };
}

function addressText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return textOf(value.address) || textOf(value.display).split(/\s+/)[0] || "";
}

function assignAddresses(items: unknown[], interfaces: NetworkInterface[], byId: Map<string, Ref>, warnings: TranslatorWarning[]) {
  items.forEach((item, index) => {
    const pointer = `/ip-addresses/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, IP_USED, "address");
    const cidr = splitCidr(addressText(item.address) || addressText(item.ip_address) || addressText(item));
    if (!cidr) {
      if (bareRef(item.ip_address) || bareRef(item.address)) {
        pushWarning(warnings, pointer, "IP address was not expanded, so it was skipped.");
      }
      return;
    }
    const targets: Ref[] = [];
    const iface = isRecord(item.interface) ? item.interface : item.assigned_object;
    const direct = byId.get(idKey(isRecord(iface) ? iface.id : iface)) ?? byId.get(idKey(item.assigned_object_id));
    if (direct) targets.push(direct);
    if (Array.isArray(item.interfaces)) {
      for (const entry of item.interfaces) {
        const ref = byId.get(idKey(isRecord(entry) ? entry.id : entry));
        if (ref) targets.push(ref);
      }
    }
    if (targets.length === 0) {
      pushWarning(warnings, pointer, "IP address did not name an interface in this export, so it was skipped.");
      return;
    }
    const stored: CanonicalAddress = { address: cidr.address, prefix: cidr.prefix };
    for (const target of targets) {
      const row = interfaces.find((entry) => entry.device === target.device && entry.name === target.name);
      if (!row) continue;
      const list = cidr.family === "ipv4" ? row.ipv4 : row.ipv6;
      if (!list.some((entry) => entry.address === stored.address && entry.prefix === stored.prefix)) list.push(stored);
    }
  });
}

function slots(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((item) => item != null);
  if (!isRecord(value)) return [value];
  return Object.values(value).filter((item) => item != null);
}

function cableSides(row: Record<string, unknown>): { a: unknown[]; b: unknown[] } {
  if ("a_terminations" in row || "b_terminations" in row) {
    return { a: slots(row.a_terminations), b: slots(row.b_terminations) };
  }
  if (isRecord(row.terminations)) {
    return { a: slots(row.terminations.a), b: slots(row.terminations.b) };
  }
  return { a: slots(row.termination_a), b: slots(row.termination_b) };
}

function endRef(item: unknown, byId: Map<string, Ref>): Ref | "other" | null {
  if (!isRecord(item)) return null;
  const type = textOf(item.object_type) || textOf(item.termination_type);
  if (type && type !== "dcim.interface") return "other";
  const object = isRecord(item.object) ? item.object : isRecord(item.interface) ? item.interface : item;
  const nested = byId.get(idKey(object.id)) ?? byId.get(idKey(item.object_id)) ?? byId.get(idKey(item.id));
  if (nested && (type === "dcim.interface" || !type)) return nested;
  const device = nestedText(isRecord(object.device) ? object.device : item.device, ["name", "display"]);
  const name = textOf(object.name);
  if (device && name && (!type || type === "dcim.interface")) return { device, name };
  if (type && type !== "dcim.interface") return "other";
  return null;
}

function mapCables(items: unknown[], byId: Map<string, Ref>, warnings: TranslatorWarning[]): NetworkLink[] {
  const links: NetworkLink[] = [];
  items.forEach((item, index) => {
    const pointer = `/cables/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, CABLE_USED, "cable");
    const sides = cableSides(item);
    const ends = [sides.a, sides.b].map((side) => side.map((entry) => endRef(entry, byId)));
    if (ends.some((side) => side.includes("other"))) return;
    const [left, right] = ends.map((side) => side.filter((entry): entry is Ref => entry != null && entry !== "other"));
    if (!left || !right || left.length !== 1 || right.length !== 1) {
      pushWarning(warnings, pointer, "Cable was skipped because both ends are not a single interface.");
      return;
    }
    const a = left[0];
    const b = right[0];
    if (!a || !b) return;
    links.push(blankLink(a.device, a.name, b.device, b.name, textOf(item.label)));
  });
  return dedupeLinks(links);
}

function mapVlans(items: unknown[], warnings: TranslatorWarning[]): NetworkVlan[] {
  const vlans: NetworkVlan[] = [];
  const seen = new Set<number>();
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    noteUnmapped(warnings, `/vlans/${index}`, item, VLAN_USED, "VLAN");
    const id = vlanId(item.vid);
    if (id == null || seen.has(id)) return;
    seen.add(id);
    vlans.push({ id, name: textOf(item.name) });
  });
  return vlans;
}

function convertNautobot(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A Nautobot export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const root = readRoot(input, warnings);
  const mapped = mapDevices(root.devices, warnings);
  const ports = mapInterfaces(root.interfaces, mapped.ids, warnings);
  assignAddresses(root.ips, ports.interfaces, ports.byId, warnings);
  const links = mapCables(root.cables, ports.byId, warnings);
  ensureLinkEnds(mapped.devices, ports.interfaces, links);
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: mapped.devices, interfaces: ports.interfaces, links, vlans: mapVlans(root.vlans, warnings) }),
    warnings: sortWarnings(warnings),
  };
}

const nautobot: TranslatorModule = {
  id: "nautobot",
  name: "Nautobot",
  formatHint: "Saved Nautobot REST export (devices, interfaces, cables)",
  placeholder: `{
  "devices": { "results": [ { "name": "core-rtr", "location": { "name": "hq" } } ] },
  "interfaces": { "results": [] },
  "cables": { "results": [] }
}`,
  convert: convertNautobot,
};

export default nautobot;
