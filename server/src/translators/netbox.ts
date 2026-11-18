import type { NetworkDevice, NetworkInterface, NetworkLink, NetworkVlan } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  collapsedRef,
  dedupeLinks,
  formatRate,
  hostAddress,
  idKey,
  isRecord,
  nestedText,
  noteUnmapped,
  plural,
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
 * Saved NetBox REST list payloads. Interface `speed` is kilobits per second
 * (the interface model calls it kbps): 10000000 is 10G. `role` is the current
 * device field. Older exports use `device_role`. Cables use `a_terminations`
 * and `b_terminations`. Older exports use `termination_a` and `termination_b`.
 * Nothing in this file calls NetBox.
 */

const DEVICE_USED = new Set(["id", "name", "device_type", "platform", "role", "device_role", "site", "primary_ip", "primary_ip4"]);
const INTERFACE_USED = new Set(["id", "device", "name", "description", "enabled", "speed", "mode", "untagged_vlan", "tagged_vlans", "lag", "vrf"]);
const CABLE_USED = new Set([
  "id",
  "label",
  "a_terminations",
  "b_terminations",
  "termination_a_type",
  "termination_a_id",
  "termination_a",
  "termination_b_type",
  "termination_b_id",
  "termination_b",
]);
const IP_USED = new Set(["id", "address", "vrf", "assigned_object_type", "assigned_object_id", "assigned_object", "family"]);
const VLAN_USED = new Set(["id", "vid", "name", "display"]);
const RESOURCE_KEYS = ["devices", "interfaces", "cables", "vlans", "ip-addresses", "ip_addresses"] as const;

type Ref = { device: string; name: string };
type Buckets = { devices: unknown[]; interfaces: unknown[]; cables: unknown[]; vlans: unknown[]; ips: unknown[] };

function classifyRow(row: Record<string, unknown>): keyof Buckets | "unknown" {
  if ("a_terminations" in row || "b_terminations" in row || "termination_a" in row || "termination_b" in row || "termination_a_type" in row || "termination_b_type" in row) {
    return "cables";
  }
  if (row.assigned_object_type != null || (typeof row.address === "string" && "assigned_object_id" in row)) return "ips";
  if ("vid" in row && row.device == null && row.device_type == null) return "vlans";
  if (row.device != null && row.device_type == null && row.primary_ip == null && row.primary_ip4 == null) return "interfaces";
  if (row.device_type != null || row.device_role != null || row.role != null || row.primary_ip != null || row.primary_ip4 != null || row.site != null || typeof row.name === "string") {
    return "devices";
  }
  return "unknown";
}

function takeSection(warnings: TranslatorWarning[], value: unknown, label: string): unknown[] | null {
  const section = sectionList(value, ["results", label, "ip_addresses", "ip-addresses"]);
  if (!section.present) return null;
  if (section.next) pushWarning(warnings, `/${label}`, `Ignored next page URL on ${label}. NerdGram does not fetch it.`);
  if (section.bad) {
    pushWarning(warnings, `/${label}`, `${label} is not a list or a NetBox results envelope.`);
    return [];
  }
  return section.items;
}

function readBuckets(input: Record<string, unknown>, warnings: TranslatorWarning[]): Buckets {
  const buckets: Buckets = { devices: [], interfaces: [], cables: [], vlans: [], ips: [] };
  if (RESOURCE_KEYS.some((key) => key in input)) {
    buckets.devices = takeSection(warnings, input.devices, "devices") ?? [];
    buckets.interfaces = takeSection(warnings, input.interfaces, "interfaces") ?? [];
    buckets.cables = takeSection(warnings, input.cables, "cables") ?? [];
    buckets.vlans = takeSection(warnings, input.vlans, "vlans") ?? [];
    buckets.ips = takeSection(warnings, input["ip-addresses"] ?? input.ip_addresses, "ip-addresses") ?? [];
    if ("results" in input) pushWarning(warnings, "/results", "Top-level results were ignored because the export names its resources.");
    return buckets;
  }
  const section = sectionList(input, ["results"]);
  if (section.next) pushWarning(warnings, "", "Ignored next page URL. NerdGram does not fetch it.");
  const first = section.items.find(isRecord);
  if (!first) {
    pushWarning(warnings, "", "This export has no devices, interfaces, or cables.");
    return buckets;
  }
  const kind = classifyRow(first);
  if (kind === "unknown") {
    pushWarning(warnings, "/results", "This results list is not devices, interfaces, cables, addresses, or VLANs.");
    return buckets;
  }
  buckets[kind] = section.items;
  return buckets;
}

function managementAddress(value: unknown, warnings: TranslatorWarning[], path: string, label: string): string {
  if (value == null) return "";
  if (collapsedRef(value)) {
    pushWarning(warnings, path, `${label} was not expanded, so managementIp was left empty.`);
    return "";
  }
  if (!isRecord(value)) return "";
  const address = hostAddress(value.address);
  if (!address && textOf(value.address)) pushWarning(warnings, path, `${label} address is not an IP, so managementIp was left empty.`);
  return address;
}

function mapDevices(items: unknown[], warnings: TranslatorWarning[]): { devices: NetworkDevice[]; ids: Map<string, string> } {
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
    if (collapsedRef(item.device_type)) {
      pushWarning(warnings, `${pointer}/device_type`, `Device ${name} device_type was not expanded, so model was left empty.`);
    }
    const roleRecord = isRecord(item.role) ? item.role : isRecord(item.device_role) ? item.device_role : null;
    if (!roleRecord && (collapsedRef(item.role) || collapsedRef(item.device_role))) {
      pushWarning(warnings, `${pointer}/role`, `Device ${name} role was not expanded, so role was left empty.`);
    }
    const primaryRecord = isRecord(item.primary_ip4) || collapsedRef(item.primary_ip4) ? item.primary_ip4 : item.primary_ip;
    const primaryLabel = isRecord(item.primary_ip4) || collapsedRef(item.primary_ip4) ? "primary_ip4" : "primary_ip";
    devices.push(
      blankDevice(name, {
        model: nestedText(item.device_type, ["model", "display"]),
        platform: nestedText(item.platform, ["name", "display"]),
        role: nestedText(roleRecord, ["name", "display"]),
        site: nestedText(item.site, ["name", "display"]),
        managementIp: managementAddress(primaryRecord, warnings, `${pointer}/${primaryLabel}`, primaryLabel),
      }),
    );
    const id = idKey(item.id);
    if (id) ids.set(id, name);
  });
  return { devices, ids };
}

function resolveDevice(value: unknown, names: Map<string, string>, ids: Map<string, string>): string {
  if (isRecord(value)) {
    const named = textOf(value.name) || textOf(value.display);
    if (named && names.has(named.toLowerCase())) return names.get(named.toLowerCase()) ?? "";
    const id = idKey(value.id);
    if (id && ids.has(id)) return ids.get(id) ?? "";
    return named;
  }
  const id = idKey(value);
  return id && ids.has(id) ? ids.get(id) ?? "" : "";
}

function taggedVlans(value: unknown, warnings: TranslatorWarning[], pointer: string): number[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    pushWarning(warnings, `${pointer}/tagged_vlans`, "tagged_vlans is not a list, so trunk VLANs were left empty.");
    return null;
  }
  const ids: number[] = [];
  let collapsed = false;
  for (const item of value) {
    if (collapsedRef(item)) {
      collapsed = true;
      continue;
    }
    const id = vlanId(isRecord(item) ? item.vid : undefined);
    if (id != null && !ids.includes(id)) ids.push(id);
  }
  if (collapsed) pushWarning(warnings, `${pointer}/tagged_vlans`, "A tagged VLAN was not expanded, so that id was skipped.");
  return ids;
}

function mapInterfaces(items: unknown[], devices: NetworkDevice[], deviceIds: Map<string, string>, warnings: TranslatorWarning[]): { interfaces: NetworkInterface[]; byId: Map<string, Ref> } {
  const names = new Map(devices.map((device) => [device.name.toLowerCase(), device.name]));
  const interfaces: NetworkInterface[] = [];
  const byId = new Map<string, Ref>();
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/interfaces/${index}`;
    if (!isRecord(item)) {
      pushWarning(warnings, pointer, "Skipped an interface that is not an object.");
      return;
    }
    noteUnmapped(warnings, pointer, item, INTERFACE_USED, "interface");
    const name = textOf(item.name);
    if (collapsedRef(item.device)) {
      pushWarning(warnings, `${pointer}/device`, `Interface ${name || String(index + 1)} device was not expanded, so the interface was skipped.`);
      return;
    }
    const device = resolveDevice(item.device, names, deviceIds);
    if (!device || !name || !names.has(device.toLowerCase())) {
      pushWarning(warnings, pointer, `Skipped interface ${name || String(index + 1)} because its device is not in this export.`);
      return;
    }
    const kept = names.get(device.toLowerCase()) ?? device;
    const pair = `${kept.toLowerCase()}\0${name}`;
    if (seen.has(pair)) {
      pushWarning(warnings, pointer, `Duplicate interface ${kept} ${name} was skipped.`);
      return;
    }
    seen.add(pair);
    const mode = textOf(item.mode);
    let switchportMode: "" | "access" | "trunk" = "";
    let accessVlan: number | null = null;
    let nativeVlan: number | null = null;
    let trunkVlans: number[] | null = null;
    const untagged = vlanId(isRecord(item.untagged_vlan) ? item.untagged_vlan.vid : undefined);
    if (mode === "access") {
      switchportMode = "access";
      accessVlan = untagged;
    } else if (mode === "tagged" || mode === "tagged-all") {
      switchportMode = "trunk";
      nativeVlan = untagged;
      trunkVlans = taggedVlans(item.tagged_vlans, warnings, pointer);
      if (mode === "tagged-all" && (trunkVlans == null || trunkVlans.length === 0)) {
        pushWarning(warnings, pointer, `Interface ${kept} ${name} is tagged-all and lists no VLAN ids, so trunkVlans was left empty.`);
        trunkVlans = [];
      }
    } else if (mode) {
      pushWarning(warnings, `${pointer}/mode`, `Interface ${kept} ${name} mode "${mode}" is not mapped, so switchport mode was left empty.`);
    }
    let speed = "";
    if (item.speed != null && item.speed !== "") {
      const parsed = typeof item.speed === "number" ? item.speed : Number(textOf(item.speed));
      if (!Number.isFinite(parsed) || parsed < 0) {
        pushWarning(warnings, `${pointer}/speed`, `Interface ${kept} ${name} speed is not a number, so speed was left empty.`);
      } else speed = formatRate(parsed, "kbps");
    }
    interfaces.push(
      blankInterface(kept, name, {
        description: textOf(item.description),
        speed,
        adminStatus: item.enabled === true ? "up" : item.enabled === false ? "down" : "",
        vrf: nestedText(item.vrf, ["name", "display"]),
        switchportMode,
        accessVlan,
        nativeVlan,
        trunkVlans,
        lag: nestedText(item.lag, ["name", "display"]),
      }),
    );
    const id = idKey(item.id);
    if (id) byId.set(id, { device: kept, name });
  });
  return { interfaces, byId };
}

function mapVlans(items: unknown[], warnings: TranslatorWarning[]): NetworkVlan[] {
  const vlans: NetworkVlan[] = [];
  const seen = new Set<number>();
  items.forEach((item, index) => {
    const pointer = `/vlans/${index}`;
    if (!isRecord(item)) {
      pushWarning(warnings, pointer, "Skipped a VLAN that is not an object.");
      return;
    }
    noteUnmapped(warnings, pointer, item, VLAN_USED, "VLAN");
    const id = vlanId(item.vid);
    if (id == null) {
      pushWarning(warnings, pointer, "Skipped a VLAN with no vid from 1 to 4094.");
      return;
    }
    if (seen.has(id)) {
      pushWarning(warnings, pointer, `Duplicate VLAN ${id} was skipped.`);
      return;
    }
    seen.add(id);
    vlans.push({ id, name: textOf(item.name) });
  });
  return vlans;
}

function assignAddresses(items: unknown[], interfaces: NetworkInterface[], byId: Map<string, Ref>, warnings: TranslatorWarning[]): void {
  const byPair = new Map(interfaces.map((item) => [`${item.device.toLowerCase()}\0${item.name}`, item]));
  let skipped = 0;
  items.forEach((item, index) => {
    if (!isRecord(item)) {
      skipped += 1;
      return;
    }
    noteUnmapped(warnings, `/ip-addresses/${index}`, item, IP_USED, "IP address");
    const type = textOf(item.assigned_object_type);
    if (type && type !== "dcim.interface") {
      skipped += 1;
      return;
    }
    let ref = byId.get(idKey(item.assigned_object_id));
    if (!ref && isRecord(item.assigned_object)) {
      const device = nestedText(item.assigned_object.device, ["name", "display"]);
      const name = textOf(item.assigned_object.name);
      if (device && name) ref = { device, name };
    }
    const iface = ref ? byPair.get(`${ref.device.toLowerCase()}\0${ref.name}`) : undefined;
    if (!iface) {
      skipped += 1;
      return;
    }
    const parsed = splitCidr(textOf(item.address));
    if (!parsed) {
      if (textOf(item.address)) pushWarning(warnings, `/ip-addresses/${index}`, `IP address "${textOf(item.address)}" is not a CIDR, so it was skipped.`);
      return;
    }
    const list = parsed.family === "ipv4" ? iface.ipv4 : iface.ipv6;
    if (!list.some((address) => address.address === parsed.address && address.prefix === parsed.prefix)) {
      list.push({ address: parsed.address, prefix: parsed.prefix });
    }
    if (!iface.vrf) {
      const vrf = nestedText(item.vrf, ["name", "display"]);
      if (vrf) iface.vrf = vrf;
    }
  });
  if (skipped > 0) {
    pushWarning(warnings, "/ip-addresses", `Ignored ${plural(skipped, "IP address")} that ${skipped === 1 ? "is" : "are"} not assigned to an interface in this export.`);
  }
}

function endsFrom(value: unknown, byId: Map<string, Ref>): Ref[] {
  if (!Array.isArray(value)) return [];
  const ends: Ref[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const type = textOf(item.object_type);
    if (type && type !== "dcim.interface") continue;
    const known = byId.get(idKey(item.object_id));
    if (known) {
      ends.push(known);
      continue;
    }
    const object = isRecord(item.object) ? item.object : null;
    const device = object ? nestedText(object.device, ["name", "display"]) : "";
    const name = object ? textOf(object.name) || textOf(object.display) : "";
    if (device && name) ends.push({ device, name });
  }
  return ends;
}

function legacyEnd(record: Record<string, unknown>, side: "a" | "b", byId: Map<string, Ref>): Ref[] {
  const type = textOf(record[`termination_${side}_type`]);
  if (type && type !== "dcim.interface") return [];
  const known = byId.get(idKey(record[`termination_${side}_id`]));
  if (known) return [known];
  const nested = record[`termination_${side}`];
  if (!isRecord(nested)) return [];
  const device = nestedText(nested.device, ["name", "display"]);
  const name = textOf(nested.name) || textOf(nested.display);
  return device && name ? [{ device, name }] : [];
}

function mapCables(items: unknown[], byId: Map<string, Ref>, devices: NetworkDevice[], warnings: TranslatorWarning[]): NetworkLink[] {
  const names = new Map(devices.map((device) => [device.name.toLowerCase(), device.name]));
  const links: NetworkLink[] = [];
  let ignored = 0;
  items.forEach((item, index) => {
    const pointer = `/cables/${index}`;
    if (!isRecord(item)) {
      ignored += 1;
      return;
    }
    noteUnmapped(warnings, pointer, item, CABLE_USED, "cable");
    const modern = "a_terminations" in item || "b_terminations" in item;
    const a = modern ? endsFrom(item.a_terminations, byId) : legacyEnd(item, "a", byId);
    const b = modern ? endsFrom(item.b_terminations, byId) : legacyEnd(item, "b", byId);
    if (a.length !== 1 || b.length !== 1) {
      ignored += 1;
      if (a.length > 1 || b.length > 1) {
        pushWarning(warnings, pointer, `Cable ${index + 1} has more than one interface on a side, so no link was created.`);
      }
      return;
    }
    const aDevice = names.get(a[0]!.device.toLowerCase());
    const bDevice = names.get(b[0]!.device.toLowerCase());
    if (!aDevice || !bDevice) {
      ignored += 1;
      pushWarning(warnings, pointer, `Cable ${index + 1} was skipped because an end is not a device in this export.`);
      return;
    }
    links.push(blankLink(aDevice, a[0]!.name, bDevice, b[0]!.name, textOf(item.label)));
  });
  if (ignored > 0) {
    pushWarning(warnings, "/cables", `Ignored ${plural(ignored, "cable")} that ${ignored === 1 ? "does" : "do"} not connect two interfaces.`);
  }
  return dedupeLinks(links);
}

function convertNetBox(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A NetBox export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const buckets = readBuckets(input, warnings);
  const mappedDevices = mapDevices(buckets.devices, warnings);
  const mapped = mapInterfaces(buckets.interfaces, mappedDevices.devices, mappedDevices.ids, warnings);
  assignAddresses(buckets.ips, mapped.interfaces, mapped.byId, warnings);
  const links = mapCables(buckets.cables, mapped.byId, mappedDevices.devices, warnings);
  if (mappedDevices.devices.length > 0 && mapped.interfaces.length === 0) pushWarning(warnings, "", "No interfaces in this export.");
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({
      devices: mappedDevices.devices,
      interfaces: mapped.interfaces,
      links,
      vlans: mapVlans(buckets.vlans, warnings),
    }),
    warnings: sortWarnings(warnings),
  };
}

const netbox: TranslatorModule = {
  id: "netbox",
  name: "NetBox",
  formatHint: "Saved NetBox REST export (devices, interfaces, cables)",
  placeholder: `{
  "devices": { "count": 1, "results": [ { "name": "core-rtr" } ] },
  "interfaces": { "count": 0, "results": [] },
  "cables": { "count": 0, "results": [] }
}`,
  convert: convertNetBox,
};

export default netbox;
