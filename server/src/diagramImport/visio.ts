import { VISIO_BINARY_MESSAGE, type DraftPage, type ForeignImport } from "./model.js";
import { finishPages } from "./model.js";
import { readZip, type ZipEntry } from "./zip.js";

export function looksLikeVisioZip(bytes: Uint8Array, name = ""): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  if (/\.vsdx$/i.test(name)) return true;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  return /visio|vnd\.ms-visio/i.test(head);
}

export function looksLikeVisioBinary(bytes: Uint8Array, name = ""): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xd0 || bytes[1] !== 0xcf || bytes[2] !== 0x11 || bytes[3] !== 0xe0) return false;
  if (/\.vsd$|\.vss$|\.vst$/i.test(name)) return true;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  return /visio/i.test(head);
}

export function importVisio(bytes: Uint8Array, name = ""): ForeignImport {
  if (looksLikeVisioBinary(bytes, name)) return { ok: false, message: VISIO_BINARY_MESSAGE };
  let entries: ZipEntry[];
  try {
    entries = readZip(bytes);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "This Visio file could not be read." };
  }
  const files = new Map(entries.map((entry) => [entry.name.toLowerCase(), textOf(entry.bytes)]));
  if (!isVisioPackage(files, name)) {
    return { ok: false, message: "That file is not a Visio .vsdx drawing." };
  }
  const pages = visioPages(files);
  if (pages.length === 0) return { ok: false, message: "No pages were found in that Visio file." };
  return finishPages("visio", "Visio", pages);
}

function isVisioPackage(files: Map<string, string>, name: string): boolean {
  const types = files.get("[content_types].xml") ?? "";
  if (/visio/i.test(types)) return true;
  if ([...files.keys()].some((key) => key.startsWith("visio/pages/"))) return true;
  return /\.vsdx$/i.test(name);
}

function visioPages(files: Map<string, string>): DraftPage[] {
  const listed = pageRefs(files);
  const targets = listed.length > 0 ? listed : fallbackPages(files);
  return targets.map((item, index) => pageFromXml(item.id, item.title, files.get(item.path.toLowerCase()) ?? "", index));
}

function pageRefs(files: Map<string, string>): { id: string; title: string; path: string }[] {
  const pagesXml = files.get("visio/pages/pages.xml");
  if (!pagesXml) return [];
  const rels = files.get("visio/pages/_rels/pages.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const rel of walk(elements(rels)).filter((item) => item.name === "relationship")) {
    const id = attr(rel, "id");
    const target = attr(rel, "target");
    if (id && target) targets.set(id, `visio/pages/${target.replace(/^\//, "").replace(/^visio\/pages\//i, "")}`);
  }
  return walk(elements(pagesXml))
    .filter((item) => item.name === "page")
    .map((page, index) => {
      const rel = page.children.find((child) => child.name === "rel");
      const relId = rel ? attr(rel, "id") : "";
      const path = targets.get(relId) ?? "";
      return {
        id: attr(page, "id") || `page-${index + 1}`,
        title: attr(page, "name") || attr(page, "nameu") || `Page ${index + 1}`,
        path,
      };
    })
    .filter((page) => page.path.length > 0);
}

function fallbackPages(files: Map<string, string>): { id: string; title: string; path: string }[] {
  return [...files.keys()]
    .filter((key) => /^visio\/pages\/page\d+\.xml$/i.test(key))
    .sort()
    .map((path, index) => ({ id: `page-${index + 1}`, title: `Page ${index + 1}`, path }));
}

function pageFromXml(id: string, title: string, xml: string, index: number): DraftPage {
  const warnings: string[] = [];
  if (!xml.trim()) {
    warnings.push(`${title} has no shapes.`);
    return { id, title, nodes: [], edges: [], warnings };
  }
  const root = elements(xml);
  const shapes = pageShapes(root);
  const connects = walk(root).filter((item) => item.name === "connect");
  const connectorIds = new Set(connects.map((item) => attr(item, "fromsheet")).filter(Boolean));
  const flat: { id: string; name: string; text: string; group: string; connector: boolean }[] = [];
  const visit = (shape: Xml, group: string) => {
    const shapeId = attr(shape, "id") || `shape-${flat.length + 1}`;
    const name = attr(shape, "nameu") || attr(shape, "name");
    const text = ownText(shape);
    const nested = nestedShapes(shape);
    const connector = connectorIds.has(shapeId) || /connector/i.test(name);
    if (nested.length > 0 && !connector) {
      const titleText = text || name || `Group ${shapeId}`;
      for (const child of nested) visit(child, titleText);
      return;
    }
    flat.push({ id: shapeId, name, text, group, connector });
  };
  for (const shape of shapes) visit(shape, "");
  const nodes = flat
    .filter((shape) => !shape.connector)
    .map((shape) => {
      if (!shape.text) warnings.push(`Shape ${shape.id} has no text.`);
      return { key: shape.id, label: shape.text || shape.name || shape.id, group: shape.group };
    });
  const edges: DraftPage["edges"] = [];
  const seen = new Set<string>();
  for (const shape of flat.filter((item) => item.connector)) {
    if (seen.has(shape.id)) continue;
    seen.add(shape.id);
    const links = connects.filter((item) => attr(item, "fromsheet") === shape.id);
    const begin = links.find((item) => /begin/i.test(attr(item, "fromcell")));
    const end = links.find((item) => /end/i.test(attr(item, "fromcell")));
    const source = begin ? attr(begin, "tosheet") : "";
    const target = end ? attr(end, "tosheet") : "";
    const label = shape.text;
    if (source && target) {
      edges.push({ source, target, label });
      continue;
    }
    if (!source && !target) {
      warnings.push(`Line ${shape.id} is missing both ends.`);
      continue;
    }
    const stub = `stub-${shape.id}`;
    nodes.push({ key: stub, label: label || "unconnected", group: "" });
    edges.push(source ? { source, target: stub, label } : { source: stub, target, label: "" });
    warnings.push(`Line ${shape.id} is missing one end. It was drawn as a stub.`);
  }
  if (nodes.length === 0 && edges.length === 0 && warnings.length === 0) warnings.push(`${title || `Page ${index + 1}`} has no shapes.`);
  return { id, title: title || `Page ${index + 1}`, nodes, edges, warnings };
}

function pageShapes(nodes: Xml[]): Xml[] {
  const found: Xml[] = [];
  const visit = (node: Xml) => {
    if (node.name === "shape") {
      found.push(node);
      return;
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return found;
}

type Xml = { name: string; attrs: Record<string, string>; children: Xml[]; text: string };

function elements(xml: string): Xml[] {
  const root: Xml = { name: "root", attrs: {}, children: [], text: "" };
  const stack: Xml[] = [root];
  const pattern = /<([^>]+)>/g;
  let last = 0;
  for (const match of xml.matchAll(pattern)) {
    const at = match.index ?? 0;
    const between = xml.slice(last, at);
    const top = stack[stack.length - 1];
    if (between && top) top.text += between;
    last = at + match[0].length;
    const raw = match[1] ?? "";
    if (raw.startsWith("?") || raw.startsWith("!")) continue;
    if (raw.startsWith("/")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = /\/\s*$/.test(raw);
    const body = selfClosing ? raw.replace(/\/\s*$/, "") : raw;
    const el: Xml = { name: localName(body), attrs: attributes(body), children: [], text: "" };
    top?.children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root.children;
}

function nestedShapes(shape: Xml): Xml[] {
  return shape.children.flatMap((child) => {
    if (child.name === "shape") return [child];
    if (child.name === "shapes") return child.children.filter((item) => item.name === "shape");
    return [];
  });
}

function ownText(shape: Xml): string {
  const text = shape.children.find((child) => child.name === "text");
  if (!text) return "";
  return allText(text).replace(/\s+/g, " ").trim();
}

function allText(node: Xml): string {
  return `${node.text}${node.children.map(allText).join("")}`;
}

function walk(nodes: Xml[]): Xml[] {
  const found: Xml[] = [];
  const visit = (node: Xml) => {
    found.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return found;
}

function localName(raw: string): string {
  const token = raw.trim().split(/\s/)[0] ?? "";
  const colon = token.lastIndexOf(":");
  return (colon >= 0 ? token.slice(colon + 1) : token).toLowerCase();
}

function attributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) {
    const key = localName(match[1] ?? "");
    if (key) attrs[key] = decodeXml(match[2] ?? "");
  }
  return attrs;
}

function attr(node: Xml, name: string): string {
  return node.attrs[name] ?? "";
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
}
