/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { stripDangerousSvgUrls } from "../src/lib/svgClickUrls";

const CRAFTED = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <a id="svgxml" href="data:image/svg+xml;base64,PHN2Zy8+"><text>svg</text></a>
  <a id="png" href="data:image/png;base64,iVBORw0KGgo="><text>png</text></a>
  <a id="web" href="https://example.com/diagram"><text>web</text></a>
  <a id="local" xlink:href="nerdgram:Sites/Atlanta.mmd"><text>local</text></a>
  <a id="relative" href="../Other.mmd"><text>relative</text></a>
  <a id="js" href="javascript:alert(1)"><text>js</text></a>
  <a id="vb" xlink:href="vbscript:msgbox(1)"><text>vb</text></a>
</svg>`;

describe("client svg click urls", () => {
  it("drops a scriptable data url and keeps a raster data url and a normal link", () => {
    const cleaned = stripDangerousSvgUrls(CRAFTED);
    expect(cleaned).not.toContain("data:image/svg+xml");
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).not.toContain("vbscript:");
    expect(cleaned).toContain('href="data:image/png;base64,iVBORw0KGgo="');
    expect(cleaned).toContain('href="https://example.com/diagram"');
    expect(cleaned).toContain("nerdgram:Sites/Atlanta.mmd");
    expect(cleaned).toContain('href="../Other.mmd"');

    const doc = new DOMParser().parseFromString(cleaned, "image/svg+xml");
    expect(doc.getElementById("svgxml")?.getAttribute("href")).toBeNull();
    expect(doc.getElementById("js")?.getAttribute("href")).toBeNull();
    expect(doc.getElementById("vb")?.getAttribute("xlink:href")).toBeNull();
    expect(doc.getElementById("png")?.getAttribute("href")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(doc.getElementById("web")?.getAttribute("href")).toBe("https://example.com/diagram");
  });

  it("returns a diagram with ordinary links unchanged", () => {
    const plain = `<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><text>Core</text></a></svg>`;
    expect(stripDangerousSvgUrls(plain)).toBe(plain);
  });
});
