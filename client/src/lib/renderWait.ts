/** A diagram at least this large paints the overlay before Mermaid draws. */
export const SLOW_RENDER_NODES = 200;

export const RENDER_CANCELLED_MESSAGE =
  "Render cancelled. The diagram source is still in the editor.";

/** `Rendering 1,001 nodes…` The clock does not tick while Mermaid blocks the page. */
export function renderOverlayText(nodeCount: number): string {
  const count = Math.max(0, Math.round(nodeCount)).toLocaleString("en-US");
  return `Rendering ${count} nodes…`;
}

export function slowRenderLabel(nodeCount: number): string | null {
  if (nodeCount < SLOW_RENDER_NODES) return null;
  return renderOverlayText(nodeCount);
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

/** Two frames, then a macrotask, so a React overlay paints before a blocking draw. */
export function yieldForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  });
}

/** A click queued during a blocked draw runs before the caller keeps the picture. */
export function yieldToInput(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Large diagrams show the overlay and yield so it paints. After the draw, a
 * queued Cancel is honored and the picture is dropped. Small diagrams draw
 * with no overlay and no extra wait.
 */
export async function renderGuarded<T>(options: {
  nodeCount: number;
  showOverlay: (text: string) => void;
  hideOverlay: () => void;
  cancelled: () => boolean;
  run: () => Promise<T>;
}): Promise<{ ok: true; value: T } | { ok: false }> {
  const label = slowRenderLabel(options.nodeCount);
  if (label) {
    options.showOverlay(label);
    await yieldForPaint();
    if (options.cancelled()) {
      options.hideOverlay();
      return { ok: false };
    }
  }
  try {
    const value = await options.run();
    if (label) await yieldToInput();
    if (options.cancelled()) return { ok: false };
    return { ok: true, value };
  } finally {
    options.hideOverlay();
  }
}
