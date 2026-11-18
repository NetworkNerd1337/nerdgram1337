import type { NetworkDocument } from "../network/types.js";
import {
  CHANGE_ME,
  HEADER_LINES,
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
 * Kinds below are members of the `kind` enum in the current containerlab
 * JSON Schema (clab.schema.json on the main branch). Image tags are not in
 * that schema, so every image is CHANGE_ME.
 * Cisco IOS-XE has several kinds. Role picks one. A missing or other role
 * stays CHANGE_ME. Juniper has no single kind, so it is not in this table.
 */
const KIND_ROWS: MapRow[] = [
  { platform: "Cisco IOS-XE", role: "access", values: { kind: "cisco_iol" } },
  { platform: "Cisco IOS-XE", role: "distribution", values: { kind: "cisco_iol" } },
  { platform: "Cisco IOS-XE", role: "core", values: { kind: "cisco_csr1000v" } },
  { platform: "Cisco IOS-XE", role: "wan", values: { kind: "cisco_csr1000v" } },
  { platform: "Arista EOS", values: { kind: "arista_ceos" } },
];

function isIpv4(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function exportContainerlab(document: NetworkDocument, context: ExportContext): ExportResult {
  const warnings: ExportWarning[] = [];
  const links = resolveLinks(document, warnings);
  const name = safeLabel(context.label);
  const nodes: Record<string, unknown> = {};
  for (const [index, device] of document.devices.entries()) {
    const mapped = lookupMapping(KIND_ROWS, device, context.mapping);
    const kind = mapped?.kind || CHANGE_ME;
    const image = mapped?.image || CHANGE_ME;
    if (!mapped?.kind) {
      pushWarning(
        warnings,
        `/devices/${index}/platform`,
        device.platform
          ? `${device.name} platform "${device.platform}"${device.role ? ` role "${device.role}"` : ""} has no containerlab kind. kind is ${CHANGE_ME}.`
          : `${device.name} has no platform. kind is ${CHANGE_ME}.`,
      );
    }
    if (image === CHANGE_ME) {
      pushWarning(warnings, `/devices/${index}`, `${device.name} image is ${CHANGE_ME}. The schema does not name a default tag.`);
    }
    const node: Record<string, unknown> = { kind, image };
    if (device.managementIp && isIpv4(device.managementIp)) node["mgmt-ipv4"] = device.managementIp;
    else if (device.managementIp?.includes(":")) {
      node["mgmt-ipv6"] = device.managementIp;
      pushWarning(warnings, `/devices/${index}/managementIp`, `${device.name} management address is IPv6. It was written as mgmt-ipv6, not rewritten into an IPv4 subnet.`);
    } else if (!device.managementIp) {
      pushWarning(warnings, `/devices/${index}/managementIp`, `${device.name} has no managementIp. mgmt-ipv4 was omitted.`);
    } else {
      pushWarning(warnings, `/devices/${index}/managementIp`, `${device.name} managementIp is not an IPv4 address. mgmt-ipv4 was omitted.`);
    }
    const group = device.site || device.role;
    if (group) node.group = group;
    nodes[device.name] = node;
  }
  const linkItems = links.map((link) => ({
    endpoints: [`${link.aDevice}:${link.aInterface}`, `${link.bDevice}:${link.bInterface}`],
  }));
  const inferred = links.filter((link) => link.inferred).map((link) => `${link.aDevice}:${link.aInterface} -- ${link.bDevice}:${link.bInterface}`);
  const lines = [
    ...HEADER_LINES,
    "Management addresses are copied as written. They must sit in the lab management subnet, or set mgmt.ipv4-subnet yourself.",
    "group is device.site when that is set, otherwise device.role. containerlab also uses group for graph layout.",
    "Kind values come from the current containerlab schema enum. Images are placeholders.",
    ...(inferred.length > 0 ? [`Inferred links, not proven cables: ${inferred.join("; ")}.`] : []),
  ];
  const text = `${commentBlock("hash", lines)}${renderYaml({ name, topology: { nodes, links: linkItems } })}`;
  return { files: [{ name: fileName(name, "clab.yml"), text }], warnings };
}

const exporter: ExporterModule = {
  id: "containerlab",
  name: "containerlab topology",
  extension: "clab.yml",
  mimeType: "application/yaml",
  description: "A containerlab topology YAML. Images are placeholders. NerdGram does not deploy the lab.",
  export: exportContainerlab,
};

export default exporter;
