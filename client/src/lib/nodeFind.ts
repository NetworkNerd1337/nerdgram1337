import { metaTextForNode, type NodeMeta } from "./nodeMeta";
import { centerViewOn, type Point, type Size } from "./viewTransform";

export { centerViewOn };

export type NodeMatch = {
  id: string;
  label: string;
};

const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

export function flowchartNodes(source: string): NodeMatch[] {
  const labels = new Map<string, string>();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const quoted = line.match(/^([A-Za-z_][\w-]*)\s*\[\s*"([^"]*)"\s*\]/);
    const plain = line.match(/^([A-Za-z_][\w-]*)\s*\[\s*([^\]"]+)\s*\]/);
    const hit = quoted ?? plain;
    if (hit?.[1]) labels.set(hit[1], (hit[2] ?? hit[1]).trim());
    const linked = line.match(
      /^([A-Za-z_][\w-]*)\s+(?:-->|---|-\.->|==>|--o|--x)\s*(?:\|"[^"]*"\|\s*)?([A-Za-z_][\w-]*)/,
    );
    if (linked?.[1] && !labels.has(linked[1])) labels.set(linked[1], linked[1]);
    if (linked?.[2] && !labels.has(linked[2])) labels.set(linked[2], linked[2]);
  }
  return [...labels.entries()].map(([id, label]) => ({ id, label }));
}

export function matchNodes(nodes: readonly NodeMatch[], query: string, meta: readonly NodeMeta[] = []): NodeMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return nodes.filter((node) => {
    const extra = metaTextForNode(node.label, node.id, meta);
    const haystack = `${node.id} ${node.label} ${extra}`.toLowerCase();
    if (haystack.includes(needle)) return true;
    const ips = haystack.match(IP) ?? [];
    return ips.some((ip) => ip.includes(needle));
  });
}

/** Keys while the node search box is open. Closed, Present keeps Escape for leaving. */
export function nodeFindKey(
  event: { key: string; shiftKey?: boolean },
  open: boolean,
): "close" | "next" | "prev" | "ignore" {
  if (!open) return "ignore";
  if (event.key === "Escape") return "close";
  if (event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)) return "next";
  if (event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)) return "prev";
  return "ignore";
}

export function stepMatch(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}

/** Diagram-center point of a node whose SVG transform is a top-left-relative center. */
export function nodePointInDiagram(translate: Point, content: Size): Point {
  return { x: translate.x - content.width / 2, y: translate.y - content.height / 2 };
}

export function nodeFindShortcut(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  codeEditor: boolean,
): "open" | "ignore" {
  if (codeEditor) return "ignore";
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") return "open";
  return "ignore";
}
