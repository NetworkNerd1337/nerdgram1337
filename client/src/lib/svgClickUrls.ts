/**
 * Click targets Mermaid writes as `href` or `xlink:href`.
 * `javascript:`, `vbscript:`, and a `data:` URL that is not a png, jpeg, gif,
 * or webp image are removed. http(s), `nerdgram:`, and a relative `.mmd` path stay.
 */

const XLINK = "http://www.w3.org/1999/xlink";
const RASTER_DATA = /^data:image\/(png|jpe?g|gif|webp)[;,]/;

function decodeUrl(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, num: string) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/[\u0000-\u0020]+/g, "")
    .trim()
    .toLowerCase();
}

export function isDangerousClickUrl(value: string): boolean {
  const decoded = decodeUrl(value);
  if (decoded.startsWith("javascript:") || decoded.startsWith("vbscript:")) return true;
  if (decoded.startsWith("data:")) return !RASTER_DATA.test(decoded);
  return false;
}

function dropAttribute(element: Element, name: string): boolean {
  const value = element.getAttribute(name);
  if (value == null || !isDangerousClickUrl(value)) return false;
  element.removeAttribute(name);
  return true;
}

/** Remove dangerous click URLs from a live SVG. Returns whether anything changed. */
export function stripDangerousSvgElement(root: Element): boolean {
  let changed = false;
  const elements = [root, ...root.querySelectorAll("*")];
  for (const element of elements) {
    if (dropAttribute(element, "href")) changed = true;
    if (dropAttribute(element, "xlink:href")) changed = true;
    const namespaced = element.getAttributeNS(XLINK, "href");
    if (namespaced != null && isDangerousClickUrl(namespaced)) {
      element.removeAttributeNS(XLINK, "href");
      changed = true;
    }
  }
  return changed;
}

/** Same pass for an SVG string. A clean document is returned unchanged. */
export function stripDangerousSvgUrls(svg: string): string {
  if (!svg || typeof DOMParser === "undefined") return svg;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() === "parsererror" || root.querySelector("parsererror")) return svg;
  if (!stripDangerousSvgElement(root)) return svg;
  return new XMLSerializer().serializeToString(root);
}
