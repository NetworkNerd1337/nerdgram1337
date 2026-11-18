import type { NetworkDocument } from "../network/types.js";
import {
  CHANGE_ME,
  HEADER_LINES,
  cidr,
  commentBlock,
  fileName,
  lookupMapping,
  pushWarning,
  renderYaml,
  resolveLinks,
  safeLabel,
  type MapRow,
} from "./helpers.js";
import type { ExporterModule, ExportContext, ExportResult, ExportWarning } from "./types.js";

/**
 * pyATS `os` is a free string. The published topology schema's example is `iosxe`.
 * These rows use the names in that schema and in current pyATS testbeds.
 * `platform` on the device is a hardware id, not this string.
 */
const OS_ROWS: MapRow[] = [
  { platform: "Cisco IOS-XE", values: { os: "iosxe" } },
  { platform: "Cisco IOS", values: { os: "ios" } },
  { platform: "Cisco NX-OS", values: { os: "nxos" } },
  { platform: "Cisco IOS-XR", values: { os: "iosxr" } },
  { platform: "Arista EOS", values: { os: "eos" } },
  { platform: "Juniper Junos", values: { os: "junos" } },
];

/**
 * The published schema calls interface `type` a mandatory string and the
 * example only shows `ethernet`. It does not publish an enum. These prefixes
 * are the documented choices and can be overridden with `interfacePrefix` rows.
 */
const INTERFACE_TYPES: { prefix: string; type: string }[] = [
  { prefix: "Loopback", type: "loopback" },
  { prefix: "Vlan", type: "vlan" },
  { prefix: "Port-channel", type: "port-channel" },
  { prefix: "Po", type: "port-channel" },
];

function interfaceType(name: string, context: ExportContext): string {
  const rows = context.mapping ?? [];
  const custom = rows
    .filter((row) => row.interfacePrefix)
    .sort((a, b) => (b.interfacePrefix ?? "").length - (a.interfacePrefix ?? "").length);
  for (const row of custom) {
    if (name.toLowerCase().startsWith((row.interfacePrefix ?? "").toLowerCase()) && row.type) return row.type;
  }
  for (const row of INTERFACE_TYPES) {
    if (name.toLowerCase().startsWith(row.prefix.toLowerCase())) return row.type;
  }
  return "ethernet";
}

function hardwareId(model: string): string {
  if (!model.trim()) return "";
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,40}$/.test(model.trim())) return "";
  if (/ios|nx-os|eos|junos/i.test(model)) return "";
  return model.trim();
}

function exportPyats(document: NetworkDocument, context: ExportContext): ExportResult {
  const warnings: ExportWarning[] = [];
  const links = resolveLinks(document, warnings);
  const name = safeLabel(context.label);
  const devices: Record<string, unknown> = {};
  const topology: Record<string, unknown> = {};
  const linkName = new Map<number, string>();
  links.forEach((link, index) => {
    const raw = `${link.aDevice}_${link.aInterface}__${link.bDevice}_${link.bInterface}`.replace(/[^\w.-]+/g, "_");
    linkName.set(index, raw);
  });

  for (const [index, device] of document.devices.entries()) {
    const mapped = lookupMapping(OS_ROWS, device, context.mapping?.filter((row) => !row.interfacePrefix) ?? null);
    const os = mapped?.os;
    if (!device.role) {
      pushWarning(warnings, `/devices/${index}/role`, `${device.name} has no role. type is "device".`);
    }
    if (!os) {
      pushWarning(
        warnings,
        `/devices/${index}/platform`,
        device.platform
          ? `${device.name} platform "${device.platform}" has no pyATS os mapping. os was omitted.`
          : `${device.name} has no platform. os was omitted.`,
      );
    }
    if (!device.managementIp) {
      pushWarning(warnings, `/devices/${index}/managementIp`, `${device.name} has no managementIp. The cli connection has no ip.`);
    }
    const platform = hardwareId(device.model);
    const body: Record<string, unknown> = {
      type: device.role || "device",
      ...(os ? { os } : {}),
      ...(platform ? { platform } : {}),
      ...(device.model ? { model: device.model } : {}),
      ...(device.role ? { role: device.role } : {}),
      credentials: {
        default: { username: CHANGE_ME, password: CHANGE_ME },
      },
      connections: {
        cli: {
          protocol: "ssh",
          ...(device.managementIp ? { ip: device.managementIp } : {}),
        },
      },
    };
    devices[device.name] = body;

    const owned = document.interfaces.filter((item) => item.device === device.name);
    const interfaces: Record<string, unknown> = {};
    for (const iface of owned) {
      const entry: Record<string, unknown> = { type: interfaceType(iface.name, context) };
      if (iface.ipv4[0]) entry.ipv4 = cidr(iface.ipv4[0].address, iface.ipv4[0].prefix);
      if (iface.ipv4.length > 1) {
        pushWarning(warnings, "", `${device.name} ${iface.name} has more than one IPv4 address. Only the first was written.`);
      }
      if (iface.ipv6.length === 1 && iface.ipv6[0]) entry.ipv6 = cidr(iface.ipv6[0].address, iface.ipv6[0].prefix);
      else if (iface.ipv6.length > 1) entry.ipv6 = iface.ipv6.map((item) => cidr(item.address, item.prefix));
      interfaces[iface.name] = entry;
    }
    for (const link of links) {
      const onA = link.aDevice === device.name;
      const onB = link.bDevice === device.name;
      if (!onA && !onB) continue;
      const ifaceName = onA ? link.aInterface : link.bInterface;
      const current = interfaces[ifaceName];
      const slot = current && typeof current === "object" ? (current as Record<string, unknown>) : { type: interfaceType(ifaceName, context) };
      slot.link = linkName.get(link.index);
      interfaces[ifaceName] = slot;
    }
    if (Object.keys(interfaces).length > 0) topology[device.name] = { interfaces };
  }

  const inferred = links.filter((link) => link.inferred).map((link) => linkName.get(link.index) ?? "");
  const lines = [
    ...HEADER_LINES,
    "Passwords are placeholders. You are responsible for making names and IPs match the devices you will test.",
    "The published pyATS schema still marks testbed.tacacs and testbed.passwords required. They are placeholders, not the schema default.",
    "Interface type is a free string in that schema. vlan and port-channel are documented choices, not a published enum.",
    ...(inferred.length > 0 ? [`Inferred links, not proven cables: ${inferred.join(", ")}.`] : []),
  ];
  const testbed = {
    name,
    tacacs: { username: CHANGE_ME },
    passwords: { tacacs: CHANGE_ME, enable: CHANGE_ME, line: CHANGE_ME },
    credentials: { default: { username: CHANGE_ME, password: CHANGE_ME } },
  };
  const text = `${commentBlock("hash", lines)}${renderYaml({ testbed, devices, topology })}`;
  return { files: [{ name: fileName(name, "yml"), text }], warnings };
}

const exporter: ExporterModule = {
  id: "pyats",
  name: "pyATS testbed",
  extension: "yml",
  mimeType: "application/yaml",
  description: "A pyATS testbed YAML with placeholder credentials. NerdGram does not connect to devices.",
  export: exportPyats,
};

export default exporter;
