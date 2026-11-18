/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { padEdgeLabelBoxes } from "../../server/src/edgeLabelPadding.ts";
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
    expect(span?.getAttribute("style")).toContain("padding:0 6px");
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
    expect(previewDoc.querySelector("g.edgeLabel .edgeLabel")?.getAttribute("style") ?? "").toContain("padding:0 6px");
    const rect = exportDoc.querySelector("g.edgeLabel rect");
    const width = Number.parseFloat(rect?.getAttribute("width") ?? "0");
    const textWidth = Math.max(8, (exportLabel?.textContent ?? "").trim().length * 7);
    expect(width).toBeGreaterThanOrEqual(textWidth + 12 - 1);
  }, 30_000);
});

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
