import type { NetworkDocument } from "../network/types.js";
import {
  CHANGE_ME,
  HEADER_LINES,
  commentBlock,
  fileName,
  pushWarning,
  resolveLinks,
  safeLabel,
  stableUuid,
} from "./helpers.js";
import type { ExporterModule, ExportContext, ExportResult, ExportWarning } from "./types.js";

/**
 * Official EVE-NG docs describe the JSON API, not a .unl schema.
 * Element names below follow that API (lab, node, network, interface) and the
 * starting shape in the issue. visibility, interface attributes, and node types
 * beyond iol / dynamips / qemu were NOT checked against a .unl saved from a
 * current EVE-NG install. Override template and image. Do not treat this XML
 * as a verified schema.
 */
const KNOWN_TYPES = new Set(["iol", "dynamips", "qemu"]);

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportEve(document: NetworkDocument, context: ExportContext): ExportResult {
  const warnings: ExportWarning[] = [];
  const links = resolveLinks(document, warnings);
  const label = safeLabel(context.label);
  const networkFor = new Map<number, number>();
  let nextNetwork = 1;
  for (const link of links) {
    if (link.unresolved) continue;
    networkFor.set(link.index, nextNetwork);
    nextNetwork += 1;
  }
  const nodeXml: string[] = [];
  document.devices.forEach((device, index) => {
    const id = index + 1;
    const requested = context.mapping?.find(
      (row) =>
        (!row.platform || row.platform.toLowerCase() === device.platform.toLowerCase()) &&
        (!row.role || row.role.toLowerCase() === device.role.toLowerCase()),
    );
    let type = requested?.type && KNOWN_TYPES.has(requested.type) ? requested.type : "qemu";
    if (requested?.type && !KNOWN_TYPES.has(requested.type)) {
      pushWarning(warnings, `/devices/${index}`, `${device.name} mapping type "${requested.type}" is not in the published API list (iol, dynamips, qemu). qemu was used.`);
    }
    const template = requested?.template || CHANGE_ME;
    const image = requested?.image || CHANGE_ME;
    pushWarning(
      warnings,
      `/devices/${index}/platform`,
      `${device.name} uses type ${type}, template ${template}, image ${image}. Image names are local to your EVE-NG. They were not guessed.`,
    );
    const owned = document.interfaces.filter((item) => item.device === device.name);
    const ethernetCount = Math.max(1, owned.filter((item) => !/^loopback/i.test(item.name)).length);
    const interfaces = owned.map((iface, ifaceIndex) => {
      const attached = links.find(
        (link) =>
          !link.unresolved &&
          ((link.aDevice === device.name && link.aInterface === iface.name) ||
            (link.bDevice === device.name && link.bInterface === iface.name)),
      );
      const networkId = attached ? networkFor.get(attached.index) ?? 0 : 0;
      return `        <interface id="${ifaceIndex}" name="${xmlEscape(iface.name)}" type="ethernet" network_id="${networkId}"/>`;
    });
    const left = `${10 + (index % 4) * 20}%`;
    const top = `${15 + Math.floor(index / 4) * 20}%`;
    nodeXml.push(
      [
        `      <node id="${id}" name="${xmlEscape(device.name)}" type="${xmlEscape(type)}" template="${xmlEscape(template)}" image="${xmlEscape(image)}" ethernet="${ethernetCount}" ram="1024" config="Unconfigured" left="${left}" top="${top}">`,
        ...interfaces,
        `      </node>`,
      ].join("\n"),
    );
  });
  const networks = links
    .filter((link) => networkFor.has(link.index))
    .map((link) => {
      const id = networkFor.get(link.index);
      const name = `${link.aDevice}_${link.aInterface}__${link.bDevice}_${link.bInterface}`.replace(/[^\w.-]+/g, "_");
      const mark = link.inferred ? `<!-- inferred, not a proven cable -->\n        ` : "";
      return `        ${mark}<network id="${id}" type="bridge" name="${xmlEscape(name)}" visibility="0"/>`;
    });
  const inferredNote = links.some((link) => link.inferred)
    ? "Inferred links are marked with an XML comment and are not proven cables."
    : "This diagram has no inferred links.";
  const header = commentBlock("xml", [
    ...HEADER_LINES,
    "Copy this .unl into EVE-NG and point templates at images you already have.",
    "XML attribute names follow the EVE-NG API fields and were not checked against a .unl saved from a current install.",
    "visibility on networks is unverified. Override templates and images.",
    inferredNote,
  ]);
  const text = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    header.trimEnd(),
    `<lab name="${xmlEscape(label)}" id="${stableUuid(`${label}:lab`)}" version="1" author="NerdGram" description="${xmlEscape("Generated from NerdGram network data. Placeholders only. No emulator connection.")}">`,
    `  <topology>`,
    `    <nodes>`,
    ...nodeXml,
    `    </nodes>`,
    `    <networks>`,
    ...networks,
    `    </networks>`,
    `  </topology>`,
    `</lab>`,
    ``,
  ].join("\n");
  return { files: [{ name: fileName(label, "unl"), text }], warnings };
}

const exporter: ExporterModule = {
  id: "eve-ng",
  name: "EVE-NG lab",
  extension: "unl",
  mimeType: "application/xml",
  description: "An EVE-NG .unl lab. Templates and images are placeholders. NerdGram does not connect to EVE-NG.",
  export: exportEve,
};

export default exporter;
