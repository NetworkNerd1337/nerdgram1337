import { describe, expect, it } from "vitest";
import { exportBackgroundColor, insertBackgroundRect, svgHasForeignObject, withSvgTextLabels } from "../src/lib/exportSvg";

describe("export background and svg text labels", () => {
  it("paints the theme background for jpg and png, and stays transparent only when asked", () => {
    expect(exportBackgroundColor({ fromTheme: "#141414" })).toBe("#141414");
    expect(exportBackgroundColor({ fromSvg: "#333333", fromTheme: "#141414" })).toBe("#333333");
    expect(exportBackgroundColor({ transparent: true, fromTheme: "#141414" })).toBeNull();
    expect(exportBackgroundColor({})).toBe("#ffffff");
  });

  it("turns html labels off without dropping a diagram's other options", () => {
    const config = withSvgTextLabels({ theme: "neo-dark", flowchart: { curve: "basis" } });
    expect(config.theme).toBe("neo-dark");
    expect(config.flowchart).toMatchObject({ curve: "basis", htmlLabels: false });
    expect((config.sequence as { htmlLabels: boolean }).htmlLabels).toBe(false);
  });

  it("puts a background rect in the svg and notices foreignObject labels", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject></foreignObject></svg>`;
    expect(svgHasForeignObject(svg)).toBe(true);
    const painted = insertBackgroundRect(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>A</text></svg>`, "#141414");
    expect(painted.startsWith(`<svg`)).toBe(true);
    expect(painted).toContain(`fill="#141414"`);
    expect(painted).toContain("background-color:#141414");
    expect(painted.indexOf("nerdgram-export-background")).toBeLessThan(painted.indexOf("<text"));
  });
});
