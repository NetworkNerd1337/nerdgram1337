/**
 * A few pixels of side padding on flowchart edge-label boxes.
 * HTML labels (the editor preview) have none. SVG text labels (SVG export)
 * already have a couple of pixels; this brings both to the same inset.
 * The label text and the Mermaid source are left alone.
 *
 * Helpers stay inside the function so `Function#toString` can run it in the
 * headless page that draws API SVG and PNG.
 */

type XmlEl = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): XmlEl | null;
  querySelectorAll(selector: string): Iterable<XmlEl>;
  getBBox?: () => { width: number };
};

export function padEdgeLabelBoxes(root: { querySelectorAll(selector: string): Iterable<XmlEl> }): void {
  const pad = 6;
  const mark = "data-nerdgram-pad";

  const readPx = (value: string | null): number => {
    if (!value) return 0;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
  const trimNum = (value: number): string => String(Math.round(value * 100) / 100);
  const writePx = (current: string | null, next: number): string => {
    const unit = current?.trim().toLowerCase().endsWith("px") ? "px" : "";
    return `${trimNum(next)}${unit}`;
  };
  const shiftTranslateX = (el: XmlEl, dx: number): void => {
    const raw = el.getAttribute("transform") ?? "";
    const match = /translate\(\s*(-?[\d.]+)(?:[,\s]+(-?[\d.]+))?\s*\)/.exec(raw);
    if (!match || match[1] == null) return;
    const x = Number(match[1]) + dx;
    const y = match[2] ?? "0";
    el.setAttribute("transform", raw.replace(match[0], `translate(${trimNum(x)}, ${y})`));
  };
  const appendStyle = (el: XmlEl, addition: string): void => {
    const style = el.getAttribute("style") ?? "";
    if (/padding\s*:/.test(style)) return;
    el.setAttribute("style", style.trim() ? `${style.replace(/;\s*$/, "")};${addition}` : addition);
  };

  for (const group of root.querySelectorAll("g.edgeLabel")) {
    if (group.getAttribute(mark) === "1") continue;
    const foreign = group.querySelector("foreignObject");
    if (foreign) {
      const widthAttr = foreign.getAttribute("width");
      const width = readPx(widthAttr);
      if (!(width > 0)) continue;
      foreign.setAttribute("width", writePx(widthAttr, width + pad * 2));
      shiftTranslateX(group.querySelector("g.label") ?? group, -pad);
      const span = foreign.querySelector(".edgeLabel") ?? foreign.querySelector("span");
      if (span) appendStyle(span, `padding:0 ${pad}px`);
      group.setAttribute(mark, "1");
      continue;
    }
    const rect = group.querySelector("rect");
    if (!rect) continue;
    const widthAttr = rect.getAttribute("width");
    const width = readPx(widthAttr);
    if (!(width > 0)) continue;
    const xAttr = rect.getAttribute("x");
    const x = readPx(xAttr);
    const text = group.querySelector("text");
    const box = text && typeof text.getBBox === "function" ? text.getBBox() : null;
    let extra = pad;
    if (box && box.width > 1) {
      extra = pad - (width - box.width) / 2;
      if (extra <= 0.5) {
        group.setAttribute(mark, "1");
        continue;
      }
    }
    rect.setAttribute("x", writePx(xAttr, x - extra));
    rect.setAttribute("width", writePx(widthAttr, width + extra * 2));
    group.setAttribute(mark, "1");
  }
}
