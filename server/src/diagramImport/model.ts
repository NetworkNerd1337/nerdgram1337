import { generateBody, sanitizeId, type GraphModel } from "../diagramData.js";

export type DraftNode = { key: string; label: string; group: string };
export type DraftEdge = { source: string; target: string; label: string };

export type DraftPage = {
  id: string;
  title: string;
  nodes: DraftNode[];
  edges: DraftEdge[];
  warnings: string[];
};

export type ForeignKind = "lucid" | "visio";

export type ForeignPage = {
  id: string;
  title: string;
  mermaid: string;
  warnings: string[];
  nodes: number;
  edges: number;
};

export type ForeignImport =
  | { ok: true; kind: ForeignKind; label: string; pages: ForeignPage[] }
  | { ok: false; message: string };

export const VISIO_BINARY_MESSAGE =
  "Save this file as .vsdx in Visio. Older .vsd and .vss files are not imported.";

/** Mermaid flowchart from the shared node and edge model. Positions and styling are not kept. */
export function pageToMermaid(page: DraftPage): { mermaid: string; nodes: number; edges: number } {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  const claim = (key: string, fallback: string): string => {
    const existing = ids.get(key);
    if (existing) return existing;
    const cleaned = sanitizeId(key);
    const base = cleaned && /^[A-Za-z_]/.test(cleaned) ? cleaned : `n_${cleaned || fallback}`;
    let id = base;
    let salt = 2;
    while (used.has(id.toLowerCase())) {
      id = `${base}_${salt}`;
      salt += 1;
    }
    used.add(id.toLowerCase());
    ids.set(key, id);
    return id;
  };

  const nodes = page.nodes.map((node, index) => ({
    id: claim(node.key, `node_${index + 1}`),
    label: node.label.trim() || node.key,
    group: node.group,
    className: "",
    diagram: "",
  }));
  const edges = page.edges.flatMap((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return [];
    return [{ source: ids.get(edge.source) ?? "", target: ids.get(edge.target) ?? "", label: edge.label }];
  });
  const model: GraphModel = { nodes, edges };
  const mermaid = generateBody(model, { direction: "LR", grouping: true });
  return { mermaid, nodes: nodes.length, edges: edges.length };
}

export function finishPages(kind: ForeignKind, label: string, pages: DraftPage[]): ForeignImport {
  const usable = pages.filter((page) => page.nodes.length > 0 || page.edges.length > 0);
  if (usable.length === 0) {
    const detail = pages.flatMap((page) => page.warnings).find(Boolean);
    return { ok: false, message: detail || `No pages were found in that ${label} file.` };
  }
  return {
    ok: true,
    kind,
    label,
    pages: usable.map((page) => {
      const drawn = pageToMermaid(page);
      return {
        id: page.id,
        title: page.title,
        mermaid: drawn.mermaid,
        warnings: page.warnings,
        nodes: drawn.nodes,
        edges: drawn.edges,
      };
    }),
  };
}
