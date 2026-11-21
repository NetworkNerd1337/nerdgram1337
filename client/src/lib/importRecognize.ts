import { detectNeighborKind } from "../../../server/src/neighbors/index.ts";

/** Shown on the Import button. Extension is only a hint; content decides. */
export const MERMAID_IMPORT_HINT = "Mermaid: .mmd, .mermaid, .md, .markdown, .txt";

export const SUPPORTED_IMPORT_LINE =
  "Supported files: Mermaid (.mmd, .mermaid, .md, .markdown, .txt). CSV, JSON, CDP/LLDP, and .network.json open in From data.";

export const IMPORT_DATA_KEY = "nerdgram-import-data";
export const IMPORT_PRESET_KEY = "nerdgram-import-presets";

const DIAGRAM_EXTENSIONS = [".markdown", ".mermaid", ".network.json", ".mmd", ".md", ".txt"];

export type ImportKind =
  | "mermaid"
  | "markdown"
  | "json"
  | "style-preset"
  | "csv"
  | "cdp"
  | "lldp"
  | "network"
  | "lucidchart"
  | "drawio"
  | "visio"
  | "plantuml"
  | "graphviz"
  | "d2"
  | "excalidraw"
  | "svg"
  | "png"
  | "jpg"
  | "pdf"
  | "unknown";

export type ImportAction = "diagram" | "from-data" | "style-presets" | "unsupported";

export type ImportRecognition = {
  kind: ImportKind;
  label: string;
  action: ImportAction;
  diagramText: string;
  /** Wizard format when the file opens in From data. */
  dataFormat: "" | "csv" | "json" | "cdp" | "lldp" | "network";
  message: string;
};

const LABELS: Record<ImportKind, string> = {
  mermaid: "Mermaid",
  markdown: "Markdown with a Mermaid diagram",
  json: "JSON",
  "style-preset": "NerdGram style presets",
  csv: "CSV",
  cdp: "Cisco CDP output",
  lldp: "LLDP output",
  network: "Network JSON",
  lucidchart: "Lucidchart JSON",
  drawio: "draw.io / diagrams.net",
  visio: "Visio",
  plantuml: "PlantUML",
  graphviz: "Graphviz DOT",
  d2: "D2",
  excalidraw: "Excalidraw",
  svg: "SVG",
  png: "PNG",
  jpg: "JPEG",
  pdf: "PDF",
  unknown: "Unrecognized file",
};

function supportedTail(): string {
  return " NerdGram imports Mermaid (.mmd, .mermaid, .md, .markdown, .txt). CSV, JSON, CDP/LLDP, and .network.json open in From data.";
}

function named(kind: ImportKind, action: ImportAction, extra: Partial<ImportRecognition> = {}): ImportRecognition {
  const label = LABELS[kind];
  const message =
    action === "diagram"
      ? `${label} will be imported as a diagram.`
      : action === "from-data"
        ? `${label} opens in From data.`
        : action === "style-presets"
          ? `${label} opens in Style presets.`
          : kind === "unknown"
            ? `This file is not a recognized format.${supportedTail()}`
            : `${label} is not supported yet.${supportedTail()}`;
  return {
    kind,
    label,
    action,
    diagramText: "",
    dataFormat: "",
    message,
    ...extra,
  };
}

function extension(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (base.endsWith(".network.json")) return ".network.json";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
}

function hasNull(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 4096);
  for (let i = 0; i < limit; i += 1) if (bytes[i] === 0) return true;
  return false;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function asciiHead(bytes: Uint8Array, count = 2048): string {
  return new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, count)));
}

function looksLikeMermaid(text: string): boolean {
  const body = text.replace(/^---[\s\S]*?---\s*/, "");
  return /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|gitGraph|journey|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|sankey-beta|xychart-beta|block-beta|architecture-beta|packet-beta|kanban|radar-beta|treemap-beta)\b/m.test(
    body,
  ) || /^%%\{init\b/m.test(body);
}

function mermaidFences(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```mermaid[^\n]*\n([\s\S]*?)```/gi;
  for (const match of text.matchAll(pattern)) {
    const body = match[1]?.trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

function looksLikeCsv(text: string): boolean {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : "";
  if (!delimiter) return false;
  const width = lines[0].split(delimiter).length;
  if (width < 2) return false;
  return lines.slice(0, 6).every((line) => Math.abs(line.split(delimiter).length - width) <= 1);
}

function looksLikeD2(text: string, name: string): boolean {
  if (looksLikeMermaid(text) || mermaidFences(text).length > 0) return false;
  if (extension(name) === ".d2") return true;
  return /^\s*(?:direction|vars|classes)\s*:/m.test(text) && /->/.test(text);
}

function looksLikeGraphviz(text: string): boolean {
  return /^\s*(?:strict\s+)?(?:di)?graph(?:\s+\w+)?\s*\{/m.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shapeIsLucidBlock(shape: Record<string, unknown>): boolean {
  const kind = `${typeof shape.class === "string" ? shape.class : ""} ${typeof shape.type === "string" ? shape.type : ""}`;
  return /block\b/i.test(kind);
}

function lineHasEndpoint(line: Record<string, unknown>): boolean {
  return Object.keys(line).some((key) => /endpoint/i.test(key));
}

/** Lucidchart names itself, or exports pages of block shapes and endpoint lines. */
function looksLikeLucid(value: Record<string, unknown>): boolean {
  const product = typeof value.product === "string" ? value.product.toLowerCase() : "";
  if (product.includes("lucidchart") || "lucidchart" in value) return true;
  if (!Array.isArray(value.pages)) return false;
  return value.pages.some((page) => {
    if (!isRecord(page) || !Array.isArray(page.shapes) || !Array.isArray(page.lines)) return false;
    const blocks = page.shapes.some((shape) => isRecord(shape) && shapeIsLucidBlock(shape));
    const linked = page.lines.some((line) => isRecord(line) && lineHasEndpoint(line));
    return blocks && linked;
  });
}

function classifyJson(value: unknown, name: string): ImportRecognition | null {
  if (!isRecord(value)) return named("json", "from-data", { dataFormat: "json" });
  if (looksLikeLucid(value)) return named("lucidchart", "unsupported");
  if (typeof value.mxGraphModel === "object" || typeof value.mxfile === "string" || value.type === "diagrams.net") {
    return named("drawio", "unsupported");
  }
  if (value.type === "excalidraw" || (Array.isArray(value.elements) && isRecord(value.appState))) {
    return named("excalidraw", "unsupported");
  }
  if (
    value.version === 1 &&
    Array.isArray(value.presets) &&
    value.presets.every((item) => isRecord(item) && typeof item.name === "string" && isRecord(item.style))
  ) {
    return named("style-preset", "style-presets");
  }
  const networkName = extension(name) === ".network.json";
  if (
    networkName ||
    value.format === "network" ||
    (value.schemaVersion === 1 && Array.isArray(value.devices) && Array.isArray(value.interfaces))
  ) {
    return named("network", "from-data", { dataFormat: "network" });
  }
  return named("json", "from-data", { dataFormat: "json" });
}

function classifyText(name: string, text: string): ImportRecognition {
  const trimmed = text.trim();
  if (!trimmed) return named("unknown", "unsupported");
  if (/<mxfile[\s>]|<mxGraphModel[\s>]|<mxCell[\s>]/i.test(trimmed)) return named("drawio", "unsupported");
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(trimmed)) return named("svg", "unsupported");
  if (/@startuml\b/i.test(trimmed)) return named("plantuml", "unsupported");
  if (looksLikeGraphviz(trimmed)) return named("graphviz", "unsupported");
  if (looksLikeD2(trimmed, name)) return named("d2", "unsupported");

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return classifyJson(JSON.parse(trimmed) as unknown, name) ?? named("json", "from-data", { dataFormat: "json" });
    } catch {
      return named("unknown", "unsupported");
    }
  }

  const neighbor = detectNeighborKind(trimmed);
  if (neighbor === "cdp") return named("cdp", "from-data", { dataFormat: "cdp" });
  if (neighbor === "lldp") return named("lldp", "from-data", { dataFormat: "lldp" });

  const fences = mermaidFences(trimmed);
  if (fences.length > 0) {
    return named("markdown", "diagram", { diagramText: fences.join("\n\n") });
  }
  if (looksLikeMermaid(trimmed)) return named("mermaid", "diagram", { diagramText: trimmed });
  if (extension(name) === ".csv" || looksLikeCsv(trimmed)) return named("csv", "from-data", { dataFormat: "csv" });
  if (extension(name) === ".mmd" || extension(name) === ".mermaid") {
    return named("mermaid", "diagram", { diagramText: trimmed });
  }
  return named("unknown", "unsupported");
}

/** Identify a dropped or pasted file. The extension is only a hint. */
export function recognizeImport(name: string, bytes: Uint8Array): ImportRecognition {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return named("png", "unsupported");
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return named("jpg", "unsupported");
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return named("pdf", "unsupported");
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    if (extension(name) === ".vsd" || /visio/i.test(asciiHead(bytes, 8192))) return named("visio", "unsupported");
    return named("unknown", "unsupported");
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const head = asciiHead(bytes, 65536);
    if (extension(name) === ".vsdx" || /visio|vnd\.ms-visio/i.test(head)) return named("visio", "unsupported");
    return named("unknown", "unsupported");
  }
  if (hasNull(bytes)) return named("unknown", "unsupported");
  return classifyText(name, decodeText(bytes));
}

/** `.mmd` name for a diagram import. Directory pieces are dropped. */
export function diagramFileName(rawName: string): string {
  const base = rawName.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "diagram";
  const lower = base.toLowerCase();
  const ext = DIAGRAM_EXTENSIONS.find((item) => lower.endsWith(item));
  const stem = (ext ? base.slice(0, -ext.length) : base.replace(/\.[^.]+$/, ""))
    .trim()
    .replace(/[. ]+$/g, "");
  const safe = stem.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/^\.+/, "");
  return `${safe || "diagram"}.mmd`;
}
