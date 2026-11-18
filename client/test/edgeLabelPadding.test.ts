/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { padEdgeLabelBoxes, padEdgeLabelSvg, svgXmlError } from "../../server/src/edgeLabelPadding.ts";
import { renderForExport, renderMermaid } from "../src/lib/mermaidRender";

function pad(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  padEdgeLabelBoxes(doc);
  return doc;
}

describe("edge label padding", () => {
  it("adds side padding to an HTML edge label without changing the words", () => {
    const doc = pad(`<svg xmlns="http://www.w3.org/2000/svg">
      <g class="edgeLabel" transform="translate(200, 40)">
        <g class="label" transform="translate(-70, -9)">
          <foreignObject width="140" height="18">
            <div xmlns="http://www.w3.org/1999/xhtml">
              <span class="edgeLabel"><p>Gi0/1/0 – Gi1/0/51</p></span>
            </div>
          </foreignObject>
        </g>
      </g>
    </svg>`);
    const foreign = doc.querySelector("foreignObject");
    const span = doc.querySelector("span.edgeLabel");
    const label = doc.querySelector("g.label");
    expect(foreign?.getAttribute("width")).toBe("152");
    expect(foreign?.getAttribute("height")).toBe("18");
    expect(span?.getAttribute("style") ?? "").not.toContain("padding");
    expect(doc.querySelector("p")?.getAttribute("style")).toContain("padding:0 6px");
    expect(span?.textContent).toBe("Gi0/1/0 – Gi1/0/51");
    expect(label?.getAttribute("transform")).toBe("translate(-76, -9)");
    expect(doc.querySelector("g.edgeLabel")?.getAttribute("transform")).toBe("translate(200, 40)");
    padEdgeLabelBoxes(doc);
    expect(foreign?.getAttribute("width")).toBe("152");
  });

  it("widens an SVG text label box up to the same inset and keeps the text", () => {
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">
      <g class="edgeLabel">
        <g class="label" transform="translate(-40, -8)">
          <g>
            <rect class="background" x="-2" y="-2" width="84" height="20"/>
            <text>Gi0/1/0 – Gi1/0/51</text>
          </g>
        </g>
      </g>
    </svg>`,
      "image/svg+xml",
    );
    const text = doc.querySelector("text");
    Object.assign(text as unknown as { getBBox: () => { width: number } }, {
      getBBox: () => ({ width: 80 }),
    });
    padEdgeLabelBoxes(doc);
    const rect = doc.querySelector("rect");
    expect(rect?.getAttribute("x")).toBe("-6");
    expect(rect?.getAttribute("width")).toBe("92");
    expect(text?.textContent).toBe("Gi0/1/0 – Gi1/0/51");
    expect(doc.querySelector("g.label")?.getAttribute("transform")).toBe("translate(-40, -8)");
  });

  it("pads a rendered preview and an SVG export without changing the label", async () => {
    installTextBox();
    const source = "flowchart LR\n  Core[Core] -->|Gi0/1/0 – Gi1/0/51| Dist[Dist]\n";
    const preview = await renderMermaid(source, "dark");
    const exported = await renderForExport(source, "neutral");
    const previewDoc = new DOMParser().parseFromString(preview.svg, "image/svg+xml");
    const exportDoc = new DOMParser().parseFromString(exported, "image/svg+xml");
    const previewLabel = previewDoc.querySelector("g.edgeLabel");
    const exportLabel = exportDoc.querySelector("g.edgeLabel");
    expect(previewLabel?.textContent).toContain("Gi0/1/0");
    expect(previewLabel?.textContent).toContain("Gi1/0/51");
    expect(exportLabel?.textContent).toContain("Gi0/1/0");
    expect(exportLabel?.textContent).toContain("Gi1/0/51");
    expect(previewLabel?.getAttribute("data-nerdgram-pad")).toBe("1");
    expect(exportLabel?.getAttribute("data-nerdgram-pad")).toBe("1");
    const previewSpan = previewDoc.querySelector("g.edgeLabel span.edgeLabel");
    expect(previewSpan?.getAttribute("style") ?? "").not.toContain("padding");
    const padded = [...previewDoc.querySelectorAll("g.edgeLabel [style]")].find((el) =>
      (el.getAttribute("style") ?? "").includes("padding:0 6px"),
    );
    expect(padded?.localName === "p" || padded?.classList.contains("labelBkg")).toBe(true);
    const rect = exportDoc.querySelector("g.edgeLabel rect");
    const width = Number.parseFloat(rect?.getAttribute("width") ?? "0");
    const textWidth = Math.max(8, (exportLabel?.textContent ?? "").trim().length * 7);
    expect(width).toBeGreaterThanOrEqual(textWidth + 12 - 1);
  }, 30_000);

  it("keeps every line of a multi-line edge label and does not pad the inline span", () => {
    const lines = ["access 20 servers", "10,20", "10,20,30 native 99 native"];
    const raw = `<svg xmlns="http://www.w3.org/2000/svg">
      <g class="edgeLabel" transform="translate(120, 40)">
        <g class="label" transform="translate(-70, -36)">
          <foreignObject width="140" height="72">
            <div xmlns="http://www.w3.org/1999/xhtml" class="labelBkg">
              <span class="edgeLabel"><p>${lines.join("<br>")}</p></span>
            </div>
          </foreignObject>
        </g>
      </g>
    </svg>`;
    const padded = padEdgeLabelSvg(raw);
    expect(svgXmlError(padded)).toBeNull();
    const doc = new DOMParser().parseFromString(padded, "image/svg+xml");
    const label = doc.querySelector("g.edgeLabel");
    const foreign = label?.querySelector("foreignObject");
    const paragraph = label?.querySelector("p");
    const span = label?.querySelector("span.edgeLabel");
    hostWith(doc);
    for (const line of lines) expect(label?.textContent).toContain(line);
    expect(span?.getAttribute("style") ?? "").not.toContain("padding");
    expect(paragraph?.getAttribute("style") ?? "").toContain("padding:0 6px");
    expect(foreign?.getAttribute("height")).toBe("72");
    expect(Number.parseFloat(foreign?.getAttribute("width") ?? "0")).toBe(152);
    const boxHeight = Number.parseFloat(foreign?.getAttribute("height") ?? "0");
    const textHeight = paragraph?.getBoundingClientRect().height ?? 0;
    expect(boxHeight).toBeGreaterThan(0);
    if (textHeight > 0) expect(boxHeight + 0.5).toBeGreaterThanOrEqual(textHeight);
  });

  it("pads a click diagram and emits well-formed breaks", () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">
      <g class="edgeLabel" transform="translate(100, 40)">
        <g class="label" transform="translate(-40, -24)">
          <foreignObject width="80" height="48">
            <div xmlns="http://www.w3.org/1999/xhtml">
              <span class="edgeLabel"><p>line one<br>line two<br>line three</p></span>
            </div>
          </foreignObject>
        </g>
      </g>
      <a xlink:href="https://example.com"><text>Core</text></a>
    </svg>`;
    expect(svgXmlError(raw)).toMatch(/br/);
    const padded = padEdgeLabelSvg(raw);
    expect(svgXmlError(padded)).toBeNull();
    expect(padded).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(padded).toContain('xlink:href="https://example.com"');
    expect(padded).not.toMatch(/<br(?![^>]*\/>)/);
    const doc = new DOMParser().parseFromString(padded, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("g.edgeLabel")?.getAttribute("data-nerdgram-pad")).toBe("1");
    const text = doc.querySelector("g.edgeLabel")?.textContent ?? "";
    expect(text).toContain("line one");
    expect(text).toContain("line two");
    expect(text).toContain("line three");
    expect(doc.querySelector("span.edgeLabel")?.getAttribute("style") ?? "").not.toContain("padding");
    expect(doc.querySelector("p")?.getAttribute("style")).toContain("padding:0 6px");
    const foreign = doc.querySelector("foreignObject");
    expect(foreign?.getAttribute("width")).toBe("92");
    expect(foreign?.getAttribute("height")).toBe("48");
  });

  it("keeps inner padding on a long IPv6 node label in the preview and the export", async () => {
    installTextBox();
    const source = "flowchart LR\n  core[\"Lo0 2001:db8::1/128\"] -->|Gi0/1| guest[Short]\n";
    for (const theme of ["dark", "default"]) {
      const preview = await renderMermaid(source, theme);
      const exported = await renderForExport(source, theme);
      for (const svg of [preview.svg, exported]) {
        expect(svgXmlError(svg)).toBeNull();
        expect(svg).toContain("Lo0 2001:db8::1/128");
        expect(svg).toContain("Gi0/1");
        expect(svg).toContain("data-nerdgram-pad");
        expect(svg).not.toMatch(/<span[^>]*edgeLabel[^>]*padding/);
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        const node = [...doc.querySelectorAll("g.node")].find((item) => (item.textContent ?? "").includes("2001:db8::1/128"));
        const rect = node?.querySelector("rect");
        const foreign = node?.querySelector("foreignObject");
        const width = Number.parseFloat(rect?.getAttribute("width") ?? "0");
        if (foreign) {
          const label = Number.parseFloat(foreign.getAttribute("width") ?? "0");
          expect(label).toBeGreaterThan(120);
          expect(width - label).toBeGreaterThanOrEqual(24);
        } else {
          expect(width).toBeGreaterThan(140);
        }
      }
    }
  });
});

function hostWith(doc: Document): void {
  const svg = doc.documentElement;
  if (svg.parentNode !== document.body) document.body.appendChild(svg);
}

function installTextBox(): void {
  const box = function (this: Element) {
    const text = this.textContent ?? "";
    return new DOMRect(0, 0, Math.max(8, text.trim().length * 7), text.trim() ? 18 : 8);
  };
  for (const ctor of [globalThis.SVGElement, globalThis.SVGGraphicsElement, globalThis.Element]) {
    if (!ctor) continue;
    ctor.prototype.getBBox = box;
    ctor.prototype.getBoundingClientRect = box;
  }
}
