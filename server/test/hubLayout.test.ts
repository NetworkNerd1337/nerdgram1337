import { afterAll, describe, expect, it } from "vitest";
import { applyDiagramPatch, parseDiagram } from "../src/frontMatter.js";
import { boundsAspect, placeHubSpokes, readHubLayout, relayoutHubSvg } from "../src/hubLayout.js";
import { closeRenderer, renderDiagram } from "../src/renderDiagram.js";

const BODY = "flowchart LR\n  A --> B\n";

function hubSource(mode: "compact" | "radial" | null, spokes = 36): string {
  const lines = ["flowchart LR", `  hub["Hub"]`];
  for (let index = 1; index <= spokes; index += 1) {
    lines.push(`  s${index}["Spoke ${index}"]`);
    lines.push(`  hub --> s${index}`);
  }
  const body = lines.join("\n");
  if (!mode) return body;
  return `---\nnerdgram:\n  hubLayout: ${mode}\n---\n${body}\n`;
}

function fakeSvg(ids: string[]): string {
  const nodes = ids
    .map((id, index) => `<g class="node default" id="diagram-flowchart-${id}-${index}" transform="translate(${index * 400}, 40)">`)
    .join("");
  const edges = ids.slice(1).map((id) => `<path d="M0,0 L1,1" data-id="L_hub_${id}_0" class="flowchart-link"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9000 400" style="max-width: 9000px;">${nodes}${edges}</svg>`;
}

describe("hub layout", () => {
  afterAll(async () => {
    await closeRenderer();
  });

  it("leaves an ordinary diagram unchanged unless the file opts in", () => {
    expect(readHubLayout(BODY)).toBeNull();
    const patched = applyDiagramPatch(BODY, { hubLayout: "compact" });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.source).toContain("hubLayout: compact");
    expect(patched.source.endsWith(BODY)).toBe(true);
    expect(parseDiagram(patched.source).hubLayout).toBe("compact");
    expect(readHubLayout(patched.source)).toBe("compact");
    const cleared = applyDiagramPatch(patched.source, { hubLayout: null });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.source).not.toContain("hubLayout");
    expect(parseDiagram(cleared.source).body.trim()).toBe(BODY.trim());
  });

  it("packs 500 spokes into a roughly square grid or rings", () => {
    for (const mode of ["compact", "radial"] as const) {
      const placed = placeHubSpokes(500, mode);
      expect(placed.spokes).toHaveLength(500);
      const aspect = boundsAspect([placed.hub, ...placed.spokes]);
      expect(aspect).toBeLessThan(1.35);
    }
  });

  it("does not move a diagram that is not a hub, even when the setting is on", () => {
    const source = `---\nnerdgram:\n  hubLayout: radial\n---\nflowchart LR\n  A --> B\n  B --> C\n`;
    const svg = `<svg viewBox="0 0 10 10"><g class="node default" id="diagram-flowchart-A-0" transform="translate(1, 1)"></g></svg>`;
    expect(relayoutHubSvg(svg, source)).toBe(svg);
  });

  it("moves spoke nodes and the picture bounds when the file asks for a compact hub", () => {
    const ids = ["hub", ...Array.from({ length: 8 }, (_, index) => `s${index + 1}`)];
    const source = hubSource("compact", 8);
    const svg = fakeSvg(ids);
    const next = relayoutHubSvg(svg, source);
    expect(next).not.toBe(svg);
    expect(next).not.toContain('id="diagram-flowchart-s1-1" transform="translate(400, 40)"');
    expect(next).toMatch(/viewBox="-?\d+ -?\d+ \d+ \d+"/);
    const box = next.match(/viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/);
    expect(box).not.toBeNull();
    const width = Number(box?.[3]);
    const height = Number(box?.[4]);
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(1.5);
  });

  it("renders an opted-in hub as a roughly square picture", async () => {
    const rendered = await renderDiagram({ source: hubSource("radial", 24), format: "svg" });
    const svg = rendered.body.toString("utf8");
    const box = svg.match(/<svg\b[^>]*viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/);
    expect(box).not.toBeNull();
    const width = Number(box?.[3]);
    const height = Number(box?.[4]);
    expect(width).toBeGreaterThan(200);
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(1.6);
    const plain = await renderDiagram({ source: hubSource(null, 24), format: "svg" });
    const plainBox = plain.body.toString("utf8").match(/viewBox="(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    const plainWidth = Number(plainBox?.[3]);
    const plainHeight = Number(plainBox?.[4]);
    expect(Math.max(plainWidth, plainHeight) / Math.min(plainWidth, plainHeight)).toBeGreaterThan(1.6);
  });
});
