/**
 * @vitest-environment happy-dom
 *
 * Mermaid's renderer needs a DOM. happy-dom is only used here so every bundled
 * template is parsed and drawn with the mermaid version the client ships.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diagramInitConfig, MERMAID_THEMES, parseDiagram } from "../src/lib/frontMatter";
import { renderMermaid } from "../src/lib/mermaidRender";

const templatesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");

/**
 * happy-dom reports a zero box for SVG text, and Mermaid treats that as "not
 * in the render tree". A real browser measures the text. Give the test a
 * non-zero box so sequence layout can finish.
 */
function installTextBox(): void {
  const box = function (this: Element) {
    const text = this.textContent ?? "";
    const width = Math.max(8, text.trim().length * 7);
    const height = text.trim() ? 18 : 8;
    return new DOMRect(0, 0, width, height);
  };
  const ctors = [globalThis.SVGElement, globalThis.SVGGraphicsElement, globalThis.SVGSVGElement].filter(
    (ctor): ctor is typeof SVGElement => typeof ctor === "function",
  );
  for (const ctor of ctors) {
    Object.defineProperty(ctor.prototype, "getBBox", {
      configurable: true,
      value: box,
    });
  }
  // Mindmap layout uses cytoscape, which asks for a 2d canvas. happy-dom has no canvas.
  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = function getContext() {
      const noop = () => undefined;
      return {
        canvas: this,
        fillRect: noop,
        clearRect: noop,
        getImageData: () => ({ data: [] }),
        putImageData: noop,
        createImageData: () => [],
        setTransform: noop,
        drawImage: noop,
        save: noop,
        fillText: noop,
        restore: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        closePath: noop,
        stroke: noop,
        translate: noop,
        scale: noop,
        rotate: noop,
        arc: noop,
        fill: noop,
        measureText: () => ({ width: 0 }),
        transform: noop,
        rect: noop,
        clip: noop,
      } as unknown as CanvasRenderingContext2D;
    };
  }
}

const EXPECTED = [
  "api-request-sequence.mmd",
  "brainstorm.mmd",
  "change-request.mmd",
  "change-window.mmd",
  "cicd-pipeline.mmd",
  "class-model.mmd",
  "cloud-vpc.mmd",
  "database-er.mmd",
  "firewall-policy.mmd",
  "flowchart-starter.mmd",
  "git-branching.mmd",
  "home-lab.mmd",
  "hybrid-cloud.mmd",
  "incident-response.mmd",
  "internet-edge.mmd",
  "migration-plan.mmd",
  "network-segmentation.mmd",
  "network-topology.mmd",
  "order-state.mmd",
  "power-cooling.mmd",
  "process-flow.mmd",
  "purdue-model.mmd",
  "rack-elevation.mmd",
  "remote-site-cellular.mmd",
  "scada-communications.mmd",
  "sequence-starter.mmd",
  "server-storage-rack.mmd",
  "site-to-site-vpn.mmd",
  "spine-leaf.mmd",
  "team-task-board.mmd",
  "wan-topology.mmd",
  "zero-trust-access.mmd",
];

describe("bundled templates render", () => {
  it(
    "parses and renders every template with its front-matter theme",
    async () => {
      installTextBox();
      const names = (await fs.readdir(templatesDir)).filter((name) => name.endsWith(".mmd")).sort();
      expect(names).toEqual(EXPECTED);
      for (const name of names) {
        const source = await fs.readFile(path.join(templatesDir, name), "utf8");
        const parsed = parseDiagram(source);
        expect(parsed.malformed, name).toBe(false);
        expect(parsed.theme, name).toBeTruthy();
        expect(MERMAID_THEMES, name).toContain(parsed.theme);
        expect(diagramInitConfig(source).theme, name).toBe(parsed.theme);
        let rendered: { svg: string };
        try {
          rendered = await renderMermaid(source);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`${name}: ${message}`);
        }
        expect(rendered.svg, name).toContain("<svg");
        expect(rendered.svg.toLowerCase(), name).not.toContain("syntax error");
      }
    },
    60_000,
  );
});
