/**
 * Map a click in the rendered preview back to the source line that defined it.
 *
 * Mermaid writes diagram ids into SVG ids and data attributes. This module
 * reads those and finds the defining line. When the click cannot be tied to
 * one statement, it returns null so the editor stays put.
 *
 * Id shapes this matches (render prefix such as `nerdgram-1-` is ignored):
 * - flowchart node `flowchart-{id}-{n}`, edge `L_{from}_{to}_{n}`, cluster `{subgraphId}`
 * - sequence participant `data-id` / `name`, message `data-id="i{n}"`
 * - class `classId-{name}-{n}`, relation `id_{from}_{to}_{n}` (n is 1-based across all relations)
 * - state `state-{id}-{n}`, transition `edge{n}` (notes consume a number without being `edgeN`)
 * - ER entity `entity-{name}-{n}`, relationship `id_{entity-A-i}_{entity-B-j}_{n}`
 *
 * Flowchart's second edge between the same nodes is `L_A_B_2`, then `L_A_B_3`.
 * The first is `_0`. That skip is Mermaid's counter, not a missing edge.
 */

export type SourceAnchor = {
  id: string;
  className: string;
  dataId: string | null;
  dataEt: string | null;
  dataFrom: string | null;
  dataTo: string | null;
  name: string | null;
  tag: string;
  text: string;
};

export type SourceLocation = {
  /** 1-based line in the editor buffer, including front matter. */
  line: number;
  /** 0-based column of the identifier, or of the statement when it has none. */
  column: number;
};

type ElementLike = {
  getAttribute(name: string): string | null;
  parentElement: ElementLike | null;
  nextElementSibling: ElementLike | null;
  previousElementSibling: ElementLike | null;
  textContent: string | null;
  tagName?: string;
};

const ID = "[A-Za-z_][\\w-]*";
const ID_RE = new RegExp(`^(?:${ID})`);
const CLICK_SLOP_PX = 6;

/** A pointer move larger than this is a drag, not a click. Matches presentation. */
export function pointerMovedPastClick(dx: number, dy: number, slop = CLICK_SLOP_PX): boolean {
  return Math.hypot(dx, dy) > slop;
}

/**
 * True when the line already sits inside the scroller with a margin, so a
 * click should not move the scroll position.
 */
export function lineIsComfortablyVisible(
  viewTop: number,
  viewBottom: number,
  lineTop: number,
  lineBottom: number,
): boolean {
  const height = viewBottom - viewTop;
  if (!(height > 0)) return false;
  const margin = Math.min(48, height * 0.12);
  return lineTop >= viewTop + margin && lineBottom <= viewBottom - margin;
}

export function anchorsFromElement(target: unknown): SourceAnchor[] {
  const start = elementLike(target);
  if (!start) return [];
  const chain: SourceAnchor[] = [];
  let current: ElementLike | null = start;
  let depth = 0;
  while (current && depth < 24) {
    chain.push(toAnchor(current));
    if (hasClass(current, "messageText")) {
      const next = current.nextElementSibling;
      if (next && hasClass(next, "messageLine")) chain.push(toAnchor(next));
    }
    if (hasClass(current, "actor") && !current.getAttribute("data-id") && !current.getAttribute("name")) {
      const prev = current.previousElementSibling;
      if (prev?.getAttribute("name") || prev?.getAttribute("data-id")) chain.push(toAnchor(prev));
    }
    current = current.parentElement;
    depth += 1;
  }
  return chain;
}

export function sourceLocationForElement(source: string, chain: readonly SourceAnchor[]): SourceLocation | null {
  if (!source.trim() || chain.length === 0) return null;
  const model = parseModel(source);
  if (!model) return null;
  const text = labelText(chain);
  for (const anchor of chain) {
    const hit = locate(model, anchor, text);
    if (hit) return hit;
  }
  return null;
}

type Occurrence = { line: number; column: number; defined: boolean };

type EdgeHit = { from: string; to: string; line: number; column: number; key: string };

type MemberHit = { owner: string; line: number; column: number; text: string };

type Model =
  | {
      kind: "flowchart";
      nodes: Map<string, Occurrence[]>;
      edges: EdgeHit[];
      subgraphs: { id: string; line: number; column: number }[];
    }
  | {
      kind: "sequence";
      actors: Map<string, Occurrence[]>;
      aliases: { alias: string; id: string; line: number; column: number }[];
      records: { from: string; to: string; text: string; line: number; column: number; note: boolean }[];
    }
  | {
      kind: "class";
      classes: Map<string, Occurrence[]>;
      members: MemberHit[];
      relations: { from: string; to: string; line: number; column: number }[];
    }
  | {
      kind: "state";
      states: Map<string, Occurrence[]>;
      edges: { key: string; line: number; column: number }[];
      notes: { line: number; column: number; text: string }[];
    }
  | {
      kind: "er";
      entities: Map<string, Occurrence[]>;
      domIds: Map<string, string>;
      attributes: MemberHit[];
      relations: { from: string; to: string; fromDom: string; toDom: string; line: number; column: number }[];
    };

function locate(model: Model, anchor: SourceAnchor, text: string): SourceLocation | null {
  if (model.kind === "flowchart") return locateFlow(model, anchor);
  if (model.kind === "sequence") return locateSequence(model, anchor, text);
  if (model.kind === "class") return locateClass(model, anchor, text);
  if (model.kind === "state") return locateState(model, anchor, text);
  return locateEr(model, anchor, text);
}

function locateFlow(
  model: Extract<Model, { kind: "flowchart" }>,
  anchor: SourceAnchor,
): SourceLocation | null {
  const token = anchor.dataId || edgeToken(anchor.id);
  const edge = token ? matchFlowEdge(token, [...model.nodes.keys()]) : null;
  if (edge) {
    const ordinal = flowEdgeOrdinal(edge.counter);
    if (ordinal < 0) return null;
    const hits = model.edges.filter((item) => item.from === edge.from && item.to === edge.to);
    const found = hits[ordinal];
    return found ? { line: found.line, column: found.column } : null;
  }
  if (hasToken(anchor.className, "cluster")) {
    const subgraph = matchSubgraph(anchor.id, model.subgraphs);
    if (subgraph) return { line: subgraph.line, column: subgraph.column };
  }
  const nodeId = matchPrefixedId(anchor.id, "flowchart-", [...model.nodes.keys()]);
  if (!nodeId) return null;
  return best(model.nodes.get(nodeId) ?? []);
}

function locateSequence(
  model: Extract<Model, { kind: "sequence" }>,
  anchor: SourceAnchor,
  text: string,
): SourceLocation | null {
  const messageId = anchor.dataId && /^i\d+$/.test(anchor.dataId) ? anchor.dataId : null;
  const isMessage = anchor.dataEt === "message" || messageId != null || hasToken(anchor.className, "messageLine");
  if (isMessage) {
    const index = messageId ? Number(messageId.slice(1)) : -1;
    const record = model.records[index];
    if (!record || record.note) return null;
    if (anchor.dataFrom && anchor.dataFrom !== record.from) return null;
    if (anchor.dataTo && anchor.dataTo !== record.to) return null;
    if (text && !sameText(record.text, text)) return null;
    return { line: record.line, column: record.column };
  }
  const actorId = actorIdFrom(anchor, model);
  if (actorId) return best(model.actors.get(actorId) ?? []);
  if (text && hasToken(anchor.className, "messageText")) {
    const matches = model.records.filter((record) => !record.note && sameText(record.text, text));
    if (matches.length === 1) return { line: matches[0].line, column: matches[0].column };
  }
  if (text && hasToken(anchor.className, "actor")) {
    const alias = model.aliases.filter((item) => sameText(item.alias, text) || sameText(item.id, text));
    if (alias.length === 1) return best(model.actors.get(alias[0].id) ?? []);
  }
  return null;
}

function locateClass(
  model: Extract<Model, { kind: "class" }>,
  anchor: SourceAnchor,
  text: string,
): SourceLocation | null {
  const token = anchor.dataId || edgeToken(anchor.id);
  const relation = token ? matchUnderscoreEdge(token, "id_", [...model.classes.keys()]) : null;
  if (relation) {
    const found = model.relations[relation.counter - 1];
    if (!found || found.from !== relation.from || found.to !== relation.to) return null;
    return { line: found.line, column: found.column };
  }
  const classId = matchPrefixedId(anchor.id, "classId-", [...model.classes.keys()]);
  if (!classId) return null;
  const member = text && !sameText(text, classId) ? uniqueMember(model.members, classId, text) : null;
  if (member) return { line: member.line, column: member.column };
  return best(model.classes.get(classId) ?? []);
}

function locateState(
  model: Extract<Model, { kind: "state" }>,
  anchor: SourceAnchor,
  text: string,
): SourceLocation | null {
  if (hasToken(anchor.className, "statediagram-note") || hasToken(anchor.className, "note-cluster") || anchor.id.includes("----note")) {
    if (text) {
      const notes = model.notes.filter((note) => note.text.includes(text) || text.includes(note.text));
      if (notes.length === 1) return { line: notes[0].line, column: notes[0].column };
    }
    if (model.notes.length === 1) return { line: model.notes[0].line, column: model.notes[0].column };
    return null;
  }
  const edgeKey = anchor.dataId && /^edge\d+$/.test(anchor.dataId) ? anchor.dataId : edgeKeyFromId(anchor.id);
  if (edgeKey) {
    const found = model.edges.find((edge) => edge.key === edgeKey);
    return found ? { line: found.line, column: found.column } : null;
  }
  const fromData = anchor.dataId && model.states.has(anchor.dataId) ? anchor.dataId : null;
  const stateId = fromData ?? matchPrefixedId(anchor.id, "state-", [...model.states.keys()]);
  if (!stateId) return null;
  return best(model.states.get(stateId) ?? []);
}

function locateEr(
  model: Extract<Model, { kind: "er" }>,
  anchor: SourceAnchor,
  text: string,
): SourceLocation | null {
  const token = anchor.dataId || edgeToken(anchor.id);
  const relation = token ? matchErEdge(token) : null;
  if (relation) {
    const found = model.relations[relation.counter];
    if (!found || found.fromDom !== relation.fromDom || found.toDom !== relation.toDom) return null;
    return { line: found.line, column: found.column };
  }
  const domId = matchEntityDom(anchor.id, model.domIds);
  const name = domId ? nameForDom(domId, model.domIds) : null;
  if (!name) return null;
  const attribute = text && !sameText(text, name) ? uniqueMember(model.attributes, name, text) : null;
  if (attribute) return { line: attribute.line, column: attribute.column };
  return best(model.entities.get(name) ?? []);
}

function parseModel(source: string): Model | null {
  const lines = sourceLines(source);
  const kind = diagramKind(lines);
  if (kind === "flowchart") return parseFlow(lines);
  if (kind === "sequence") return parseSequence(lines);
  if (kind === "class") return parseClass(lines);
  if (kind === "state") return parseState(lines);
  if (kind === "er") return parseEr(lines);
  return null;
}

type Line = { line: number; text: string };

function sourceLines(source: string): Line[] {
  const raw = source.split(/\r?\n/);
  let start = 0;
  if ((raw[0] ?? "").replace(/^\uFEFF/, "").trim() === "---") {
    start = 1;
    while (start < raw.length && (raw[start] ?? "").trim() !== "---") start += 1;
    if (start < raw.length) start += 1;
  }
  const lines: Line[] = [];
  for (let index = start; index < raw.length; index += 1) {
    const text = raw[index] ?? "";
    if (!text.trim() || /^\s*%%/.test(text)) continue;
    lines.push({ line: index + 1, text });
  }
  return lines;
}

function diagramKind(lines: readonly Line[]): string {
  for (const { text } of lines) {
    const trimmed = text.trim();
    if (/^(?:flowchart(?:-elk)?|graph|swimlane(?:-beta)?)\b/i.test(trimmed)) return "flowchart";
    if (/^sequenceDiagram\b/i.test(trimmed)) return "sequence";
    if (/^classDiagram\b/i.test(trimmed)) return "class";
    if (/^stateDiagram(?:-v2)?\b/i.test(trimmed)) return "state";
    if (/^erDiagram\b/i.test(trimmed)) return "er";
    return "other";
  }
  return "other";
}

function parseFlow(lines: readonly Line[]): Model {
  const nodes = new Map<string, Occurrence[]>();
  const edges: EdgeHit[] = [];
  const subgraphs: { id: string; line: number; column: number }[] = [];
  let subCount = 0;
  for (const { line, text } of lines) {
    const trimmed = text.trim();
    if (/^(?:flowchart(?:-elk)?|graph|direction|accTitle|accDescr|classDef|click|linkStyle|style)\b/i.test(trimmed)) {
      continue;
    }
    if (/^class\s+/i.test(trimmed)) continue;
    if (/^\s*end\b/i.test(trimmed)) continue;
    const subgraph = /^subgraph\s+([\s\S]+)$/i.exec(trimmed);
    if (subgraph?.[1]) {
      const header = parseSubgraphHeader(text, subgraph[1]);
      const id = header.id ?? `subGraph${subCount}`;
      subCount += 1;
      subgraphs.push({ id, line, column: header.column });
      continue;
    }
    for (const statement of splitStatements(text)) {
      readFlowStatement(statement, line, nodes, edges);
    }
  }
  return { kind: "flowchart", nodes, edges, subgraphs };
}

function parseSequence(lines: readonly Line[]): Model {
  const actors = new Map<string, Occurrence[]>();
  const aliases: { alias: string; id: string; line: number; column: number }[] = [];
  const records: { from: string; to: string; text: string; line: number; column: number; note: boolean }[] = [];
  for (const { line, text } of lines) {
    if (/^sequenceDiagram\b/i.test(text.trim())) continue;
    const declared = /^\s*(?:participant|actor)\s+(\S+?)(?:\s+as\s+(.+?))?\s*$/i.exec(text);
    if (declared?.[1]) {
      const id = declared[1];
      const column = Math.max(0, text.indexOf(id));
      pushOcc(actors, id, { line, column, defined: true });
      const alias = declared[2]?.trim();
      if (alias) aliases.push({ alias, id, line, column });
      continue;
    }
    const note = /^\s*note\b/i.exec(text);
    if (note) {
      const message = /:\s*(.*)$/.exec(text);
      records.push({
        from: "",
        to: "",
        text: message?.[1]?.trim() ?? "",
        line,
        column: indentOf(text),
        note: true,
      });
      continue;
    }
    const message = /^\s*(\S+?)\s*(--?(?:>>|[>x)]))[+-]?\s*(\S+?)\s*:\s*(.*)$/.exec(text);
    if (!message?.[1] || !message[3]) continue;
    const column = Math.max(0, text.indexOf(message[1]));
    pushOcc(actors, message[1], { line, column, defined: false });
    const toAt = text.indexOf(message[3], column + message[1].length);
    pushOcc(actors, message[3], { line, column: Math.max(0, toAt), defined: false });
    records.push({
      from: message[1],
      to: message[3],
      text: (message[4] ?? "").trim(),
      line,
      column,
      note: false,
    });
  }
  return { kind: "sequence", actors, aliases, records };
}

const CLASS_ARROWS = [
  "<|--|>",
  "*--*",
  "o--o",
  "<|--",
  "--|>",
  "<|..",
  "..|>",
  "*--",
  "--*",
  "o--",
  "--o",
  "<-->",
  "-->",
  "<--",
  "..>",
  "<..",
  "--",
  "..",
].sort((a, b) => b.length - a.length);

function parseClass(lines: readonly Line[]): Model {
  const classes = new Map<string, Occurrence[]>();
  const members: MemberHit[] = [];
  const relations: { from: string; to: string; line: number; column: number }[] = [];
  let depth = 0;
  let current = "";
  for (const { line, text } of lines) {
    const trimmed = text.trim();
    if (/^classDiagram\b/i.test(trimmed) || /^(?:direction|namespace|note|style|cssClass|classDef|click|link|callback)\b/i.test(trimmed)) {
      continue;
    }
    if (depth > 0) {
      if (trimmed === "}" || trimmed.startsWith("}")) {
        depth -= 1;
        if (depth === 0) current = "";
        const rest = trimmed.replace(/^}\s*/, "").trim();
        if (!rest) continue;
      } else {
        const column = indentOf(text);
        members.push({ owner: current, line, column, text: trimmed });
        continue;
      }
    }
    const decl = /^\s*class\s+([A-Za-z_][\w-]*)/.exec(text);
    if (decl?.[1]) {
      const column = Math.max(0, text.indexOf(decl[1]));
      pushOcc(classes, decl[1], { line, column, defined: true });
      if (trimmed.includes("{") && !trimmed.includes("}")) {
        depth = 1;
        current = decl[1];
      }
      continue;
    }
    const arrowAt = findToken(text, CLASS_ARROWS);
    if (arrowAt) {
      const left = lastId(text.slice(0, arrowAt.index));
      const right = firstId(text.slice(arrowAt.index + arrowAt.length));
      if (left && right) {
        pushOcc(classes, left.id, { line, column: left.index, defined: false });
        const rightColumn = arrowAt.index + arrowAt.length + right.index;
        pushOcc(classes, right.id, { line, column: rightColumn, defined: false });
        relations.push({ from: left.id, to: right.id, line, column: left.index });
      }
      continue;
    }
    const member = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(text);
    if (member?.[1] && member[2]) {
      const column = Math.max(0, text.indexOf(member[1]));
      pushOcc(classes, member[1], { line, column, defined: false });
      members.push({ owner: member[1], line, column: text.indexOf(member[2]), text: member[2].trim() });
    }
  }
  return { kind: "class", classes, members, relations };
}

function parseState(lines: readonly Line[]): Model {
  const states = new Map<string, Occurrence[]>();
  const edges: { key: string; line: number; column: number }[] = [];
  const notes: { line: number; column: number; text: string }[] = [];
  let count = 0;
  for (const { line, text } of lines) {
    const trimmed = text.trim();
    if (/^stateDiagram(?:-v2)?\b/i.test(trimmed) || /^direction\b/i.test(trimmed)) continue;
    if (/^\s*note\b/i.test(trimmed)) {
      const message = /:\s*(.*)$/.exec(text);
      notes.push({ line, column: indentOf(text), text: message?.[1]?.trim() ?? trimmed });
      count += 1;
      continue;
    }
    const named = /^\s*state\s+"([^"]*)"\s+as\s+([A-Za-z_][\w-]*)/i.exec(text);
    if (named?.[2]) {
      pushOcc(states, named[2], { line, column: text.lastIndexOf(named[2]), defined: true });
    } else {
      const bare = /^\s*state\s+([A-Za-z_][\w-]*)\b/i.exec(text);
      if (bare?.[1] && bare[1].toLowerCase() !== "diagram") {
        pushOcc(states, bare[1], { line, column: Math.max(0, text.indexOf(bare[1])), defined: true });
      }
    }
    const transition = /^\s*(\[\*\]|[A-Za-z_][\w-]*)\s*-->\s*(\[\*\]|[A-Za-z_][\w-]*)/.exec(text);
    if (!transition?.[1] || !transition[2]) continue;
    const column = Math.max(0, text.indexOf(transition[1]));
    if (transition[1] !== "[*]") {
      pushOcc(states, transition[1], { line, column, defined: false });
    }
    if (transition[2] !== "[*]") {
      const at = text.indexOf(transition[2], column + transition[1].length);
      pushOcc(states, transition[2], { line, column: Math.max(0, at), defined: false });
    }
    edges.push({ key: `edge${count}`, line, column });
    count += 1;
  }
  return { kind: "state", states, edges, notes };
}

function parseEr(lines: readonly Line[]): Model {
  const entities = new Map<string, Occurrence[]>();
  const domIds = new Map<string, string>();
  const attributes: MemberHit[] = [];
  const relations: { from: string; to: string; fromDom: string; toDom: string; line: number; column: number }[] = [];
  const order: string[] = [];
  let depth = 0;
  let current = "";
  const ensure = (name: string, line: number, column: number, defined: boolean) => {
    if (!domIds.has(name)) {
      domIds.set(name, `entity-${name}-${order.length}`);
      order.push(name);
    }
    pushOcc(entities, name, { line, column, defined });
  };
  for (const { line, text } of lines) {
    const trimmed = text.trim();
    if (/^erDiagram\b/i.test(trimmed) || /^direction\b/i.test(trimmed)) continue;
    if (depth > 0) {
      if (trimmed === "}" || trimmed.startsWith("}")) {
        depth = 0;
        current = "";
        continue;
      }
      const attr = /^([A-Za-z_][\w-]*)\s+([A-Za-z_][\w-]*)\b/.exec(trimmed);
      if (attr?.[2]) {
        attributes.push({
          owner: current,
          line,
          column: text.indexOf(attr[2], text.indexOf(attr[1]) + attr[1].length),
          text: attr[2],
        });
      }
      continue;
    }
    const rel = /^([A-Za-z_][\w-]*)\s+(\S+)\s+([A-Za-z_][\w-]*)\b/.exec(trimmed);
    if (rel?.[1] && rel[2] && rel[3] && (/--/.test(rel[2]) || rel[2].includes(".."))) {
      const fromColumn = Math.max(0, text.indexOf(rel[1]));
      ensure(rel[1], line, fromColumn, false);
      const toColumn = text.indexOf(rel[3], fromColumn + rel[1].length);
      ensure(rel[3], line, Math.max(0, toColumn), false);
      relations.push({
        from: rel[1],
        to: rel[3],
        fromDom: domIds.get(rel[1]) ?? "",
        toDom: domIds.get(rel[3]) ?? "",
        line,
        column: fromColumn,
      });
      continue;
    }
    const block = /^([A-Za-z_][\w-]*)\s*\{/.exec(trimmed);
    if (block?.[1]) {
      const column = Math.max(0, text.indexOf(block[1]));
      ensure(block[1], line, column, true);
      if (!trimmed.includes("}")) {
        depth = 1;
        current = block[1];
      }
    }
  }
  return { kind: "er", entities, domIds, attributes, relations };
}

function readFlowStatement(
  text: string,
  line: number,
  nodes: Map<string, Occurrence[]>,
  edges: EdgeHit[],
): void {
  const pieces = splitArrows(text);
  const groups: { id: string; column: number; defined: boolean }[][] = [];
  let arrows = 0;
  for (const piece of pieces) {
    if (piece.arrow) {
      arrows += 1;
      continue;
    }
    groups.push(readNodeGroup(piece.text, piece.offset));
  }
  for (const group of groups) {
    for (const node of group) {
      pushOcc(nodes, node.id, { line, column: node.column, defined: arrows === 0 || node.defined });
    }
  }
  if (arrows === 0) return;
  let arrowIndex = 0;
  for (const piece of pieces) {
    if (!piece.arrow) continue;
    const left = groups[arrowIndex] ?? [];
    const right = groups[arrowIndex + 1] ?? [];
    for (const from of left) {
      for (const to of right) {
        edges.push({ from: from.id, to: to.id, line, column: from.column, key: "" });
      }
    }
    arrowIndex += 1;
  }
}

function readNodeGroup(text: string, base: number): { id: string; column: number; defined: boolean }[] {
  const nodes: { id: string; column: number; defined: boolean }[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (/\s/.test(char) || char === "&" || char === ";") {
      index += 1;
      continue;
    }
    const idMatch = ID_RE.exec(text.slice(index));
    if (!idMatch) {
      index += 1;
      continue;
    }
    const id = idMatch[0];
    const column = base + index;
    let cursor = index + id.length;
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
    const shapeEnd = shapeEndAt(text, cursor);
    if (shapeEnd > cursor) cursor = shapeEnd;
    while (text.startsWith(":::", cursor)) {
      const mark = new RegExp(`^:::(?:${ID})`).exec(text.slice(cursor));
      if (!mark) break;
      cursor += mark[0].length;
    }
    nodes.push({ id, column, defined: shapeEnd > index + id.length });
    index = Math.max(cursor, index + id.length);
  }
  return nodes;
}

const FLOW_ARROWS = ["<-->", "o--o", "x--x", "<--", "-->", "---", "-.->", "-.-", "==>", "===", "--o", "--x", "~~~"].sort(
  (a, b) => b.length - a.length,
);

function splitArrows(text: string): { text: string; offset: number; arrow: boolean }[] {
  const pieces: { text: string; offset: number; arrow: boolean }[] = [];
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
    if (char === "]" || char === ")" || char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    const length = matchFlowArrow(text, index);
    if (!length) continue;
    pieces.push({ text: text.slice(start, index), offset: start, arrow: false });
    pieces.push({ text: text.slice(index, index + length), offset: index, arrow: true });
    start = index + length;
    index += length - 1;
  }
  pieces.push({ text: text.slice(start), offset: start, arrow: false });
  return pieces;
}

function matchFlowArrow(text: string, index: number): number {
  if (text.startsWith("--", index) && /\s/.test(text[index + 2] ?? "") && !text.startsWith("---", index)) {
    for (let cursor = index + 2; cursor < text.length; cursor += 1) {
      if (text.startsWith("-->", cursor) || text.startsWith("---", cursor)) return cursor + 3 - index;
    }
  }
  for (const arrow of FLOW_ARROWS) {
    if (!text.startsWith(arrow, index)) continue;
    let length = arrow.length;
    if (text[index + length] === "|") {
      const close = text.indexOf("|", index + length + 1);
      if (close !== -1) length = close + 1 - index;
    }
    return length;
  }
  return 0;
}

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
  return parts.filter((part) => part.trim().length > 0);
}

function shapeEndAt(text: string, index: number): number {
  if (text.startsWith("@{", index)) {
    const end = text.indexOf("}", index + 2);
    return end === -1 ? index : end + 1;
  }
  const pairs: [string, string[]][] = [
    ["[[", ["]]"]],
    ["[(", [")]"]],
    ["([", ["])"]],
    ["((", ["))"]],
    ["[/", ["/]", "\\]"]],
    ["[\\", ["\\]", "/]"]],
    ["{{", ["}}"]],
    ["[", ["]"]],
    ["(", [")"]],
    ["{", ["}"]],
    [">", ["]"]],
  ];
  for (const [open, closes] of pairs) {
    if (!text.startsWith(open, index)) continue;
    let depth = 1;
    for (let cursor = index + open.length; cursor < text.length; cursor += 1) {
      if (open !== ">" && text.startsWith(open, cursor)) {
        depth += 1;
        cursor += open.length - 1;
        continue;
      }
      const close = closes.find((item) => text.startsWith(item, cursor));
      if (!close) continue;
      depth -= 1;
      if (depth === 0) return cursor + close.length;
      cursor += close.length - 1;
    }
  }
  return index;
}

function parseSubgraphHeader(line: string, rest: string): { id: string | null; column: number } {
  const trimmed = rest.trim().replace(/;$/, "").trim();
  const bracket = new RegExp(`^(${ID})\\s*(?:\\[[\\s\\S]*\\]|\\([\\s\\S]*\\))\\s*$`).exec(trimmed);
  if (bracket?.[1]) {
    const at = line.indexOf(bracket[1]);
    return { id: bracket[1], column: at < 0 ? indentOf(line) : at };
  }
  if (!trimmed || /\s/.test(trimmed)) return { id: null, column: indentOf(line) };
  const at = line.indexOf(trimmed);
  return { id: trimmed, column: at < 0 ? indentOf(line) : at };
}

function flowEdgeOrdinal(counter: number): number {
  if (counter === 0) return 0;
  if (counter === 1) return -1;
  return counter - 1;
}

function matchFlowEdge(token: string, nodeIds: readonly string[]): { from: string; to: string; counter: number } | null {
  return matchUnderscoreEdge(token, "L_", nodeIds);
}

function matchUnderscoreEdge(
  token: string,
  prefix: string,
  nodeIds: readonly string[],
): { from: string; to: string; counter: number } | null {
  if (!token.startsWith(prefix)) return null;
  const body = token.slice(prefix.length);
  const counterMatch = /_(\d+)$/.exec(body);
  if (!counterMatch?.[1]) return null;
  const counter = Number(counterMatch[1]);
  const middle = body.slice(0, body.length - counterMatch[0].length);
  let best: { from: string; to: string } | null = null;
  let score = -1;
  for (const from of nodeIds) {
    const mark = `${from}_`;
    if (!middle.startsWith(mark)) continue;
    const to = middle.slice(mark.length);
    if (!nodeIds.includes(to)) continue;
    const next = from.length + to.length;
    if (next > score) {
      score = next;
      best = { from, to };
    }
  }
  return best ? { ...best, counter } : null;
}

function matchErEdge(token: string): { fromDom: string; toDom: string; counter: number } | null {
  const match = /^id_(entity-.+?-\d+)_(entity-.+?-\d+)_(\d+)$/.exec(token);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { fromDom: match[1], toDom: match[2], counter: Number(match[3]) };
}

function nameForDom(domId: string, domIds: Map<string, string>): string | null {
  for (const [name, id] of domIds) {
    if (id === domId) return name;
  }
  return null;
}

function matchEntityDom(elementId: string, domIds: Map<string, string>): string | null {
  let best: string | null = null;
  for (const domId of domIds.values()) {
    if (elementId === domId || elementId.endsWith(`-${domId}`)) {
      if (!best || domId.length > best.length) best = domId;
    }
  }
  return best;
}

function matchPrefixedId(elementId: string, prefix: string, ids: readonly string[]): string | null {
  let best: string | null = null;
  let from = 0;
  while (from < elementId.length) {
    const at = elementId.indexOf(prefix, from);
    if (at < 0) break;
    const rest = elementId.slice(at + prefix.length);
    for (const id of ids) {
      if (!rest.startsWith(id)) continue;
      if (!/^-\d+(?:$|[^A-Za-z0-9_-])/.test(rest.slice(id.length))) continue;
      if (!best || id.length > best.length) best = id;
    }
    from = at + prefix.length;
  }
  return best;
}

function matchSubgraph(
  elementId: string,
  subgraphs: readonly { id: string; line: number; column: number }[],
): { id: string; line: number; column: number } | null {
  let best: { id: string; line: number; column: number } | null = null;
  for (const subgraph of subgraphs) {
    if (elementId !== subgraph.id && !elementId.endsWith(`-${subgraph.id}`)) continue;
    if (!best || subgraph.id.length > best.id.length) best = subgraph;
  }
  return best;
}

function edgeToken(elementId: string): string | null {
  const markers = ["-L_", "-id_", "-edge"];
  for (const marker of markers) {
    const at = elementId.lastIndexOf(marker);
    if (at >= 0) return elementId.slice(at + 1);
  }
  if (elementId.startsWith("L_") || elementId.startsWith("id_") || /^edge\d+$/.test(elementId)) return elementId;
  return null;
}

function edgeKeyFromId(elementId: string): string | null {
  const match = /(?:^|-)(edge\d+)$/.exec(elementId);
  return match?.[1] ?? null;
}

function actorIdFrom(anchor: SourceAnchor, model: Extract<Model, { kind: "sequence" }>): string | null {
  const raw = anchor.dataId || anchor.name;
  if (raw && model.actors.has(raw)) return raw;
  return null;
}

function best(occurrences: readonly Occurrence[]): SourceLocation | null {
  if (occurrences.length === 0) return null;
  const defined = occurrences.find((item) => item.defined);
  const chosen = defined ?? occurrences[0];
  if (!chosen) return null;
  return { line: chosen.line, column: chosen.column };
}

function uniqueMember(members: readonly MemberHit[], owner: string, text: string): MemberHit | null {
  const matches = members.filter((member) => member.owner === owner && member.text.includes(text));
  return matches.length === 1 ? matches[0] ?? null : null;
}

function pushOcc(map: Map<string, Occurrence[]>, id: string, occurrence: Occurrence): void {
  const list = map.get(id);
  if (list) list.push(occurrence);
  else map.set(id, [occurrence]);
}

function labelText(chain: readonly SourceAnchor[]): string {
  for (const anchor of chain) {
    const labelish =
      /nodeLabel|edgeLabel|messageText|actor|noteLabel/.test(anchor.className) ||
      anchor.tag === "tspan" ||
      anchor.tag === "text" ||
      anchor.tag === "span" ||
      anchor.tag === "p";
    if (!labelish) continue;
    const text = anchor.text.replace(/\s+/g, " ").trim();
    if (text && text.length <= 120) return text;
  }
  return "";
}

function sameText(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

function indentOf(text: string): number {
  const match = /^\s*/.exec(text);
  return match ? match[0].length : 0;
}

function hasClass(element: ElementLike, name: string): boolean {
  return hasToken(element.getAttribute("class") ?? "", name);
}

function hasToken(className: string, name: string): boolean {
  return className.split(/\s+/).some((token) => {
    if (token === name) return true;
    // `messageLine0` is a message line. `cluster-label` is not a cluster.
    return token.startsWith(name) && /^\d/.test(token.slice(name.length));
  });
}

function findToken(text: string, tokens: readonly string[]): { index: number; length: number } | null {
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
    const token = tokens.find((item) => text.startsWith(item, index));
    if (token) return { index, length: token.length };
  }
  return null;
}

function lastId(text: string): { id: string; index: number } | null {
  const match = new RegExp(`(${ID})\\s*$`).exec(text);
  if (!match?.[1] || match.index == null) return null;
  return { id: match[1], index: match.index };
}

function firstId(text: string): { id: string; index: number } | null {
  const match = new RegExp(`^\\s*(${ID})`).exec(text);
  if (!match?.[1] || match.index == null) return null;
  return { id: match[1], index: match.index + match[0].length - match[1].length };
}

function elementLike(target: unknown): ElementLike | null {
  if (!target || typeof target !== "object") return null;
  const candidate = target as Partial<ElementLike>;
  if (typeof candidate.getAttribute !== "function") return null;
  return candidate as ElementLike;
}

function toAnchor(element: ElementLike): SourceAnchor {
  return {
    id: element.getAttribute("id") ?? "",
    className: element.getAttribute("class") ?? "",
    dataId: element.getAttribute("data-id"),
    dataEt: element.getAttribute("data-et"),
    dataFrom: element.getAttribute("data-from"),
    dataTo: element.getAttribute("data-to"),
    name: element.getAttribute("name"),
    tag: (element.tagName ?? "").toLowerCase(),
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
}
