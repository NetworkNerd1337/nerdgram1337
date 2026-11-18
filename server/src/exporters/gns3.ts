import type { NetworkDocument } from "../network/types.js";
import {
  HEADER_LINES,
  fileName,
  pushWarning,
  resolveLinks,
  safeLabel,
  stableUuid,
} from "./helpers.js";
import type { ExporterModule, ExportContext, ExportResult, ExportWarning } from "./types.js";

/**
 * Official file-format page (GNS3 2.2, still the page published as stable and
 * latest) lists revision 9 as GNS3 2.2. GNS3 3.x was not confirmed. This file
 * uses revision 9 and version "2.2.0" so 2.2 can open it.
 * node_type qemu is the documented fallback. dynamips and iou are not chosen.
 * The schema has no comment field, so the disclaimer is a warning.
 */
const NODE_TYPES = new Set([
  "cloud",
  "nat",
  "ethernet_hub",
  "ethernet_switch",
  "frame_relay_switch",
  "atm_switch",
  "docker",
  "dynamips",
  "vpcs",
  "traceng",
  "virtualbox",
  "vmware",
  "iou",
  "qemu",
]);

function exportGns3(document: NetworkDocument, context: ExportContext): ExportResult {
  const warnings: ExportWarning[] = [];
  warnings.push({
    path: "",
    message: HEADER_LINES.join(" ") + " Attach a GNS3 appliance before starting the project. Port numbers are adapter 0 in interface order.",
  });
  const links = resolveLinks(document, warnings);
  const label = safeLabel(context.label);
  const nodeIds = new Map<string, string>();
  const portOf = new Map<string, number>();
  const nodes = document.devices.map((device, index) => {
    const nodeId = stableUuid(`${label}:${device.name}`);
    nodeIds.set(device.name, nodeId);
    const requested = context.mapping?.find(
      (row) =>
        (!row.platform || row.platform.toLowerCase() === device.platform.toLowerCase()) &&
        (!row.role || row.role.toLowerCase() === device.role.toLowerCase()),
    );
    let nodeType = "qemu";
    if (requested?.node_type && NODE_TYPES.has(requested.node_type)) nodeType = requested.node_type;
    else if (requested?.node_type) {
      pushWarning(warnings, `/devices/${index}`, `${device.name} mapping node_type "${requested.node_type}" is not in the GNS3 2.2 enum. qemu was used.`);
    }
    pushWarning(
      warnings,
      `/devices/${index}/platform`,
      `${device.name} node_type is ${nodeType}. NerdGram did not choose dynamips or iou. Attach the appliance that matches this node.`,
    );
    const linked = new Set<string>();
    for (const link of links) {
      if (link.aDevice === device.name) linked.add(link.aInterface);
      if (link.bDevice === device.name) linked.add(link.bInterface);
    }
    let port = 0;
    for (const iface of document.interfaces.filter((item) => item.device === device.name)) {
      if (!linked.has(iface.name)) continue;
      portOf.set(`${device.name}\0${iface.name}`, port);
      port += 1;
    }
    return {
      compute_id: "local",
      node_id: nodeId,
      node_type: nodeType,
      name: device.name,
      x: (index % 5) * 160,
      y: Math.floor(index / 5) * 140,
      properties: {},
    };
  });
  const gns3Links = [];
  for (const link of links) {
    if (link.unresolved) {
      pushWarning(warnings, `/links/${link.index}`, `Skipped a link whose interface did not resolve.`);
      continue;
    }
    const left = nodeIds.get(link.aDevice);
    const right = nodeIds.get(link.bDevice);
    const leftPort = portOf.get(`${link.aDevice}\0${link.aInterface}`);
    const rightPort = portOf.get(`${link.bDevice}\0${link.bInterface}`);
    if (!left || !right || leftPort == null || rightPort == null) {
      pushWarning(warnings, `/links/${link.index}`, `Skipped a link whose end is not on a device.`);
      continue;
    }
    gns3Links.push({
      link_id: stableUuid(`${label}:link:${link.index}`),
      link_type: "ethernet",
      nodes: [
        { node_id: left, adapter_number: 0, port_number: leftPort },
        { node_id: right, adapter_number: 0, port_number: rightPort },
      ],
    });
  }
  const project = {
    project_id: stableUuid(`${label}:project`),
    type: "topology",
    revision: 9,
    version: "2.2.0",
    name: label,
    topology: {
      nodes,
      links: gns3Links,
      drawings: [],
      computes: [],
    },
  };
  const text = `${JSON.stringify(project, null, 2)}\n`;
  return { files: [{ name: fileName(label, "gns3"), text }], warnings };
}

const exporter: ExporterModule = {
  id: "gns3",
  name: "GNS3 project",
  extension: "gns3",
  mimeType: "application/json",
  description: "A GNS3 2.2 .gns3 project (revision 9). Appliances are not included. NerdGram does not call a GNS3 server.",
  export: exportGns3,
};

export default exporter;
