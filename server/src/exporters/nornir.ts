import type { NetworkDocument } from "../network/types.js";
import {
  CHANGE_ME,
  HEADER_LINES,
  commentBlock,
  lookupMapping,
  pushWarning,
  renderYaml,
  type MapRow,
} from "./helpers.js";
import type { ExporterModule, ExportContext, ExportResult, ExportWarning } from "./types.js";

/**
 * `platform` is the NAPALM driver name, which is what Nornir examples use.
 * Netmiko device_type strings differ. They are written under
 * connection_options.netmiko.platform and called out in a warning.
 * NAPALM has no separate IOS-XE driver, so IOS-XE uses `ios`.
 * Netmiko names below were not re-read from the current Netmiko driver list.
 * Override `netmiko` when your install uses another name.
 */
const PLATFORM_ROWS: MapRow[] = [
  { platform: "Cisco IOS", values: { platform: "ios", netmiko: "cisco_ios" } },
  { platform: "Cisco IOS-XE", values: { platform: "ios", netmiko: "cisco_xe" } },
  { platform: "Cisco NX-OS", values: { platform: "nxos", netmiko: "cisco_nxos" } },
  { platform: "Cisco IOS-XR", values: { platform: "iosxr", netmiko: "cisco_xr" } },
  { platform: "Arista EOS", values: { platform: "eos", netmiko: "arista_eos" } },
  { platform: "Juniper Junos", values: { platform: "junos", netmiko: "juniper_junos" } },
];

function groupName(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

function exportNornir(document: NetworkDocument, context: ExportContext): ExportResult {
  const warnings: ExportWarning[] = [];
  const hosts: Record<string, unknown> = {};
  const groups = new Map<string, true>();
  for (const [index, device] of document.devices.entries()) {
    const mapped = lookupMapping(PLATFORM_ROWS, device, context.mapping);
    const data: Record<string, string> = {};
    if (device.site) data.site = device.site;
    if (device.role) data.role = device.role;
    if (device.model) data.model = device.model;
    if (device.platform) data.platform = device.platform;
    const membership: string[] = [];
    for (const raw of [device.site, device.role]) {
      if (!raw) continue;
      const name = groupName(raw);
      if (name !== raw) {
        pushWarning(warnings, `/devices/${index}`, `${device.name} group "${raw}" was written as "${name}".`);
      }
      groups.set(name, true);
      membership.push(name);
    }
    const host: Record<string, unknown> = {};
    if (device.managementIp) host.hostname = device.managementIp;
    else pushWarning(warnings, `/devices/${index}/managementIp`, `${device.name} has no managementIp. hostname was omitted.`);
    if (mapped?.platform && mapped.platform !== CHANGE_ME) {
      host.platform = mapped.platform;
      if (mapped.netmiko) {
        host.connection_options = { netmiko: { platform: mapped.netmiko } };
      }
      pushWarning(
        warnings,
        `/devices/${index}/platform`,
        `${device.name} platform "${mapped.platform}" is the NAPALM driver name. Netmiko connection_options.platform is "${mapped.netmiko ?? ""}". Confirm both, especially IOS-XE (NAPALM ios, Netmiko cisco_xe).`,
      );
    } else {
      pushWarning(
        warnings,
        `/devices/${index}/platform`,
        device.platform
          ? `${device.name} platform "${device.platform}" has no Nornir driver mapping. platform was omitted.`
          : `${device.name} has no platform. platform was omitted.`,
      );
    }
    if (membership.length > 0) host.groups = membership;
    if (Object.keys(data).length > 0) host.data = data;
    hosts[device.name] = host;
  }
  const groupFile: Record<string, Record<string, never>> = {};
  for (const name of [...groups.keys()].sort()) groupFile[name] = {};
  const lines = [
    ...HEADER_LINES,
    "SimpleInventory reads hosts.yaml, groups.yaml, and defaults.yaml.",
    "config.yaml points the plugin at those files. It is not required to load the inventory.",
    "username and password are placeholders. Use your own secrets store.",
  ];
  const header = commentBlock("hash", lines);
  const files = [
    { name: "hosts.yaml", text: `${header}${renderYaml(hosts)}` },
    { name: "groups.yaml", text: `${header}${renderYaml(groupFile)}` },
    {
      name: "defaults.yaml",
      text: `${header}${renderYaml({ username: CHANGE_ME, password: CHANGE_ME })}`,
    },
    {
      name: "config.yaml",
      text: `${header}${renderYaml({
        inventory: {
          plugin: "SimpleInventory",
          options: {
            host_file: "hosts.yaml",
            group_file: "groups.yaml",
            defaults_file: "defaults.yaml",
          },
        },
      })}`,
    },
  ];
  return { files, warnings };
}

const exporter: ExporterModule = {
  id: "nornir",
  name: "Nornir inventory",
  extension: "yaml",
  mimeType: "application/yaml",
  description: "A Nornir SimpleInventory (hosts, groups, defaults). Passwords are placeholders. NerdGram does not connect.",
  export: exportNornir,
};

export default exporter;
