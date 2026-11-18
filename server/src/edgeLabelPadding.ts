/**
 * Side padding for flowchart edge labels, plus the XML repair the padding
 * round-trip needs.
 *
 * HTML labels are an inline span around a block `<p>`. Padding that span
 * adds a line box, so a multi-line label loses its last line. Pad the `<p>`
 * (or the label background when there is no paragraph) and widen the
 * foreignObject instead.
 *
 * Strict Mermaid emits `<br>`, and a `click` line emits `xlink:href` without
 * a namespace. Both make an XML parse fail. Repair those before parsing, and
 * again after serializing, so the SVG stays well-formed.
 *
 * `padEdgeLabelBoxes` stays a sibling of `padEdgeLabelSvg` so the headless
 * page can install both from `Function#toString`.
 */

type XmlEl = {
  localName?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): XmlEl | null;
  querySelectorAll(selector: string): Iterable<XmlEl>;
  getElementsByTagName?: (name: string) => Iterable<XmlEl>;
  getBBox?: () => { width: number };
};

export function repairSvgMarkup(svg: string): string {
  let next = svg;
  if (next.includes("xlink:") && !/xmlns:xlink\s*=/.test(next)) {
    next = next.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return next.replace(/<br\b([^>]*?)>/gi, (_full, attrs: string) => {
    const body = attrs.replace(/\s*\/\s*$/, "");
    return `<br${body}/>`;
  });
}

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
      const tagged = foreign.getElementsByTagName?.("p");
      const paragraphs = tagged
        ? [...tagged]
        : [...foreign.querySelectorAll("*")].filter((el) => (el.localName ?? "").toLowerCase() === "p");
      if (paragraphs.length > 0) {
        for (const paragraph of paragraphs) appendStyle(paragraph, `padding:0 ${pad}px`);
      } else {
        const background = foreign.querySelector(".labelBkg") ?? foreign.querySelector("div");
        if (background) appendStyle(background, `padding:0 ${pad}px`);
      }
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

type PadDoc = {
  documentElement: unknown;
  querySelector(selector: string): { textContent: string | null } | null;
  querySelectorAll(selector: string): Iterable<XmlEl>;
};

export function padEdgeLabelSvg(svg: string): string {
  if (!svg.includes("edgeLabel")) return repairSvgMarkup(svg);
  const prepared = repairSvgMarkup(svg);
  const g = globalThis as unknown as {
    DOMParser?: new () => { parseFromString(xml: string, type: string): PadDoc };
    XMLSerializer?: new () => { serializeToString(node: unknown): string };
  };
  if (!g.DOMParser || !g.XMLSerializer) return prepared;
  const doc = new g.DOMParser().parseFromString(prepared, "image/svg+xml");
  if (doc.querySelector("parsererror")) return prepared;
  padEdgeLabelBoxes(doc);
  return repairSvgMarkup(new g.XMLSerializer().serializeToString(doc.documentElement));
}

/** Why an SVG string is not well-formed, or null when it parses as an svg root. */
export function svgXmlError(svg: string): string | null {
  const text = svg.trim();
  if (!text.includes("<svg") || text.includes("<parsererror")) {
    return "Rendered SVG is not well-formed XML.";
  }
  if (/<br\b(?![^>]*\/>)[^>]*>/i.test(text)) {
    return "Rendered SVG is not well-formed XML. Opening and ending tag mismatch: br and p.";
  }
  const g = globalThis as unknown as {
    DOMParser?: new () => { parseFromString(xml: string, type: string): PadDoc & { documentElement: { localName?: string } } };
  };
  if (!g.DOMParser) return null;
  const doc = new g.DOMParser().parseFromString(text, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    const message = (err.textContent ?? "").replace(/\s+/g, " ").trim();
    return message.slice(0, 300) || "Rendered SVG is not well-formed XML.";
  }
  if (doc.documentElement?.localName && doc.documentElement.localName !== "svg") {
    return "Rendered SVG is not well-formed XML.";
  }
  return null;
}
