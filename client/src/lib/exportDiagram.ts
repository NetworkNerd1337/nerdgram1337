import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { renderForExport } from "./mermaidRender";
import { yieldToInput } from "./renderWait";
import { rasterExportScale, rasterScaleNote } from "./rasterScale";
import { backgroundFromSvg, themeBackground } from "./svgBackground";
import { exportBackgroundColor, svgHasForeignObject } from "./exportSvg";
import { stripDangerousSvgElement } from "./svgClickUrls";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cloneSvg(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  stripDangerousSvgElement(clone);
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  return clone;
}

function svgToString(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(cloneSvg(svg));
}

function measureSvg(svg: SVGSVGElement): { width: number; height: number } {
  const bbox = svg.getBoundingClientRect();
  const width = Math.max(
    1,
    Math.ceil(
      Number(svg.viewBox.baseVal?.width) || bbox.width || svg.clientWidth || 800,
    ),
  );
  const height = Math.max(
    1,
    Math.ceil(
      Number(svg.viewBox.baseVal?.height) ||
        bbox.height ||
        svg.clientHeight ||
        600,
    ),
  );
  return { width, height };
}

function paintBackground(svg: SVGSVGElement, color: string | null): SVGSVGElement {
  const clone = cloneSvg(svg);
  if (!color) return clone;
  const { width, height } = measureSvg(clone);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.setAttribute("fill", color);
  rect.setAttribute("class", "nerdgram-export-background");
  clone.insertBefore(rect, clone.firstChild);
  clone.style.backgroundColor = color;
  return clone;
}

async function svgToCanvas(
  svg: SVGSVGElement,
  background: string | null,
): Promise<{ canvas: HTMLCanvasElement; note: string | null; scale: number }> {
  const { width, height } = measureSvg(svg);
  const scale = rasterExportScale(width, height);

  const clone = cloneSvg(svg);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const svgText = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to rasterize SVG"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.scale(scale, scale);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, note: rasterScaleNote(scale), scale };
}

/** Margin around the diagram in PDF points (1pt ≈ 1 CSS px at 72dpi). */
const PDF_MARGIN_PT = 24;

async function svgToPdfBlob(svg: SVGSVGElement): Promise<Blob> {
  const { width, height } = measureSvg(svg);
  const clone = cloneSvg(svg);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;";
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    const pageWidth = width + PDF_MARGIN_PT * 2;
    const pageHeight = height + PDF_MARGIN_PT * 2;
    const orientation = pageWidth >= pageHeight ? "landscape" : "portrait";
    const pdf = new jsPDF({
      orientation,
      unit: "pt",
      format: [pageWidth, pageHeight],
      compress: true,
    });

    await svg2pdf(clone, pdf, {
      x: PDF_MARGIN_PT,
      y: PDF_MARGIN_PT,
      width,
      height,
    });

    return pdf.output("blob");
  } finally {
    host.remove();
  }
}

async function canvasToPdfBlob(canvas: HTMLCanvasElement, scale: number): Promise<Blob> {
  const width = Math.max(1, canvas.width / scale);
  const height = Math.max(1, canvas.height / scale);
  const pageWidth = width + PDF_MARGIN_PT * 2;
  const pageHeight = height + PDF_MARGIN_PT * 2;
  const pdf = new jsPDF({
    orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
    unit: "pt",
    format: [pageWidth, pageHeight],
    compress: true,
  });
  const image = canvas.toDataURL("image/png");
  pdf.addImage(image, "PNG", PDF_MARGIN_PT, PDF_MARGIN_PT, width, height);
  return pdf.output("blob");
}

function elementFromSvg(text: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  return root instanceof SVGSVGElement ? root : null;
}

export type ExportFormat = "svg" | "png" | "jpg" | "pdf";

export type ExportOptions = {
  /** Diagram source. Used to re-render SVG and PDF with SVG text labels. */
  source?: string;
  fallbackTheme?: string;
  theme?: string | null;
  themeVariables?: Record<string, unknown> | null;
  /** PNG only. Every other format paints the theme background. */
  transparent?: boolean;
  /** When this returns true, the file is not downloaded. */
  isCancelled?: () => boolean;
};

export type DiagramExportResult = {
  /** Set when PNG, JPG, or a canvas PDF was drawn below 2×. */
  note: string | null;
};

export async function exportDiagram(
  svg: SVGSVGElement,
  baseName: string,
  format: ExportFormat,
  options: ExportOptions = {},
): Promise<DiagramExportResult> {
  const safe = (baseName || "diagram").replace(/[^\w.-]+/g, "_");
  const liveText = svgToString(svg);
  const fill = exportBackgroundColor({
    transparent: format === "png" && options.transparent === true,
    fromSvg: backgroundFromSvg(liveText),
    fromTheme: themeBackground(options.theme, options.themeVariables),
  });

  let vector: SVGSVGElement | null = null;
  if ((format === "svg" || format === "pdf") && options.source?.trim()) {
    try {
      const rendered = await renderForExport(options.source, options.fallbackTheme);
      if (!svgHasForeignObject(rendered)) vector = elementFromSvg(rendered);
    } catch {
      vector = null;
    }
  }

  await yieldToInput();
  if (options.isCancelled?.()) return { note: null };

  if (format === "svg") {
    const painted = paintBackground(vector ?? svg, fill);
    triggerDownload(
      new Blob([svgToString(painted)], { type: "image/svg+xml;charset=utf-8" }),
      `${safe}.svg`,
    );
    return { note: null };
  }

  if (format === "pdf") {
    const painted = paintBackground(vector ?? svg, fill);
    if (vector) {
      try {
        const blob = await svgToPdfBlob(painted);
        await yieldToInput();
        if (options.isCancelled?.()) return { note: null };
        triggerDownload(blob, `${safe}.pdf`);
        return { note: null };
      } catch {
        // The vector PDF could not be built. Fall through to the scaled canvas.
      }
    }
    const drawn = await svgToCanvas(paintBackground(svg, fill), fill);
    await yieldToInput();
    if (options.isCancelled?.()) return { note: null };
    triggerDownload(await canvasToPdfBlob(drawn.canvas, drawn.scale), `${safe}.pdf`);
    return { note: drawn.note };
  }

  const drawn = await svgToCanvas(paintBackground(svg, fill), fill);
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob>((resolve, reject) => {
    drawn.canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
      mime,
      0.92,
    );
  });
  await yieldToInput();
  if (options.isCancelled?.()) return { note: null };
  triggerDownload(blob, `${safe}.${format === "jpg" ? "jpg" : "png"}`);
  return { note: drawn.note };
}
