/**
 * Side-by-side compare keeps each revision's own Mermaid, then paints the
 * legend colours on top. Added nodes exist only on To, removed nodes only on
 * From. Changed and unchanged items are on both.
 */

export type DiffStatus = "added" | "removed" | "changed" | "same";

export type SideDiffModel = {
  nodes?: {
    added?: { id: string }[];
    removed?: { id: string }[];
    changed?: { id: string }[];
  };
  edges?: {
    added?: { from: string; to: string; index: number }[];
    removed?: { from: string; to: string; index: number }[];
    changed?: { from: string; to: string; index: number }[];
  };
};

export const DIFF_STATUS_CLASS: Record<DiffStatus, string> = {
  added: "ngAdded",
  removed: "ngRemoved",
  changed: "ngChanged",
  same: "ngSame",
};

type EdgeRef = { from: string; to: string; index: number };

export function nodeStatus(side: "from" | "to", id: string, model: SideDiffModel): DiffStatus | null {
  const nodes = model.nodes;
  if (nodes?.added?.some((node) => node.id === id)) return side === "to" ? "added" : null;
  if (nodes?.removed?.some((node) => node.id === id)) return side === "from" ? "removed" : null;
  if (nodes?.changed?.some((node) => node.id === id)) return "changed";
  return "same";
}

export function edgeStatus(side: "from" | "to", edge: EdgeRef, model: SideDiffModel): DiffStatus | null {
  const same = (item: EdgeRef) => item.from === edge.from && item.to === edge.to && item.index === edge.index;
  if (model.edges?.added?.some(same)) return side === "to" ? "added" : null;
  if (model.edges?.removed?.some(same)) return side === "from" ? "removed" : null;
  if (model.edges?.changed?.some(same)) return "changed";
  return "same";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownNodeIds(model: SideDiffModel): string[] {
  const ids = [
    ...(model.nodes?.added ?? []),
    ...(model.nodes?.removed ?? []),
    ...(model.nodes?.changed ?? []),
  ].map((node) => node.id);
  return [...new Set(ids)];
}

function knownEdges(model: SideDiffModel): EdgeRef[] {
  return [...(model.edges?.added ?? []), ...(model.edges?.removed ?? []), ...(model.edges?.changed ?? [])];
}

/**
 * Mermaid flowchart ids look like `flowchart-<id>-0` or `L_<from>_<to>_<index>`.
 * A render prefixes them, for example `nerdgram-4-flowchart-<id>-0`.
 */
export function nodeIdFromElement(element: Element, known: string[]): string | null {
  const dataId = element.getAttribute("data-id");
  if (dataId) return dataId;
  const raw = element.getAttribute("id") ?? "";
  if (!raw) return null;
  if (known.includes(raw)) return raw;
  const hits = known.filter((id) => new RegExp(`(?:^|-)${escapeRegExp(`flowchart-${id}`)}-\\d+$`).test(raw));
  hits.sort((left, right) => right.length - left.length);
  if (hits[0]) return hits[0];
  const generic = raw.match(/(?:^|-)flowchart-(.+)-\d+$/);
  return generic?.[1] ?? null;
}

function edgeFromElement(element: Element, model: SideDiffModel): EdgeRef | null {
  const id = element.getAttribute("id") ?? "";
  if (!id) return null;
  for (const edge of knownEdges(model)) {
    const solid = `L_${edge.from}_${edge.to}_${edge.index}`;
    const dashed = `L-${edge.from}-${edge.to}-${edge.index}`;
    if (id === solid || id === dashed || id.endsWith(`-${solid}`) || id.endsWith(`-${dashed}`)) return edge;
  }
  return null;
}

function paint(element: Element, status: DiffStatus | null): void {
  if (!status) return;
  element.classList.add(DIFF_STATUS_CLASS[status]);
}

/**
 * Scale the drawing to its column and mark added, removed, changed, and
 * unchanged nodes and links. The returned markup is what Side by side shows.
 */
export function prepareSideSvg(svg: string, side: "from" | "to", model: SideDiffModel): string {
  if (!svg.trim() || typeof DOMParser === "undefined") return svg;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.querySelector("svg");
  if (!root || doc.querySelector("parsererror")) return svg;
  root.setAttribute("width", "100%");
  root.removeAttribute("height");
  const style = root.getAttribute("style") ?? "";
  const cleaned = style
    .replace(/(?:^|;)\s*(?:max-width|width|height)\s*:[^;]*/gi, "")
    .replace(/^;+|;+$/g, "")
    .trim();
  if (cleaned) root.setAttribute("style", cleaned);
  else root.removeAttribute("style");

  const ids = knownNodeIds(model);
  for (const node of doc.querySelectorAll("g.node")) {
    const id = nodeIdFromElement(node, ids);
    if (!id) continue;
    paint(node, nodeStatus(side, id, model));
  }
  for (const path of doc.querySelectorAll("path.flowchart-link, g.edgePath")) {
    const edge = edgeFromElement(path, model);
    const status = edge ? edgeStatus(side, edge, model) : path.getAttribute("id") ? "same" : null;
    paint(path, status);
    const parent = path.parentElement;
    if (parent?.classList.contains("edgePath")) paint(parent, status);
  }
  return new XMLSerializer().serializeToString(root);
}
