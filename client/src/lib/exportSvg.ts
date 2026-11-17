/**
 * Export helpers that do not need a live diagram. PDF and SVG exports prefer
 * real SVG text (`htmlLabels: false`) so a drawing program can show the
 * labels. PNG and JPG use the editor SVG and paint the theme background.
 */

const HTML_LABEL_KEYS = [
  "flowchart",
  "sequence",
  "class",
  "state",
  "er",
  "journey",
  "requirement",
  "gitGraph",
  "mindmap",
  "timeline",
  "quadrantChart",
  "c4",
  "block",
  "architecture",
  "kanban",
];

export function withSvgTextLabels(config: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  for (const key of HTML_LABEL_KEYS) {
    const current = next[key];
    const block =
      current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
    block.htmlLabels = false;
    next[key] = block;
  }
  return next;
}

/**
 * Fill color for an export. A transparent PNG is the only format that stays
 * transparent, and only when that choice is explicit. Every other export uses
 * the diagram background, then the theme background.
 */
export function exportBackgroundColor(options: {
  transparent?: boolean;
  fromSvg?: string | null;
  fromTheme?: string | null;
}): string | null {
  if (options.transparent) return null;
  const fromSvg = options.fromSvg?.trim();
  if (fromSvg) return fromSvg;
  const fromTheme = options.fromTheme?.trim();
  if (fromTheme) return fromTheme;
  return "#ffffff";
}

export function svgHasForeignObject(svg: string): boolean {
  return /<foreignObject\b/i.test(svg);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Insert a background rect as the first shape so the file is not transparent outside a browser. */
export function insertBackgroundRect(svg: string, color: string): string {
  const open = /^<svg\b[^>]*>/i.exec(svg);
  if (!open) return svg;
  const safe = escapeAttr(color);
  let tag = open[0];
  if (/style\s*=\s*"/i.test(tag)) {
    tag = tag.replace(/style\s*=\s*"/i, `style="background-color:${safe};`);
  } else {
    tag = tag.replace(/>$/, ` style="background-color:${safe}">`);
  }
  const rect = `<rect x="0" y="0" width="100%" height="100%" fill="${safe}" class="nerdgram-export-background"/>`;
  return tag + rect + svg.slice(open[0].length);
}
