import type { DraftEdge, DraftNode, DraftPage, ForeignImport } from "./model.js";
import { finishPages } from "./model.js";

const TEXT_AREAS = ["textarea1", "textarea2", "textarea3"];

export function looksLikeLucidCsv(text: string): boolean {
  const header = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const cells = parseCsv(header)[0]?.map(norm) ?? [];
  return cells.includes("linesource") && cells.includes("linedestination");
}

export function looksLikeLucidJson(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const product = typeof value.product === "string" ? value.product.toLowerCase() : "";
  if (product.includes("lucid") || "lucidchart" in value) return true;
  if (!Array.isArray(value.pages)) return false;
  return value.pages.some((page) => {
    if (!isRecord(page)) return false;
    const blocks = records(page.shapes).some(shapeIsBlock);
    const linked = records(page.lines).some(lineIsLucid);
    return blocks || linked;
  });
}

export function importLucidCsv(text: string): ForeignImport {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = rows[0]?.map(norm) ?? [];
  if (!header.includes("linesource") || !header.includes("linedestination")) {
    return { ok: false, message: "That CSV is not a Lucid shape-data export." };
  }
  const index = new Map<string, number>();
  header.forEach((name, at) => {
    if (!index.has(name)) index.set(name, at);
  });
  const cell = (row: string[], name: string) => row[index.get(name) ?? -1]?.trim() ?? "";
  const textAt = (row: string[]) => {
    for (const name of TEXT_AREAS) {
      const value = cell(row, name);
      if (value) return value;
    }
    const extra = header.findIndex((name) => name.startsWith("textarea") && name !== "textarea1");
    if (extra >= 0 && row[extra]?.trim()) return row[extra].trim();
    return cell(row, "name");
  };
  const byPage = new Map<string, { title: string; rows: { row: string[]; number: number }[] }>();
  rows.slice(1).forEach((row, offset) => {
    const id = cell(row, "pageid") || cell(row, "pagename") || "page";
    const title = cell(row, "pagename") || cell(row, "pageid") || "Page 1";
    const bucket = byPage.get(id) ?? { title, rows: [] };
    bucket.rows.push({ row, number: offset + 2 });
    byPage.set(id, bucket);
  });
  const pages: DraftPage[] = [];
  for (const [id, bucket] of byPage) {
    pages.push(pageFromRows(id, bucket.title, bucket.rows, cell, textAt));
  }
  return finishPages("lucid", "Lucid", pages);
}

export function importLucidJson(value: unknown): ForeignImport {
  if (!isRecord(value) || !looksLikeLucidJson(value)) {
    return { ok: false, message: "That JSON is not a Lucid diagram." };
  }
  const rawPages = Array.isArray(value.pages) ? value.pages : [];
  const pages = rawPages.flatMap((page, index) => (isRecord(page) ? [pageFromJson(page, index)] : []));
  return finishPages("lucid", "Lucid", pages);
}

function pageFromRows(
  id: string,
  title: string,
  rows: { row: string[]; number: number }[],
  cell: (row: string[], name: string) => string,
  textAt: (row: string[]) => string,
): DraftPage {
  const warnings: string[] = [];
  const nodes: DraftNode[] = [];
  const edges: DraftEdge[] = [];
  const labels = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const item of rows) {
    const source = cell(item.row, "linesource");
    const target = cell(item.row, "linedestination");
    if (source || target) continue;
    const key = cell(item.row, "id") || `row-${item.number}`;
    const label = textAt(item.row);
    if (!label) warnings.push(`Shape ${key} has no text.`);
    labels.set(key, label || key);
    const contained = cell(item.row, "containedby");
    const group = cell(item.row, "group");
    if (contained) groups.set(key, contained);
    else if (group && !/^(?:true|false|yes|no)$/i.test(group)) groups.set(key, group);
  }
  for (const item of rows) {
    const source = cell(item.row, "linesource");
    const target = cell(item.row, "linedestination");
    if (source || target) continue;
    const key = cell(item.row, "id") || `row-${item.number}`;
    const parent = groups.get(key) ?? "";
    const parentLabel = labels.get(parent) || parent;
    nodes.push({ key, label: labels.get(key) || key, group: parent && parent !== key ? parentLabel : "" });
  }
  for (const item of rows) {
    const source = cell(item.row, "linesource");
    const target = cell(item.row, "linedestination");
    if (!source && !target) continue;
    const label = textAt(item.row);
    const key = cell(item.row, "id") || `line-${item.number}`;
    pushLine(nodes, edges, warnings, key, source, target, label);
  }
  return { id, title, nodes, edges, warnings };
}

function pageFromJson(page: Record<string, unknown>, index: number): DraftPage {
  const warnings: string[] = [];
  const title = textValue(page.title) || textValue(page.name) || `Page ${index + 1}`;
  const id = textValue(page.id) || `page-${index + 1}`;
  const shapes = records(page.shapes);
  const lines = records(page.lines);
  const labels = new Map<string, string>();
  const parents = new Map<string, string>();
  shapes.forEach((shape, shapeIndex) => {
    const key = textValue(shape.id) || `shape-${shapeIndex + 1}`;
    const label = shapeText(shape);
    if (!label) warnings.push(`Shape ${key} has no text.`);
    labels.set(key, label || key);
    const parent = textValue(shape.containedBy) || textValue(shape.container) || textValue(shape.parent);
    if (parent) parents.set(key, parent);
  });
  const nodes: DraftNode[] = shapes.map((shape, shapeIndex) => {
    const key = textValue(shape.id) || `shape-${shapeIndex + 1}`;
    const parent = parents.get(key) ?? "";
    return { key, label: labels.get(key) || key, group: parent && parent !== key ? labels.get(parent) || parent : "" };
  });
  const edges: DraftEdge[] = [];
  lines.forEach((line, lineIndex) => {
    const key = textValue(line.id) || `line-${lineIndex + 1}`;
    const ends = lineEnds(line);
    pushLine(nodes, edges, warnings, key, ends.source, ends.target, shapeText(line));
  });
  if (shapes.length === 0 && lines.length === 0) warnings.push(`${title} has no shapes.`);
  return { id, title, nodes, edges, warnings };
}

function pushLine(
  nodes: DraftNode[],
  edges: DraftEdge[],
  warnings: string[],
  key: string,
  source: string,
  target: string,
  label: string,
): void {
  if (source && target) {
    edges.push({ source, target, label });
    return;
  }
  if (!source && !target) {
    warnings.push(`Line ${key} is missing both ends.`);
    return;
  }
  const stub = `stub-${key}`;
  nodes.push({ key: stub, label: label || "unconnected", group: "" });
  edges.push(source ? { source, target: stub, label } : { source: stub, target, label: "" });
  warnings.push(`Line ${key} is missing one end. It was drawn as a stub.`);
}

function lineEnds(line: Record<string, unknown>): { source: string; target: string } {
  return { source: endpoint(line, "1", "from", "source"), target: endpoint(line, "2", "to", "target") };
}

function endpoint(line: Record<string, unknown>, which: "1" | "2", fromKey: string, sourceKey: string): string {
  const box = line[`endpoint${which}`];
  if (isRecord(box)) {
    for (const key of ["connectedTo", "shapeId", "id"]) {
      const value = textValue(box[key]);
      if (value) return value;
    }
  }
  return textValue(line[which === "1" ? fromKey : which === "2" ? "to" : ""]) || textValue(line[sourceKey]);
}

function shapeText(shape: Record<string, unknown>): string {
  const direct = textValue(shape.text) || textValue(shape.name);
  if (direct) return direct;
  if (Array.isArray(shape.text)) {
    const joined = shape.text.map(textValue).filter(Boolean).join(" ");
    if (joined) return joined;
  }
  if (Array.isArray(shape.textAreas)) {
    const joined = shape.textAreas
      .map((area) => (typeof area === "string" ? area : isRecord(area) ? textValue(area.text) || textValue(area.label) : ""))
      .filter(Boolean)
      .join(" ");
    if (joined) return joined;
  }
  return "";
}

function shapeIsBlock(shape: Record<string, unknown>): boolean {
  return /Block$/.test(textValue(shape.class)) || /Block$/.test(textValue(shape.type));
}

function lineIsLucid(line: Record<string, unknown>): boolean {
  if ("endpoint1" in line || "endpoint2" in line) return true;
  if ("from" in line && "to" in line) return true;
  if ("source" in line && "target" in line) return true;
  return false;
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => {
      if (!isRecord(item)) return [];
      if (typeof item.id !== "string") return [{ ...item, id: key }];
      return [item];
    });
  }
  return [];
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
