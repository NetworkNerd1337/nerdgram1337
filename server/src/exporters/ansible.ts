import type { NetworkDocument } from "../network/types.js";
import {
  CHANGE_ME,
  HEADER_LINES,
  safeGroupName,
  commentBlock,
  fileName,
  lookupMapping,
  pushWarning,
  renderYaml,
  safeLabel,
  type MapRow,
} from "./helpers.js";
import type { ExporterModule, ExportContext, ExportResult, ExportWarning } from "./types.js";

/**
 * ansible_network_os values checked against the current Ansible platform index
 * (docs.ansible.com network user guide) and the cisco.ios collection README,
 * which covers IOS and IOS-XE with cisco.ios.ios.
 * Junos is junipernetworks.junos.junos on that index, not juniper.junos.junos.
 */
const OS_ROWS: MapRow[] = [
  { platform: "Cisco IOS", values: { ansible_network_os: "cisco.ios.ios" } },
  { platform: "Cisco IOS-XE", values: { ansible_network_os: "cisco.ios.ios" } },
  { platform: "Cisco NX-OS", values: { ansible_network_os: "cisco.nxos.nxos" } },
  { platform: "Cisco IOS-XR", values: { ansible_network_os: "cisco.iosxr.iosxr" } },
  { platform: "Arista EOS", values: { ansible_network_os: "arista.eos.eos" } },
  { platform: "Juniper Junos", values: { ansible_network_os: "junipernetworks.junos.junos" } },
];

function exportAnsible(document: NetworkDocument, context: ExportContext): ExportResult {
  const warnings: ExportWarning[] = [];
  const hosts: Record<string, Record<string, unknown>> = {};
  const groups = new Map<string, Set<string>>();
  const remember = (group: string, host: string) => {
    const set = groups.get(group) ?? new Set<string>();
    set.add(host);
    groups.set(group, set);
  };
  for (const [index, device] of document.devices.entries()) {
    const vars: Record<string, unknown> = {};
    if (device.managementIp) vars.ansible_host = device.managementIp;
    else pushWarning(warnings, `/devices/${index}/managementIp`, `${device.name} has no managementIp. ansible_host was omitted.`);
    const mapped = lookupMapping(OS_ROWS, device, context.mapping);
    const networkOs = mapped?.ansible_network_os;
    if (networkOs && networkOs !== CHANGE_ME) {
      vars.ansible_connection = mapped?.ansible_connection || "ansible.netcommon.network_cli";
      vars.ansible_network_os = networkOs;
    } else {
      pushWarning(
        warnings,
        `/devices/${index}/platform`,
        device.platform
          ? `${device.name} platform "${device.platform}" has no ansible_network_os mapping. It was omitted.`
          : `${device.name} has no platform. ansible_network_os was omitted.`,
      );
    }
    if (device.role) vars.nerdgram_role = device.role;
    if (device.site) vars.nerdgram_site = device.site;
    if (device.model) vars.nerdgram_model = device.model;
    if (device.platform) vars.nerdgram_platform = device.platform;
    hosts[device.name] = vars;
    if (device.site) {
      const group = safeGroupName(device.site);
      if (group !== device.site.trim().toLowerCase()) {
        pushWarning(warnings, `/devices/${index}/site`, `Site "${device.site}" was sanitized to Ansible group "${group}".`);
      }
      remember(group, device.name);
    }
    if (device.role) {
      const group = safeGroupName(device.role);
      if (group !== device.role.trim().toLowerCase()) {
        pushWarning(warnings, `/devices/${index}/role`, `Role "${device.role}" was sanitized to Ansible group "${group}".`);
      }
      remember(group, device.name);
    }
  }
  const children: Record<string, { hosts: Record<string, Record<string, never>> }> = {};
  for (const [group, members] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const hostsInGroup: Record<string, Record<string, never>> = {};
    for (const host of [...members].sort()) hostsInGroup[host] = {};
    children[group] = { hosts: hostsInGroup };
  }
  const all: Record<string, unknown> = {
    vars: {
      ansible_user: CHANGE_ME,
      ansible_password: CHANGE_ME,
      ansible_become_password: CHANGE_ME,
    },
    hosts,
    ...(Object.keys(children).length > 0 ? { children } : {}),
  };
  const lines = [
    ...HEADER_LINES,
    "This inventory is hosts, groups, and addresses. It is not a topology.",
    "Use Ansible Vault or --ask-pass / --ask-become-pass. Do not commit a real password.",
    "A diagram cannot supply become secrets, jump hosts, or a verified network OS when the platform is unmapped.",
    "Group names are letters, digits, and underscores, with no leading digit.",
  ];
  const text = `${commentBlock("hash", lines)}${renderYaml({ all })}`;
  return { files: [{ name: fileName(safeLabel(context.label), "yml"), text }], warnings };
}

const exporter: ExporterModule = {
  id: "ansible",
  name: "Ansible inventory",
  extension: "yml",
  mimeType: "application/yaml",
  description: "A static Ansible YAML inventory. Passwords are placeholders. NerdGram does not connect.",
  export: exportAnsible,
};

export default exporter;
