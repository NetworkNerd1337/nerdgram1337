/** Show the render overlay only after the wait is long enough to notice. */
export const RENDER_PROGRESS_AFTER_MS = 1000;

export const RENDER_CANCELLED_MESSAGE =
  "Render cancelled. The diagram source is still in the editor.";

export function shouldShowRenderOverlay(elapsedMs: number): boolean {
  return elapsedMs >= RENDER_PROGRESS_AFTER_MS;
}

/** `Rendering 1,001 nodes… 3s` */
export function renderOverlayText(nodeCount: number, elapsedMs: number): string {
  const count = Math.max(0, Math.round(nodeCount)).toLocaleString("en-US");
  const seconds = Math.max(1, Math.floor(elapsedMs / 1000));
  return `Rendering ${count} nodes… ${seconds}s`;
}

/** Unique flowchart node ids declared or named on an edge. */
export function countDiagramNodes(source: string): number {
  const ids = new Set<string>();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || line.startsWith("classDef") || line.startsWith("class ") || line.startsWith("click ")) {
      continue;
    }
    const declared = line.match(/^([A-Za-z_][\w-]*)\s*(?:\[|\(|\{|@)/);
    if (declared?.[1]) ids.add(declared[1]);
    const linked = line.match(
      /^([A-Za-z_][\w-]*)\s+(?:-->|---|-\.->|==>|--o|--x)\s*(?:\|"[^"]*"\|\s*)?([A-Za-z_][\w-]*)/,
    );
    if (linked?.[1] && linked[2]) {
      ids.add(linked[1]);
      ids.add(linked[2]);
    }
  }
  return ids.size;
}
