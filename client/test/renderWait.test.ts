import { describe, expect, it } from "vitest";
import {
  RENDER_CANCELLED_MESSAGE,
  RENDER_PROGRESS_AFTER_MS,
  countDiagramNodes,
  renderOverlayText,
  shouldShowRenderOverlay,
} from "../src/lib/renderWait";

describe("render progress", () => {
  it("stays quiet for a fast render", () => {
    expect(shouldShowRenderOverlay(400)).toBe(false);
    expect(shouldShowRenderOverlay(RENDER_PROGRESS_AFTER_MS - 1)).toBe(false);
  });

  it("shows the node count and elapsed time after one second", () => {
    expect(shouldShowRenderOverlay(RENDER_PROGRESS_AFTER_MS)).toBe(true);
    expect(renderOverlayText(1001, 3400)).toBe("Rendering 1,001 nodes… 3s");
  });

  it("counts declared nodes and edge endpoints", () => {
    const source = ["flowchart LR", 'a["Core"]', "a --> b", "a --> c"].join("\n");
    expect(countDiagramNodes(source)).toBe(3);
  });

  it("names the cancelled render", () => {
    expect(RENDER_CANCELLED_MESSAGE).toMatch(/cancelled/i);
    expect(RENDER_CANCELLED_MESSAGE).toMatch(/editor/i);
  });
});
