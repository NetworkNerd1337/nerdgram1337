/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { parseDiagram } from "../src/lib/frontMatter";
import { rememberColor, readRecentColors, writeRecentColors } from "../src/lib/recentColors";
import {
  applyStyleToSource,
  contentWithStyle,
  copyPresetName,
  initialPresetId,
  styleChanges,
  swatchColors,
  type StyleSnapshot,
} from "../src/lib/stylePresets";

const BODY = "flowchart LR\n  A --> B\n";

const style: StyleSnapshot = {
  theme: "forest",
  look: null,
  handDrawnSeed: null,
  layout: "dagre",
  fontFamily: "IBM Plex Sans",
  themeVariables: { primaryColor: "#112233" },
  themeCSS: null,
  flowchartCurve: null,
  elk: { mergeEdges: null, nodePlacementStrategy: null },
  displayMode: null,
};

describe("style preset values", () => {
  it("copies style into the file and can undo back to the original text", () => {
    const source = `---\ntitle: Campus\nconfig:\n  theme: dark\n  themeVariables:\n    lineColor: "#abcdef"\n---\n${BODY}`;
    const applied = applyStyleToSource(source, style);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const parsed = parseDiagram(applied.source);
    expect(parsed.title).toBe("Campus");
    expect(parsed.body).toBe(BODY);
    expect(parsed.theme).toBe("forest");
    expect(parsed.fontFamily).toBe("IBM Plex Sans");
    expect(parsed.themeVariables.primaryColor).toBe("#112233");
    expect(parsed.themeVariables.lineColor).toBeUndefined();
    expect(applied.source).not.toContain("preset");
    const richer = `---\nconfig:\n  theme: dark\n  flowchart:\n    curve: linear\n  elk:\n    mergeEdges: true\n---\n${BODY}`;
    const cleared = applyStyleToSource(richer, style);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(parseDiagram(cleared.source).flowchartCurve).toBeNull();
      expect(parseDiagram(cleared.source).elk.mergeEdges).toBeUndefined();
      expect(parseDiagram(cleared.source).theme).toBe("forest");
    }
    const changes = styleChanges(parseDiagram(source), style).map((change) => change.label);
    expect(changes).toContain("Theme");
    expect(changes).toContain("primaryColor");
    expect(changes).toContain("lineColor");
    expect(contentWithStyle(BODY, null)).toBe(BODY);
  });

  it("selects the default preset for a new diagram and keeps a template's style", () => {
    const doc = { defaultId: "sp0123456789abcdef", presets: [{ id: "sp0123456789abcdef" }] };
    expect(initialPresetId("create", doc)).toBe("sp0123456789abcdef");
    expect(initialPresetId("template", doc)).toBe("");
    expect(initialPresetId("create", { defaultId: null, presets: [] })).toBe("");
    expect(copyPresetName("House", ["House"])).toBe("Copy of House");
    expect(copyPresetName("House", ["House", "Copy of House"])).toBe("Copy of House 2");
  });

  it("puts workspace colors before recent picks and remembers a recent color", () => {
    const swatches = swatchColors(
      [{ color: "#112233", count: 4 }],
      ["#ffffff", "#112233"],
    );
    expect(swatches.map((item) => item.color)).toEqual(["#112233", "#ffffff"]);
    expect(swatches[1].source).toBe("recent");
    localStorage.clear();
    writeRecentColors(rememberColor(readRecentColors(), "#ABC"));
    expect(readRecentColors()).toEqual(["#aabbcc"]);
  });
});
