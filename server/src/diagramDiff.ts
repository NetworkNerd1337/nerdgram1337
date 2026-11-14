import { extractClickLinks } from "./diagramLinks.js";
import { diagramConfigKey, parseDiagram, type DiagramDocument, type Scalar } from "./frontMatter.js";

/**
 * Revision diff for one diagram.
 *
 * Text diffs cover every diagram type, including front matter. Flowcharts
 * (`flowchart` / `graph`) also get a node and edge diff. Parsing reuses
 * `parseDiagram` and `extractClickLinks` instead of a second header or click
 * parser. The visual source is a new Mermaid document for display only. It is
 * never written back to the diagram.
 */

const ID_PATTERN = "[A-Za-z_][\\w-]*";
const ARROWS = [
  "<-->",
  "o--o",
  "x--x",
  "<-.->",
  "==>",
  "===",
  "-.->",
  "-.-",
  "--o",
  "--x",
  "o-->",
  "x-->",
  "<--",
  "-->",
  "---",
  "~~~",
];

const DIFF_FILL = {
  added: "#1f7a4d",
  removed: "#8f2430",
  changed: "#8a5a12",
  same: "#2a3340",
} as const;

const DIFF_STROKE = {
  added: "#3dd68c",
  removed: "#ff8b98",
  changed: "#ffc46b",
  same: "#66788a",
} as const;

/** Near-white. WCAG AA against every DIFF_FILL, including the slate unchanged nodes. */
const DIFF_LABEL = "#f8fafc";

export type FieldChange = {
  field: string;
  from: string;
  to: string;
};

export type NodeSnap = {
  id: string;
  label: string;
  shape: string;
  className: string;
  style: string;
  subgraph: string;
};

export type EdgeSnap = {
  from: string;
  to: string;
  label: string;
  arrow: string;
  style: string;
  index: number;
};

export type ClickSnap = {
  nodeId: string;
  target: string;
};

export type TextRow = {
  kind: "same" | "add" | "remove" | "change";
  left: string | null;
  right: string | null;
  leftLine: number | null;
  rightLine: number | null;
};

export type DiagramDiff = {
  semantic: boolean;
  diagramType: string;
  note: string | null;
  text: { unified: string; rows: TextRow[] };
  frontMatter: FieldChange[];
  nodes: {
    added: NodeSnap[];
    removed: NodeSnap[];
    changed: { id: string; changes: FieldChange[] }[];
  };
  edges: {
    added: EdgeSnap[];
    removed: EdgeSnap[];
    changed: { from: string; to: string; index: number; changes: FieldChange[] }[];
  };
  clicks: {
    added: ClickSnap[];
    removed: ClickSnap[];
    changed: { nodeId: string; from: string; to: string }[];
  };
  subgraphs: {
    added: { id: string; title: string }[];
    removed: { id: string; title: string }[];
    changed: { id: string; from: string; to: string }[];
  };
  summary: string[];
  counts: {
    nodesAdded: number;
    nodesRemoved: number;
    nodesChanged: number;
    edgesAdded: number;
    edgesRemoved: number;
    edgesChanged: number;
    clicksAdded: number;
    clicksRemoved: number;
    clicksChanged: number;
    frontMatter: number;
  };
  markdown: string;
  visualSource: string | null;
  fromSource: string;
  toSource: string;
};

type ShapeName =
  | "default"
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "diamond"
  | "hexagon"
  | "parallelogram"
  | "trapezoid"
  | "asymmetric";

type FlowNode = {
  id: string;
  label: string;
  shape: ShapeName;
  classes: string[];
  style: string;
  subgraph: string[];
  explicit: boolean;
};

type FlowEdge = {
  from: string;
  to: string;
  label: string;
  arrow: string;
  style: string;
};

type FlowGraph = {
  direction: string;
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
  subgraphs: Map<string, { id: string; title: string }>;
};

const SEMANTIC_NOTE =
  "This diagram type does not have a node and edge diff. The comparison is the text diff.";

export function diffDiagrams(
  fromSource: string,
  toSource: string,
  labels: { from?: string; to?: string } = {},
): DiagramDiff {
  const fromLabel = labels.from?.trim() || "Before";
  const toLabel = labels.to?.trim() || "After";
  const fromDoc = parseDiagram(fromSource);
  const toDoc = parseDiagram(toSource);
  const fromType = diagramConfigKey(fromDoc.body) ?? "other";
  const toType = diagramConfigKey(toDoc.body) ?? "other";
  const semantic = fromType === "flowchart" && toType === "flowchart";
  const textRows = diffTextRows(fromSource, toSource);
  const frontMatter = diffFrontMatter(fromDoc, toDoc);
  const emptyNodes = { added: [] as NodeSnap[], removed: [] as NodeSnap[], changed: [] as DiagramDiff["nodes"]["changed"] };
  const emptyEdges = { added: [] as EdgeSnap[], removed: [] as EdgeSnap[], changed: [] as DiagramDiff["edges"]["changed"] };
  const clicks = diffClicks(fromSource, toSource);
  let nodes = emptyNodes;
  let edges = emptyEdges;
  let subgraphs: DiagramDiff["subgraphs"] = { added: [], removed: [], changed: [] };
  let visualSource: string | null = null;
  if (semantic) {
    const fromGraph = parseFlowchart(fromDoc.body);
    const toGraph = parseFlowchart(toDoc.body);
    nodes = diffNodes(fromGraph, toGraph);
    edges = diffEdges(fromGraph, toGraph);
    subgraphs = diffSubgraphs(fromGraph, toGraph);
    visualSource = buildVisualSource(fromGraph, toGraph, nodes, edges);
  }
  const summary = buildSummary({
    nodes,
    edges,
    clicks,
    frontMatter,
    subgraphs,
    semantic,
    textChanged: textRows.some((row) => row.kind !== "same"),
  });
  const counts = {
    nodesAdded: nodes.added.length,
    nodesRemoved: nodes.removed.length,
    nodesChanged: nodes.changed.length,
    edgesAdded: edges.added.length,
    edgesRemoved: edges.removed.length,
    edgesChanged: edges.changed.length,
    clicksAdded: clicks.added.length,
    clicksRemoved: clicks.removed.length,
    clicksChanged: clicks.changed.length,
    frontMatter: frontMatter.length,
  };
  const diff: DiagramDiff = {
    semantic,
    diagramType: semantic ? "flowchart" : toType !== "other" ? toType : fromType,
    note: semantic ? null : SEMANTIC_NOTE,
    text: { unified: unifiedDiff(textRows, fromLabel, toLabel), rows: textRows },
    frontMatter,
    nodes,
    edges,
    clicks,
    subgraphs,
    summary,
    counts,
    markdown: "",
    visualSource,
    fromSource,
    toSource,
  };
  diff.markdown = renderMarkdown(diff, fromLabel, toLabel);
  return diff;
}

function diffTextRows(before: string, after: string): TextRow[] {
  const left = splitLines(before);
  const right = splitLines(after);
  const edits = lineEdits(left, right);
  const rows: TextRow[] = [];
  let leftLine = 1;
  let rightLine = 1;
  let index = 0;
  while (index < edits.length) {
    const edit = edits[index];
    if (!edit) break;
    if (edit.type === "equal") {
      rows.push({ kind: "same", left: edit.text, right: edit.text, leftLine, rightLine });
      leftLine += 1;
      rightLine += 1;
      index += 1;
      continue;
    }
    let deletes = 0;
    while (edits[index + deletes]?.type === "delete") deletes += 1;
    let inserts = 0;
    while (edits[index + deletes + inserts]?.type === "insert") inserts += 1;
    const pairs = Math.max(deletes, inserts);
    for (let pair = 0; pair < pairs; pair += 1) {
      const leftText = pair < deletes ? edits[index + pair]?.text ?? null : null;
      const rightText = pair < inserts ? edits[index + deletes + pair]?.text ?? null : null;
      const kind = leftText != null && rightText != null ? "change" : leftText != null ? "remove" : "add";
      rows.push({
        kind,
        left: leftText,
        right: rightText,
        leftLine: leftText != null ? leftLine : null,
        rightLine: rightText != null ? rightLine : null,
      });
      if (leftText != null) leftLine += 1;
      if (rightText != null) rightLine += 1;
    }
    index += deletes + inserts;
  }
  return rows;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

type LineEdit = { type: "equal" | "delete" | "insert"; text: string };

function lineEdits(left: string[], right: string[]): LineEdit[] {
  const n = left.length;
  const m = right.length;
  if (n * m > 1_000_000) {
    return [
      ...left.map((text) => ({ type: "delete" as const, text })),
      ...right.map((text) => ({ type: "insert" as const, text })),
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i];
    const next = dp[i + 1];
    if (!row || !next) continue;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = left[i] === right[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const edits: LineEdit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      edits.push({ type: "equal", text: left[i] ?? "" });
      i += 1;
      j += 1;
      continue;
    }
    const down = dp[i + 1]?.[j] ?? 0;
    const across = dp[i]?.[j + 1] ?? 0;
    if (down >= across) {
      edits.push({ type: "delete", text: left[i] ?? "" });
      i += 1;
    } else {
      edits.push({ type: "insert", text: right[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) {
    edits.push({ type: "delete", text: left[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    edits.push({ type: "insert", text: right[j] ?? "" });
    j += 1;
  }
  return edits;
}

function unifiedDiff(rows: TextRow[], fromLabel: string, toLabel: string): string {
  if (rows.every((row) => row.kind === "same")) return "";
  const lines = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  for (const row of rows) {
    if (row.kind === "same") lines.push(` ${row.left ?? ""}`);
    if (row.kind === "remove" || row.kind === "change") lines.push(`-${row.left ?? ""}`);
    if (row.kind === "add" || row.kind === "change") lines.push(`+${row.right ?? ""}`);
  }
  return lines.join("\n");
}

const FRONT_FIELDS: (keyof DiagramDocument)[] = [
  "title",
  "description",
  "notes",
  "tags",
  "category",
  "theme",
  "look",
  "layout",
  "displayMode",
  "fontFamily",
  "handDrawnSeed",
  "themeCSS",
  "themeVariables",
  "flowchartCurve",
  "elk",
];

function diffFrontMatter(fromDoc: DiagramDocument, toDoc: DiagramDocument): FieldChange[] {
  const changes: FieldChange[] = [];
  if (fromDoc.malformed || toDoc.malformed) {
    const fromError = fromDoc.malformed ? fromDoc.error || "Front matter could not be parsed." : "";
    const toError = toDoc.malformed ? toDoc.error || "Front matter could not be parsed." : "";
    if (fromError !== toError) changes.push({ field: "front matter", from: fromError, to: toError });
  }
  for (const field of FRONT_FIELDS) {
    const fromValue = displayValue(fromDoc[field]);
    const toValue = displayValue(toDoc[field]);
    if (fromValue === toValue) continue;
    if (!fromDoc.hasFrontMatter && !toDoc.hasFrontMatter) continue;
    changes.push({ field: String(field), from: fromValue, to: toValue });
  }
  return changes;
}

function displayValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "object") return stableJson(value as Record<string, Scalar>);
  return String(value);
}

function stableJson(value: Record<string, Scalar>): string {
  const keys = Object.keys(value).sort();
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

function diffClicks(fromSource: string, toSource: string): DiagramDiff["clicks"] {
  const from = extractClickLinks(fromSource);
  const to = extractClickLinks(toSource);
  const fromGroups = groupBy(from, (click) => click.nodeId);
  const toGroups = groupBy(to, (click) => click.nodeId);
  const added: ClickSnap[] = [];
  const removed: ClickSnap[] = [];
  const changed: DiagramDiff["clicks"]["changed"] = [];
  for (const nodeId of orderedKeys(fromGroups, toGroups)) {
    const left = fromGroups.get(nodeId) ?? [];
    const right = toGroups.get(nodeId) ?? [];
    const count = Math.max(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      const before = left[index];
      const after = right[index];
      if (before && after) {
        if (before.target !== after.target) changed.push({ nodeId, from: before.target, to: after.target });
      } else if (after) added.push({ nodeId, target: after.target });
      else if (before) removed.push({ nodeId, target: before.target });
    }
  }
  return { added, removed, changed };
}

function parseFlowchart(body: string): FlowGraph {
  const graph: FlowGraph = {
    direction: directionOf(body),
    nodes: new Map(),
    edges: [],
    subgraphs: new Map(),
  };
  const stack: { id: string; title: string }[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("%%")) continue;
    const trimmed = line.trim();
    if (/^(?:flowchart(?:-elk)?|graph|direction|accTitle|accDescr)\b/i.test(trimmed)) continue;
    if (/^classDef\b/i.test(trimmed)) continue;
    if (/^click\b/i.test(trimmed)) continue;
    if (/^\s*end\s*$/i.test(line)) {
      stack.pop();
      continue;
    }
    const subgraph = /^subgraph\s+(.+)$/i.exec(trimmed);
    if (subgraph?.[1]) {
      const parsed = parseSubgraphHeader(subgraph[1]);
      const path = [...stack.map((item) => item.id), parsed.id];
      const key = path.join("/");
      graph.subgraphs.set(key, { id: key, title: parsed.title });
      stack.push({ id: parsed.id, title: parsed.title });
      continue;
    }
    const member = currentSubgraph(stack);
    if (readStyle(trimmed, graph, member)) continue;
    if (readClassAssign(trimmed, graph, member)) continue;
    if (readLinkStyle(trimmed, graph)) continue;
    for (const statement of splitStatements(line)) {
      readChain(statement, graph, member);
    }
  }
  return graph;
}

function directionOf(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*(?:flowchart(?:-elk)?|graph)\s+(TB|TD|BT|RL|LR)\b/i.exec(line);
    if (!match?.[1]) continue;
    const value = match[1].toUpperCase();
    return value === "TB" ? "TD" : value;
  }
  return "LR";
}

function currentSubgraph(stack: { id: string; title: string }[]): string[] {
  return stack.map((item) => item.id);
}

function parseSubgraphHeader(rest: string): { id: string; title: string } {
  const trimmed = rest.trim().replace(/;$/, "").trim();
  const quoted = /^"([^"]*)"\s*$/.exec(trimmed);
  if (quoted) {
    const title = quoted[1] ?? "group";
    return { id: safeId(title, "group"), title };
  }
  const idMatch = new RegExp(`^(${ID_PATTERN})\\s*(.*)$`).exec(trimmed);
  if (!idMatch?.[1]) return { id: safeId(trimmed, "group"), title: cleanLabel(trimmed) || "group" };
  const id = idMatch[1];
  const tail = (idMatch[2] ?? "").trim();
  if (!tail) return { id, title: id };
  const bracket = /^(?:\[(.*)\]|\((.*)\))$/.exec(tail);
  const inner = bracket?.[1] ?? bracket?.[2];
  if (inner != null) return { id, title: cleanLabel(inner) || id };
  return { id, title: cleanLabel(tail) || id };
}

function safeId(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[^A-Za-z_]+/, "");
  return cleaned || fallback;
}

function readStyle(line: string, graph: FlowGraph, subgraph: string[]): boolean {
  const match = new RegExp(`^style\\s+(${ID_PATTERN})\\s+(.+)$`, "i").exec(line);
  if (!match?.[1] || match[2] == null) return false;
  const node = ensureNode(graph, match[1], subgraph);
  node.style = normalizeStyle(match[2]);
  return true;
}

function readClassAssign(line: string, graph: FlowGraph, subgraph: string[]): boolean {
  const match = new RegExp(`^class\\s+(${ID_PATTERN}(?:\\s*,\\s*${ID_PATTERN})*)\\s+(${ID_PATTERN})\\s*;?\\s*$`, "i").exec(line);
  if (!match?.[1] || !match[2]) return false;
  for (const id of match[1].split(/\s*,\s*/)) {
    const node = ensureNode(graph, id, subgraph);
    pushClass(node, match[2]);
  }
  return true;
}

function readLinkStyle(line: string, graph: FlowGraph): boolean {
  const match = /^linkStyle\s+(.+)$/i.exec(line);
  if (!match?.[1]) return false;
  const parts = match[1].split(/\s+/);
  const indexes = parts[0] ?? "";
  const style = normalizeStyle(parts.slice(1).join(" "));
  if (!style) return true;
  if (/^default$/i.test(indexes)) {
    for (const edge of graph.edges) if (!edge.style) edge.style = style;
    return true;
  }
  for (const token of indexes.split(",")) {
    const index = Number(token);
    const edge = graph.edges[index];
    if (Number.isInteger(index) && edge) edge.style = style;
  }
  return true;
}

function readChain(statement: string, graph: FlowGraph, subgraph: string[]): void {
  const pieces = splitChain(statement);
  const groups: { id: string; label: string | null; shape: ShapeName | null; classes: string[] }[][] = [];
  const arrows: { arrow: string; label: string }[] = [];
  for (const piece of pieces) {
    if (piece.arrow) {
      arrows.push({ arrow: piece.arrow, label: piece.label });
      continue;
    }
    groups.push(readNodeGroup(piece.text));
  }
  if (arrows.length === 0) {
    for (const group of groups) {
      for (const node of group) defineNode(graph, node, subgraph, true);
    }
    return;
  }
  for (const group of groups) {
    for (const node of group) defineNode(graph, node, subgraph, node.shape != null || node.label != null);
  }
  for (let index = 0; index < arrows.length; index += 1) {
    const arrow = arrows[index];
    const left = groups[index] ?? [];
    const right = groups[index + 1] ?? [];
    if (!arrow) continue;
    for (const from of left) {
      for (const to of right) {
        graph.edges.push({
          from: from.id,
          to: to.id,
          label: arrow.label,
          arrow: arrow.arrow,
          style: "",
        });
      }
    }
  }
}

type NodeToken = { id: string; label: string | null; shape: ShapeName | null; classes: string[] };

function readNodeGroup(text: string): NodeToken[] {
  const nodes: NodeToken[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (/\s/.test(char) || char === "&" || char === ";") {
      index += 1;
      continue;
    }
    const idMatch = new RegExp(`^${ID_PATTERN}`).exec(text.slice(index));
    if (!idMatch) {
      index += 1;
      continue;
    }
    const id = idMatch[0];
    let cursor = index + id.length;
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
    const shape = readShape(text, cursor);
    const classes: string[] = [];
    let label: string | null = null;
    let shapeName: ShapeName | null = null;
    if (shape) {
      label = cleanLabel(shape.label);
      shapeName = shape.shape;
      cursor = shape.end;
    }
    while (text.startsWith(":::", cursor)) {
      const classMatch = new RegExp(`^:::((?:${ID_PATTERN})+)`).exec(text.slice(cursor));
      if (!classMatch?.[1]) break;
      classes.push(classMatch[1]);
      cursor += classMatch[0].length;
    }
    nodes.push({ id, label, shape: shapeName, classes });
    index = Math.max(cursor, index + id.length);
  }
  return nodes;
}

function defineNode(graph: FlowGraph, token: NodeToken, subgraph: string[], explicit: boolean): void {
  const node = ensureNode(graph, token.id, subgraph);
  if (explicit && !node.explicit) {
    node.explicit = true;
    node.label = token.label && token.label.length > 0 ? token.label : token.id;
    node.shape = token.shape ?? "rect";
    node.subgraph = [...subgraph];
  } else if (!node.explicit && token.label) {
    node.label = token.label;
    if (token.shape) node.shape = token.shape;
  }
  for (const name of token.classes) pushClass(node, name);
}

function ensureNode(graph: FlowGraph, id: string, subgraph: string[]): FlowNode {
  const existing = graph.nodes.get(id);
  if (existing) return existing;
  const node: FlowNode = {
    id,
    label: id,
    shape: "default",
    classes: [],
    style: "",
    subgraph: [...subgraph],
    explicit: false,
  };
  graph.nodes.set(id, node);
  return node;
}

function pushClass(node: FlowNode, name: string): void {
  if (!node.classes.includes(name)) node.classes.push(name);
}

function readShape(text: string, index: number): { label: string; end: number; shape: ShapeName } | null {
  const pairs: { open: string; closes: string[]; shape: ShapeName; alt?: { close: string; shape: ShapeName } }[] = [
    { open: "[[", closes: ["]]"], shape: "subroutine" },
    { open: "[(", closes: [")]"], shape: "cylinder" },
    { open: "([", closes: ["])"], shape: "stadium" },
    { open: "((", closes: ["))"], shape: "circle" },
    { open: "[/", closes: ["/]", "\\]"], shape: "parallelogram", alt: { close: "\\]", shape: "trapezoid" } },
    { open: "[\\", closes: ["\\]", "/]"], shape: "parallelogram", alt: { close: "/]", shape: "trapezoid" } },
    { open: "{{", closes: ["}}"], shape: "hexagon" },
    { open: "[", closes: ["]"], shape: "rect" },
    { open: "(", closes: [")"], shape: "round" },
    { open: "{", closes: ["}"], shape: "diamond" },
    { open: ">", closes: ["]"], shape: "asymmetric" },
  ];
  for (const pair of pairs) {
    if (!text.startsWith(pair.open, index)) continue;
    const found = findCloser(text, index + pair.open.length, pair.open, pair.closes);
    if (!found) return null;
    const close = pair.closes.find((item) => text.startsWith(item, found.at));
    const shape = pair.alt && close === pair.alt.close ? pair.alt.shape : pair.shape;
    return {
      label: text.slice(index + pair.open.length, found.at),
      end: found.at + (close?.length ?? 1),
      shape,
    };
  }
  return null;
}

function findCloser(text: string, from: number, open: string, closes: string[]): { at: number } | null {
  let depth = 1;
  for (let index = from; index < text.length; index += 1) {
    if (text.startsWith(open, index) && open !== ">") {
      depth += 1;
      index += open.length - 1;
      continue;
    }
    const close = closes.find((item) => text.startsWith(item, index));
    if (!close) continue;
    depth -= 1;
    if (depth === 0) return { at: index };
    index += close.length - 1;
  }
  return null;
}

function cleanLabel(label: string): string {
  const trimmed = label.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeStyle(value: string): string {
  return value.replace(/;$/, "").trim().replace(/\s+/g, "");
}

type ChainPiece = { text: string; arrow: string | null; label: string };

function splitStatements(line: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quote) {
      if (char === quote && line[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "(" || char === "{") depth += 1;
    else if ((char === "]" || char === ")" || char === "}") && depth > 0) depth -= 1;
    else if (char === ";" && depth === 0) {
      parts.push(line.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(line.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function splitChain(text: string): ChainPiece[] {
  const pieces: ChainPiece[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "(" || char === "{") {
      depth += 1;
      continue;
    }
    if ((char === "]" || char === ")" || char === "}") && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    const arrow = matchArrow(text, index);
    if (!arrow) continue;
    pieces.push({ text: text.slice(start, index), arrow: null, label: "" });
    pieces.push({ text: "", arrow: arrow.arrow, label: arrow.label });
    start = index + arrow.length;
    index = start - 1;
  }
  pieces.push({ text: text.slice(start), arrow: null, label: "" });
  return pieces;
}

function matchArrow(text: string, index: number): { length: number; arrow: string; label: string } | null {
  const spaced = matchSpacedArrow(text, index);
  if (spaced) return spaced;
  for (const arrow of ARROWS) {
    if (!text.startsWith(arrow, index)) continue;
    let length = arrow.length;
    let label = "";
    if (text[index + length] === "|") {
      const close = text.indexOf("|", index + length + 1);
      if (close !== -1) {
        label = text.slice(index + length + 1, close).trim();
        length = close + 1 - index;
      }
    }
    return { length, arrow, label };
  }
  return null;
}

function matchSpacedArrow(text: string, index: number): { length: number; arrow: string; label: string } | null {
  const patterns: { open: string; close: string; arrow: string }[] = [
    { open: "--", close: "-->", arrow: "-->" },
    { open: "--", close: "---", arrow: "---" },
    { open: "-.", close: ".->", arrow: "-.->" },
    { open: "==", close: "==>", arrow: "==>" },
  ];
  for (const pattern of patterns) {
    if (!text.startsWith(pattern.open, index)) continue;
    if (!/\s/.test(text[index + pattern.open.length] ?? "")) continue;
    const rest = text.slice(index + pattern.open.length);
    const at = rest.indexOf(pattern.close);
    if (at <= 0) continue;
    const label = rest.slice(0, at).trim();
    if (!label) continue;
    return { length: pattern.open.length + at + pattern.close.length, arrow: pattern.arrow, label };
  }
  return null;
}

function snapNode(node: FlowNode): NodeSnap {
  return {
    id: node.id,
    label: node.label,
    shape: node.shape,
    className: [...node.classes].sort().join(","),
    style: node.style,
    subgraph: node.subgraph.join("/"),
  };
}

function diffNodes(fromGraph: FlowGraph, toGraph: FlowGraph): DiagramDiff["nodes"] {
  const added: NodeSnap[] = [];
  const removed: NodeSnap[] = [];
  const changed: DiagramDiff["nodes"]["changed"] = [];
  const ids = orderedKeys(fromGraph.nodes, toGraph.nodes);
  for (const id of ids) {
    const before = fromGraph.nodes.get(id);
    const after = toGraph.nodes.get(id);
    if (before && !after) removed.push(snapNode(before));
    else if (after && !before) added.push(snapNode(after));
    else if (before && after) {
      const left = snapNode(before);
      const right = snapNode(after);
      const changes: FieldChange[] = [];
      for (const field of ["label", "shape", "className", "style", "subgraph"] as const) {
        if (left[field] === right[field]) continue;
        if (field === "shape" && left.shape === "default" && right.shape === "default") continue;
        changes.push({ field, from: left[field], to: right[field] });
      }
      if (changes.length > 0) changed.push({ id, changes });
    }
  }
  return { added, removed, changed };
}

function diffEdges(fromGraph: FlowGraph, toGraph: FlowGraph): DiagramDiff["edges"] {
  const added: EdgeSnap[] = [];
  const removed: EdgeSnap[] = [];
  const changed: DiagramDiff["edges"]["changed"] = [];
  const fromGroups = groupEdges(fromGraph.edges);
  const toGroups = groupEdges(toGraph.edges);
  for (const key of orderedKeys(fromGroups, toGroups)) {
    const [from, to] = key.split("\0");
    if (!from || !to) continue;
    const left = fromGroups.get(key) ?? [];
    const right = toGroups.get(key) ?? [];
    const count = Math.max(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      const before = left[index];
      const after = right[index];
      if (before && after) {
        const changes: FieldChange[] = [];
        if (before.label !== after.label) changes.push({ field: "label", from: before.label, to: after.label });
        if (before.arrow !== after.arrow) changes.push({ field: "arrow", from: before.arrow, to: after.arrow });
        if (before.style !== after.style) changes.push({ field: "style", from: before.style, to: after.style });
        if (changes.length > 0) changed.push({ from, to, index, changes });
      } else if (after) added.push(snapEdge(after, index));
      else if (before) removed.push(snapEdge(before, index));
    }
  }
  return { added, removed, changed };
}

function snapEdge(edge: FlowEdge, index: number): EdgeSnap {
  return { from: edge.from, to: edge.to, label: edge.label, arrow: edge.arrow, style: edge.style, index };
}

function groupEdges(edges: FlowEdge[]): Map<string, FlowEdge[]> {
  const groups = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}`;
    const list = groups.get(key) ?? [];
    list.push(edge);
    groups.set(key, list);
  }
  return groups;
}

function diffSubgraphs(fromGraph: FlowGraph, toGraph: FlowGraph): DiagramDiff["subgraphs"] {
  const added: DiagramDiff["subgraphs"]["added"] = [];
  const removed: DiagramDiff["subgraphs"]["removed"] = [];
  const changed: DiagramDiff["subgraphs"]["changed"] = [];
  for (const id of orderedKeys(fromGraph.subgraphs, toGraph.subgraphs)) {
    const before = fromGraph.subgraphs.get(id);
    const after = toGraph.subgraphs.get(id);
    if (before && !after) removed.push({ id, title: before.title });
    else if (after && !before) added.push({ id, title: after.title });
    else if (before && after && before.title !== after.title) changed.push({ id, from: before.title, to: after.title });
  }
  return { added, removed, changed };
}

type Status = "added" | "removed" | "changed" | "same";

function buildVisualSource(
  fromGraph: FlowGraph,
  toGraph: FlowGraph,
  nodes: DiagramDiff["nodes"],
  edges: DiagramDiff["edges"],
): string {
  const changedIds = new Set(nodes.changed.map((node) => node.id));
  const statusOf = new Map<string, Status>();
  for (const node of nodes.added) statusOf.set(node.id, "added");
  for (const node of nodes.removed) statusOf.set(node.id, "removed");
  for (const id of changedIds) statusOf.set(id, "changed");
  for (const node of toGraph.nodes.values()) if (!statusOf.has(node.id)) statusOf.set(node.id, "same");
  for (const node of fromGraph.nodes.values()) if (!statusOf.has(node.id)) statusOf.set(node.id, "same");

  const lines = [
    "---",
    "title: Changes",
    "config:",
    "  theme: neutral",
    "---",
    "%% NerdGram diff preview. This is not the diagram source.",
    `flowchart ${toGraph.direction || fromGraph.direction}`,
    `  classDef ngAdded fill:${DIFF_FILL.added},stroke:${DIFF_STROKE.added},color:${DIFF_LABEL},stroke-width:2px`,
    `  classDef ngRemoved fill:${DIFF_FILL.removed},stroke:${DIFF_STROKE.removed},color:${DIFF_LABEL},stroke-width:2px,stroke-dasharray:5 4`,
    `  classDef ngChanged fill:${DIFF_FILL.changed},stroke:${DIFF_STROKE.changed},color:${DIFF_LABEL},stroke-width:2px`,
    `  classDef ngSame fill:${DIFF_FILL.same},stroke:${DIFF_STROKE.same},color:${DIFF_LABEL},stroke-width:1px`,
  ];

  type Bucket = { title: string; nodes: { id: string; source: FlowNode; status: Status }[] };
  const buckets = new Map<string, Bucket>();
  const place = (node: FlowNode, status: Status) => {
    const key = status === "removed" ? node.subgraph.join("/") : (toGraph.nodes.get(node.id)?.subgraph ?? node.subgraph).join("/");
    const owner = status === "removed" ? fromGraph : toGraph.nodes.has(node.id) ? toGraph : fromGraph;
    const title = owner.subgraphs.get(key)?.title ?? key.split("/").at(-1) ?? "";
    const bucket = buckets.get(key) ?? { title, nodes: [] };
    bucket.nodes.push({ id: node.id, source: status === "removed" ? node : (toGraph.nodes.get(node.id) ?? node), status });
    buckets.set(key, bucket);
  };
  for (const node of nodes.removed) {
    const source = fromGraph.nodes.get(node.id);
    if (source) place(source, "removed");
  }
  for (const node of toGraph.nodes.values()) place(node, statusOf.get(node.id) ?? "same");

  const keys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const indent = key ? "  " : "";
    if (key) {
      const id = key.split("/").at(-1) ?? key;
      lines.push(`  subgraph ${safeId(id, "group")}["${escapeLabel(bucket.title || id)}"]`);
    }
    for (const item of bucket.nodes) {
      const className = item.status === "added" ? "ngAdded" : item.status === "removed" ? "ngRemoved" : item.status === "changed" ? "ngChanged" : "ngSame";
      lines.push(`${indent}  ${item.source.id}${emitShape(item.source)}:::${className}`);
    }
    if (key) lines.push("  end");
  }

  const visualEdges: { edge: FlowEdge; status: Status }[] = [];
  const edgeStatus = (from: string, to: string, index: number, fallback: Status): Status => {
    if (edges.added.some((edge) => edge.from === from && edge.to === to && edge.index === index)) return "added";
    if (edges.removed.some((edge) => edge.from === from && edge.to === to && edge.index === index)) return "removed";
    if (edges.changed.some((edge) => edge.from === from && edge.to === to && edge.index === index)) return "changed";
    return fallback;
  };
  const fromGroups = groupEdges(fromGraph.edges);
  const toGroups = groupEdges(toGraph.edges);
  for (const key of orderedKeys(toGroups, fromGroups)) {
    const right = toGroups.get(key) ?? [];
    const left = fromGroups.get(key) ?? [];
    right.forEach((edge, index) => {
      visualEdges.push({ edge, status: edgeStatus(edge.from, edge.to, index, "same") });
    });
    for (let index = right.length; index < left.length; index += 1) {
      const edge = left[index];
      if (!edge) continue;
      visualEdges.push({ edge, status: "removed" });
    }
  }
  visualEdges.forEach((item, index) => {
    const label = item.edge.label ? `|${escapeLabel(item.edge.label)}|` : "";
    lines.push(`  ${item.edge.from} ${item.edge.arrow}${label} ${item.edge.to}`);
    const stroke = DIFF_STROKE[item.status];
    const dash = item.status === "removed" ? ",stroke-dasharray:5 4" : "";
    lines.push(`  linkStyle ${index} stroke:${stroke},stroke-width:2px${dash}`);
  });
  return `${lines.join("\n")}\n`;
}

function emitShape(node: FlowNode): string {
  const label = escapeLabel(node.label || node.id);
  switch (node.shape) {
    case "round":
      return `("${label}")`;
    case "stadium":
      return `(["${label}"])`;
    case "subroutine":
      return `[["${label}"]]`;
    case "cylinder":
      return `[("${label}")]`;
    case "circle":
      return `(("${label}"))`;
    case "diamond":
      return `{"${label}"}`;
    case "hexagon":
      return `{{"${label}"}}`;
    case "parallelogram":
      return `[/"${label}"/]`;
    case "trapezoid":
      return `[/"${label}"\\]`;
    case "asymmetric":
      return `>"${label}"]`;
    case "rect":
    case "default":
    default:
      return `["${label}"]`;
  }
}

function escapeLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/"/g, "#quot;");
}

function buildSummary(input: {
  nodes: DiagramDiff["nodes"];
  edges: DiagramDiff["edges"];
  clicks: DiagramDiff["clicks"];
  frontMatter: FieldChange[];
  subgraphs: DiagramDiff["subgraphs"];
  semantic: boolean;
  textChanged: boolean;
}): string[] {
  const lines: string[] = [];
  if (!input.semantic) lines.push(SEMANTIC_NOTE);
  for (const node of input.nodes.added) lines.push(`Added node ${node.id}.`);
  for (const node of input.nodes.removed) lines.push(`Removed node ${node.id}.`);
  for (const node of input.nodes.changed) {
    for (const change of node.changes) {
      if (change.field === "label") lines.push(`Relabeled ${node.id} from \`${change.from}\` to \`${change.to}\`.`);
      else if (change.field === "subgraph") lines.push(movedSentence(node.id, change.from, change.to));
      else if (change.field === "shape") lines.push(`Changed the shape of ${node.id} from ${change.from} to ${change.to}.`);
      else if (change.field === "className") lines.push(`Changed the class of ${node.id} from \`${change.from || "none"}\` to \`${change.to || "none"}\`.`);
      else if (change.field === "style") lines.push(`Changed the style of ${node.id}.`);
    }
  }
  for (const edge of input.edges.added) lines.push(linkSentence("Added link", edge.from, edge.to, edge.label));
  for (const edge of input.edges.removed) lines.push(linkSentence("Removed link", edge.from, edge.to, edge.label));
  for (const edge of input.edges.changed) {
    const label = edge.changes.find((change) => change.field === "label");
    const arrow = edge.changes.find((change) => change.field === "arrow");
    const style = edge.changes.find((change) => change.field === "style");
    const which = edge.index > 0 ? `link ${edge.index + 1}` : "link";
    if (label) lines.push(`Changed the ${which} from ${edge.from} to ${edge.to}: label from \`${label.from}\` to \`${label.to}\`.`);
    else lines.push(`Changed the ${which} from ${edge.from} to ${edge.to}.`);
    if (arrow) lines.push(`Changed the line from ${edge.from} to ${edge.to} from ${arrow.from} to ${arrow.to}.`);
    if (style) lines.push(`Changed the style of the link from ${edge.from} to ${edge.to}.`);
  }
  for (const click of input.clicks.added) lines.push(`Added a click on ${click.nodeId} to \`${click.target}\`.`);
  for (const click of input.clicks.removed) lines.push(`Removed the click on ${click.nodeId}.`);
  for (const click of input.clicks.changed) {
    lines.push(`Changed the click on ${click.nodeId} from \`${click.from}\` to \`${click.to}\`.`);
  }
  for (const subgraph of input.subgraphs.added) lines.push(`Added subgraph ${subgraph.title}.`);
  for (const subgraph of input.subgraphs.removed) lines.push(`Removed subgraph ${subgraph.title}.`);
  for (const subgraph of input.subgraphs.changed) {
    lines.push(`Renamed subgraph ${subgraph.id} from \`${subgraph.from}\` to \`${subgraph.to}\`.`);
  }
  for (const change of input.frontMatter) {
    lines.push(`Changed front matter ${change.field} from \`${change.from}\` to \`${change.to}\`.`);
  }
  if (lines.filter((line) => line !== SEMANTIC_NOTE).length === 0) {
    if (input.textChanged) lines.push("The diagram text changed. See the text diff.");
    else lines.push(input.semantic ? "No changes." : "No node or edge changes to report. See the text diff.");
    if (!input.semantic) return lines.filter((line, index) => line !== SEMANTIC_NOTE || index === 0);
  }
  return lines;
}

function movedSentence(id: string, from: string, to: string): string {
  if (!from) return `Moved ${id} into subgraph ${to}.`;
  if (!to) return `Moved ${id} out of subgraph ${from}.`;
  return `Moved ${id} from subgraph ${from} into ${to}.`;
}

function linkSentence(verb: string, from: string, to: string, label: string): string {
  const base = `${verb} ${from} to ${to}.`;
  return label ? base.replace(/\.$/, ` ("${label}").`) : base;
}

function renderMarkdown(diff: DiagramDiff, fromLabel: string, toLabel: string): string {
  const lines = [
    "# Diagram changes",
    "",
    `From: ${fromLabel}`,
    `To: ${toLabel}`,
    "",
    "This comparison is read-only. It does not change the diagram.",
    "",
  ];
  if (diff.note) {
    lines.push(diff.note, "");
  }
  lines.push("## Summary", "");
  for (const line of diff.summary) lines.push(`- ${line}`);
  lines.push("");
  if (diff.semantic) {
    lines.push("## Nodes", "");
    lines.push(...sectionLines("Added", diff.nodes.added.map(describeNode)));
    lines.push(...sectionLines("Removed", diff.nodes.removed.map(describeNode)));
    lines.push(
      ...sectionLines(
        "Changed",
        diff.nodes.changed.map((node) => `${node.id}: ${node.changes.map((change) => `${change.field} \`${change.from}\` → \`${change.to}\``).join("; ")}`),
      ),
    );
    lines.push("## Edges", "");
    lines.push(...sectionLines("Added", diff.edges.added.map(describeEdge)));
    lines.push(...sectionLines("Removed", diff.edges.removed.map(describeEdge)));
    lines.push(
      ...sectionLines(
        "Changed",
        diff.edges.changed.map((edge) => `${edge.from} → ${edge.to}: ${edge.changes.map((change) => change.field).join(", ")}`),
      ),
    );
  }
  lines.push("## Front matter", "");
  if (diff.frontMatter.length === 0) lines.push("No front matter changes.", "");
  else {
    for (const change of diff.frontMatter) lines.push(`- ${change.field}: \`${change.from}\` → \`${change.to}\``);
    lines.push("");
  }
  lines.push("## Text diff", "", "```diff");
  lines.push(diff.text.unified || "(no text changes)");
  lines.push("```", "");
  return lines.join("\n");
}

function sectionLines(title: string, items: string[]): string[] {
  if (items.length === 0) return [`### ${title}`, "", "None.", ""];
  return [`### ${title}`, "", ...items.map((item) => `- ${item}`), ""];
}

function describeNode(node: NodeSnap): string {
  const label = node.label && node.label !== node.id ? ` (${node.label})` : "";
  const where = node.subgraph ? ` in ${node.subgraph}` : "";
  return `${node.id}${label}${where}`;
}

function describeEdge(edge: EdgeSnap): string {
  const label = edge.label ? ` "${edge.label}"` : "";
  return `${edge.from} ${edge.arrow}${label} ${edge.to}`;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function orderedKeys(primary: Map<string, unknown>, secondary: Map<string, unknown>): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of primary.keys()) {
    keys.push(key);
    seen.add(key);
  }
  for (const key of secondary.keys()) {
    if (seen.has(key)) continue;
    keys.push(key);
    seen.add(key);
  }
  return keys;
}
