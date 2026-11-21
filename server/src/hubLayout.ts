import { parseDiagram } from "./frontMatter.js";

export type HubLayoutMode = "compact" | "radial";

export type Point = { x: number; y: number };

const HUB_MIN_SPOKES = 8;
const CELL = 200;

export function readHubLayout(source: string): HubLayoutMode | null {
  const value = parseDiagram(source).hubLayout;
  if (value === "compact" || value === "radial") return value;
  return null;
}

/**
 * Positions for a hub and its leaf neighbors. Compact fills a grid with the
 * hub in the middle. Radial puts the hub at the center of one or more rings.
 * Both stay close to square.
 */
export function placeHubSpokes(spokeCount: number, mode: HubLayoutMode): { hub: Point; spokes: Point[] } {
  const raw = mode === "radial" ? placeRadial(spokeCount) : placeCompact(spokeCount);
  return shiftIntoView(raw);
}

function placeCompact(count: number): { hub: Point; spokes: Point[] } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count + 1)));
  const rows = Math.max(1, Math.ceil((count + 1) / cols));
  const cells: Point[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ x: col * CELL, y: row * CELL });
    }
  }
  const center = Math.floor(cells.length / 2);
  const hub = cells[center] ?? { x: 0, y: 0 };
  const spokes = cells.filter((_, index) => index !== center).slice(0, count);
  return { hub, spokes };
}

function placeRadial(count: number): { hub: Point; spokes: Point[] } {
  const spokes: Point[] = [];
  let placed = 0;
  let ring = 0;
  while (placed < count) {
    ring += 1;
    const radius = CELL * ring * 0.85;
    const capacity = Math.max(8, Math.floor((2 * Math.PI * radius) / (CELL * 0.9)));
    const take = Math.min(capacity, count - placed);
    for (let index = 0; index < take; index += 1) {
      const angle = (2 * Math.PI * index) / take - Math.PI / 2;
      spokes.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    }
    placed += take;
  }
  return { hub: { x: 0, y: 0 }, spokes };
}

function shiftIntoView(layout: { hub: Point; spokes: Point[] }): { hub: Point; spokes: Point[] } {
  const points = [layout.hub, ...layout.spokes];
  let minX = Infinity;
  let minY = Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
  }
  const dx = 160 - minX;
  const dy = 160 - minY;
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  return { hub: move(layout.hub), spokes: layout.spokes.map(move) };
}

export function boundsAspect(points: readonly Point[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return Math.max(width, height) / Math.min(width, height);
}

type GraphEdge = { from: string; to: string };

function parseGraph(body: string): { nodes: Set<string>; edges: GraphEdge[] } {
  const nodes = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%") || trimmed.startsWith("classDef") || trimmed.startsWith("class ") || trimmed.startsWith("click ")) {
      continue;
    }
    const declared = trimmed.match(/^([A-Za-z_][\w-]*)\s*(?:\[|\(|\{)/);
    if (declared?.[1]) nodes.add(declared[1]);
    const linked = trimmed.match(
      /^([A-Za-z_][\w-]*)\s+(?:-->|---|-\.->|==>|--o|--x)\s*(?:\|"[^"]*"\|)?\s*([A-Za-z_][\w-]*)\s*$/,
    );
    if (linked?.[1] && linked[2]) {
      nodes.add(linked[1]);
      nodes.add(linked[2]);
      edges.push({ from: linked[1], to: linked[2] });
    }
  }
  return { nodes, edges };
}

function hubAndSpokes(nodes: Set<string>, edges: readonly GraphEdge[]): { hub: string; spokes: string[] } | null {
  const degree = new Map<string, number>();
  const neighbors = new Map<string, Set<string>>();
  for (const id of nodes) {
    degree.set(id, 0);
    neighbors.set(id, new Set());
  }
  for (const edge of edges) {
    if (!degree.has(edge.from) || !degree.has(edge.to) || edge.from === edge.to) continue;
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    neighbors.get(edge.from)?.add(edge.to);
    neighbors.get(edge.to)?.add(edge.from);
  }
  let hub = "";
  let best = 0;
  for (const [id, count] of degree) {
    if (count > best) {
      best = count;
      hub = id;
    }
  }
  if (!hub || best < HUB_MIN_SPOKES) return null;
  const spokes = [...(neighbors.get(hub) ?? [])].filter((id) => (degree.get(id) ?? 0) === 1);
  if (spokes.length < HUB_MIN_SPOKES) return null;
  return { hub, spokes };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceNodeTranslate(svg: string, nodeId: string, point: Point): string {
  const idRe = new RegExp(`id="([^"]*flowchart-${escapeRegExp(nodeId)}-\\d+)"`);
  const found = idRe.exec(svg);
  if (!found || found.index < 0) return svg;
  const tagStart = svg.lastIndexOf("<g", found.index);
  const tagEnd = svg.indexOf(">", found.index);
  if (tagStart < 0 || tagEnd < 0) return svg;
  const tag = svg.slice(tagStart, tagEnd);
  const next = tag.replace(
    /transform="translate\([^"]*\)"/,
    `transform="translate(${Math.round(point.x)}, ${Math.round(point.y)})"`,
  );
  return svg.slice(0, tagStart) + next + svg.slice(tagEnd);
}

function replaceEdge(svg: string, from: string, to: string, d: string): string {
  for (const token of [`L_${from}_${to}_`, `L_${to}_${from}_`]) {
    const at = svg.indexOf(`data-id="${token}`);
    if (at < 0) continue;
    const tagStart = svg.lastIndexOf("<path", at);
    const tagEnd = svg.indexOf(">", at);
    if (tagStart < 0 || tagEnd < 0) continue;
    const tag = svg.slice(tagStart, tagEnd).replace(/\bd="[^"]*"/, `d="${d}"`);
    return svg.slice(0, tagStart) + tag + svg.slice(tagEnd);
  }
  return svg;
}

function setViewBox(svg: string, points: readonly Point[]): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const pad = 80;
  const x = Math.round(minX - pad);
  const y = Math.round(minY - pad);
  const width = Math.round(maxX - minX + pad * 2);
  const height = Math.round(maxY - minY + pad * 2);
  return svg.replace(/^(<svg\b[^>]*?)viewBox="[^"]+"/, `$1viewBox="${x} ${y} ${width} ${height}"`).replace(
    /^(<svg\b[^>]*?style="[^"]*?)max-width:\s*[0-9.]+px/,
    `$1max-width: ${width}px`,
  );
}

/**
 * Move a rendered hub-and-spoke flowchart into a compact grid or radial rings.
 * Ordinary diagrams, and files that do not opt in, are returned unchanged.
 */
export function relayoutHubSvg(svg: string, source: string): string {
  const mode = readHubLayout(source);
  if (!mode || !svg.includes("<svg")) return svg;
  const graph = parseGraph(parseDiagram(source).body);
  const shape = hubAndSpokes(graph.nodes, graph.edges);
  if (!shape) return svg;
  const placed = placeHubSpokes(shape.spokes.length, mode);
  const byId = new Map<string, Point>([[shape.hub, placed.hub]]);
  shape.spokes.forEach((id, index) => {
    const point = placed.spokes[index];
    if (point) byId.set(id, point);
  });
  let next = svg;
  for (const [id, point] of byId) next = replaceNodeTranslate(next, id, point);
  for (const spoke of shape.spokes) {
    const from = byId.get(shape.hub);
    const to = byId.get(spoke);
    if (!from || !to) continue;
    next = replaceEdge(next, shape.hub, spoke, `M${Math.round(from.x)},${Math.round(from.y)} L${Math.round(to.x)},${Math.round(to.y)}`);
  }
  return setViewBox(next, [...byId.values()]);
}
