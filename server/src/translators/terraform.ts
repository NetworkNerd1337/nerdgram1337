import type { NetworkAddress, NetworkDevice, NetworkInterface, NetworkLink, NetworkVlan } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  dedupeLinks,
  ensureDevice,
  ensureLinkEnds,
  formatRate,
  hostAddress,
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
 * Saved `terraform show -json`. Walks root_module and child_modules.
 * A plan uses planned_values. Sensitive attributes are dropped.
 * The type table is the extension point. depends_on is not a cable.
 * Nothing in this file runs Terraform or a provider.
 *
 * Provider schemas were not frozen to one vendor. network_device,
 * network_interface, network_link, and network_vlan are the supported
 * type names. Add a row after checking that provider's current docs.
 */

const DEVICE_KEYS = new Set(["name", "hostname", "management_ip", "management_address", "model", "platform", "os", "role", "site", "location"]);
const INTERFACE_KEYS = new Set(["device", "device_name", "name", "description", "enabled", "shutdown", "speed", "ipv4", "vrf"]);
const LINK_KEYS = new Set(["a_device", "a_interface", "b_device", "b_interface", "label"]);
const VLAN_KEYS = new Set(["id", "vid", "name"]);

type Kind = "device" | "interface" | "link" | "vlan";

const SUPPORTED: Record<string, Kind> = {
  network_device: "device",
  network_interface: "interface",
  network_link: "link",
  network_vlan: "vlan",
};

type Bucket = {
  devices: NetworkDevice[];
  interfaces: NetworkInterface[];
  links: NetworkLink[];
  vlans: NetworkVlan[];
};

function majorSupported(value: unknown, warnings: TranslatorWarning[]): boolean {
  if (value == null) return true;
  const text = textOf(value);
  const major = Number(text.split(".")[0]);
  if (major === 1) return true;
  pushWarning(warnings, "/format_version", `Unsupported Terraform JSON major version "${text || String(value)}". No resources were mapped.`);
  return false;
}

function valuesOf(input: Record<string, unknown>, warnings: TranslatorWarning[]): Record<string, unknown> | null {
  if (isRecord(input.planned_values)) return input.planned_values;
  if (isRecord(input.prior_state) && isRecord(input.prior_state.values)) {
    pushWarning(warnings, "", "This plan has no planned_values. prior_state.values was used.");
    return input.prior_state.values;
  }
  if (isRecord(input.values)) return input.values;
  return null;
}

function scrub(values: Record<string, unknown>, sensitive: unknown, warnings: TranslatorWarning[], pointer: string): Record<string, unknown> {
  if (sensitive === true) {
    pushWarning(warnings, pointer, "Skipped a sensitive value.");
    return {};
  }
  if (!isRecord(sensitive)) return values;
  const copy: Record<string, unknown> = { ...values };
  for (const [key, flag] of Object.entries(sensitive)) {
    if (flag === true) {
      delete copy[key];
      pushWarning(warnings, `${pointer}/${key}`, `Skipped sensitive attribute "${key}".`);
    } else if (isRecord(flag) && isRecord(copy[key])) {
      copy[key] = scrub(copy[key] as Record<string, unknown>, flag, warnings, `${pointer}/${key}`);
    }
  }
  return copy;
}

function cidrs(value: unknown): NetworkAddress[] {
  const texts = Array.isArray(value) ? value.map(textOf) : [textOf(value)];
  const out: NetworkAddress[] = [];
  for (const text of texts) {
    const cidr = splitCidr(text);
    if (cidr) out.push({ address: cidr.address, prefix: cidr.prefix });
  }
  return out;
}

function takeDevice(values: Record<string, unknown>, warnings: TranslatorWarning[], pointer: string, bucket: Bucket) {
  noteUnmapped(warnings, pointer, values, DEVICE_KEYS, "resource");
  const name = textOf(values.name) || textOf(values.hostname);
  if (!name) {
    pushWarning(warnings, pointer, "Skipped a device resource with no name.");
    return;
  }
  bucket.devices.push(
    blankDevice(name, {
      managementIp: hostAddress(values.management_ip) || hostAddress(values.management_address),
      model: textOf(values.model),
      platform: textOf(values.platform) || textOf(values.os),
      role: textOf(values.role),
      site: textOf(values.site) || textOf(values.location),
    }),
  );
}

function takeInterface(values: Record<string, unknown>, warnings: TranslatorWarning[], pointer: string, bucket: Bucket) {
  noteUnmapped(warnings, pointer, values, INTERFACE_KEYS, "resource");
  const device = textOf(values.device) || textOf(values.device_name);
  const name = textOf(values.name);
  if (!device || !name) {
    pushWarning(warnings, pointer, "Skipped an interface resource with no device or name.");
    return;
  }
  ensureDevice(bucket.devices, device);
  const admin = values.shutdown != null ? statusUpDown(values.shutdown === true ? false : values.shutdown === false ? true : values.enabled) : statusUpDown(values.enabled);
  const speedNumber = numberLike(values.speed);
  bucket.interfaces.push(
    blankInterface(device, name, {
      description: textOf(values.description),
      adminStatus: admin === "up" || admin === "down" ? admin : "",
      speed: speedNumber != null ? formatRate(speedNumber, "bps") : textOf(values.speed),
      ipv4: cidrs(values.ipv4).filter((item) => !item.address.includes(":")),
      vrf: textOf(values.vrf),
    }),
  );
}

function takeLink(values: Record<string, unknown>, warnings: TranslatorWarning[], pointer: string, bucket: Bucket) {
  noteUnmapped(warnings, pointer, values, LINK_KEYS, "resource");
  const aDevice = textOf(values.a_device);
  const bDevice = textOf(values.b_device);
  const aInterface = textOf(values.a_interface);
  const bInterface = textOf(values.b_interface);
  if (!aDevice || !bDevice || !aInterface || !bInterface) {
    pushWarning(warnings, pointer, "Skipped a link resource that does not name both ends.");
    return;
  }
  ensureDevice(bucket.devices, aDevice);
  ensureDevice(bucket.devices, bDevice);
  bucket.links.push(blankLink(aDevice, aInterface, bDevice, bInterface, textOf(values.label)));
}

function takeVlan(values: Record<string, unknown>, warnings: TranslatorWarning[], pointer: string, bucket: Bucket) {
  noteUnmapped(warnings, pointer, values, VLAN_KEYS, "resource");
  const id = vlanId(values.id ?? values.vid);
  if (id == null) return;
  bucket.vlans.push({ id, name: textOf(values.name) });
}

function walk(module: Record<string, unknown>, warnings: TranslatorWarning[], pointer: string, bucket: Bucket, skipped: Set<string>) {
  const resources = Array.isArray(module.resources) ? module.resources : [];
  resources.forEach((resource, index) => {
    if (!isRecord(resource)) return;
    const path = `${pointer}/resources/${index}`;
    if (textOf(resource.mode) === "data") {
      pushWarning(warnings, path, "Skipped a data source.");
      return;
    }
    if ("depends_on" in resource) pushWarning(warnings, path, "depends_on is not a link.");
    const type = textOf(resource.type);
    const kind = SUPPORTED[type];
    if (!kind) {
      if (type && !skipped.has(type)) {
        skipped.add(type);
        pushWarning(warnings, path, `Skipped unrecognized resource type "${type}".`);
      }
      return;
    }
    const raw = isRecord(resource.values) ? resource.values : {};
    const values = scrub(raw, resource.sensitive_values, warnings, path);
    if (kind === "device") takeDevice(values, warnings, path, bucket);
    if (kind === "interface") takeInterface(values, warnings, path, bucket);
    if (kind === "link") takeLink(values, warnings, path, bucket);
    if (kind === "vlan") takeVlan(values, warnings, path, bucket);
  });
  const children = Array.isArray(module.child_modules) ? module.child_modules : [];
  children.forEach((child, index) => {
    if (isRecord(child)) walk(child, warnings, `${pointer}/child_modules/${index}`, bucket, skipped);
  });
}

function convertTerraform(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A Terraform export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  if (!majorSupported(input.format_version, warnings)) {
    return {
      document: publishDocument({ devices: [], interfaces: [], links: [], vlans: [] }),
      warnings: sortWarnings(warnings),
    };
  }
  const values = valuesOf(input, warnings);
  const root = values && isRecord(values.root_module) ? values.root_module : null;
  const bucket: Bucket = { devices: [], interfaces: [], links: [], vlans: [] };
  if (!root) pushWarning(warnings, "", "This export has no root_module.");
  else walk(root, warnings, "/root_module", bucket, new Set());
  const links = dedupeLinks(bucket.links);
  ensureLinkEnds(bucket.devices, bucket.interfaces, links);
  if (bucket.devices.length === 0) pushWarning(warnings, "", "No network devices were found in this export.");
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: bucket.devices, interfaces: bucket.interfaces, links, vlans: bucket.vlans }),
    warnings: sortWarnings(warnings),
  };
}

const terraform: TranslatorModule = {
  id: "terraform",
  name: "Terraform",
  formatHint: "Saved terraform show -json state or plan",
  placeholder: `{
  "format_version": "1.0",
  "terraform_version": "1.9.0",
  "values": { "root_module": { "resources": [] } }
}`,
  convert: convertTerraform,
};

export default terraform;
