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
 * node_definition ids were checked against CiscoDevNet cml-community
 * basic-forwarding-behavior.yaml (`iosv`, physical interfaces with `slot`,
 * loopbacks without `slot`, lab.version 0.1.0). That file is IOS, not IOS-XE.
 * cat8000v, csr1000v, iosvl2, and the IOL-L2 id were not confirmed against a
 * CML 2.10 YAML export, so they are not applied. Override the mapping to set one.
 */
const NODE_ROWS: MapRow[] = [];

function isLoopback(name: string): boolean {
  return /^loopback/i.test(name);
}

function exportCml(document: NetworkDocument, context: ExportContext): ExportResult {
  const warnings: ExportWarning[] = [];
  const links = resolveLinks(document, warnings);
  const title = safeLabel(context.label);
  const nodeIds = new Map<string, string>();
  const ifaceIds = new Map<string, string>();
  const nodes = document.devices.map((device, index) => {
    const id = `n${index}`;
    nodeIds.set(device.name, id);
    const mapped = lookupMapping(NODE_ROWS, device, context.mapping);
    const nodeDefinition = mapped?.node_definition || CHANGE_ME;
    if (!mapped?.node_definition) {
      pushWarning(
        warnings,
        `/devices/${index}/platform`,
        `${device.name} node_definition is ${CHANGE_ME}. IOS-XE ids such as cat8000v, csr1000v, and iosvl2 were not confirmed against a current CML export.`,
      );
    }
    if (!device.managementIp) {
      pushWarning(warnings, `/devices/${index}/managementIp`, `${device.name} has no managementIp. The node is still exported.`);
    }
    const owned = document.interfaces.filter((item) => item.device === device.name);
    let physical = 0;
    const interfaces = owned.map((iface, ifaceIndex) => {
      const ifaceId = `i${ifaceIndex}`;
      ifaceIds.set(`${device.name}\0${iface.name}`, ifaceId);
      const loopback = isLoopback(iface.name);
      const entry: Record<string, unknown> = {
        id: ifaceId,
        label: iface.name,
        type: loopback ? "loopback" : "physical",
      };
      if (!loopback) {
        entry.slot = physical;
        physical += 1;
      }
      return entry;
    });
    return {
      id,
      label: device.name,
      node_definition: nodeDefinition,
      x: (index % 4) * 200,
      y: Math.floor(index / 4) * 160,
      interfaces,
    };
  });

  const cmlLinks: Record<string, unknown>[] = [];
  links.forEach((link, index) => {
    if (link.unresolved) {
      pushWarning(warnings, `/links/${index}`, `Skipped link ${link.aDevice}:${link.aInterface} to ${link.bDevice}:${link.bInterface} because an end did not resolve.`);
      return;
    }
    const n1 = nodeIds.get(link.aDevice);
    const n2 = nodeIds.get(link.bDevice);
    const i1 = ifaceIds.get(`${link.aDevice}\0${link.aInterface}`);
    const i2 = ifaceIds.get(`${link.bDevice}\0${link.bInterface}`);
    if (!n1 || !n2 || !i1 || !i2) {
      pushWarning(warnings, `/links/${index}`, `Skipped a link whose device is not in the document.`);
      return;
    }
    cmlLinks.push({
      id: `l${cmlLinks.length}`,
      n1,
      i1,
      n2,
      i2,
      label: link.label || `${link.aDevice}-${link.aInterface}<->${link.bDevice}-${link.bInterface}`,
    });
  });

  const inferred = links.filter((link) => link.inferred).map((link) => `${link.aDevice}:${link.aInterface}<->${link.bDevice}:${link.bInterface}`);
  const lines = [
    ...HEADER_LINES,
    "NerdGram does not log in to CML. Import this YAML and attach images that already exist on the CML server.",
    "Coordinates are a generated grid. Rearrange the nodes in the Workbench.",
    "Loopback interfaces have no slot. Physical interfaces use a 0-based slot, matching the CiscoDevNet community lab shape.",
    "node_definition stays CHANGE_ME unless a mapping row sets it.",
    ...(inferred.length > 0 ? [`Inferred links, not proven cables: ${inferred.join("; ")}.`] : []),
  ];
  const lab = {
    title,
    version: "0.1.0",
    description: "Generated from NerdGram network data. Placeholders only. No device connection.",
    notes: "Import this file in CML and attach node images that are already installed.",
  };
  const text = `${commentBlock("hash", lines)}${renderYaml({ lab, nodes, links: cmlLinks })}`;
  return { files: [{ name: fileName(title, "yaml"), text }], warnings };
}

const exporter: ExporterModule = {
  id: "cml",
  name: "CML lab",
  extension: "yaml",
  mimeType: "application/yaml",
  description: "A CML 2.x lab YAML. Node definitions are placeholders unless you map them. NerdGram does not log in to CML.",
  export: exportCml,
};

export default exporter;
