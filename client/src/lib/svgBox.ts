import type { Size } from "./viewTransform";

/** Intrinsic SVG size, preferring the viewBox over a laid-out box. */
export function readSvgSize(svg: SVGSVGElement): Size | null {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height };
  const widthAttr = svg.getAttribute("width") ?? "";
  const heightAttr = svg.getAttribute("height") ?? "";
  const width = Number.parseFloat(widthAttr);
  const height = Number.parseFloat(heightAttr);
  if (width > 0 && height > 0 && !widthAttr.includes("%") && !heightAttr.includes("%")) {
    return { width, height };
  }
  try {
    const bounds = svg.getBBox();
    if (bounds.width > 0 && bounds.height > 0) return { width: bounds.width, height: bounds.height };
  } catch {
    return null;
  }
  return null;
}
