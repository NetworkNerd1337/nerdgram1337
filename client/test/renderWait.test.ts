import { describe, expect, it } from "vitest";
import {
  RENDER_CANCELLED_MESSAGE,
  SLOW_RENDER_NODES,
  countDiagramNodes,
  renderGuarded,
  renderOverlayText,
  slowRenderLabel,
} from "../src/lib/renderWait";

describe("render progress", () => {
  it("stays quiet under the large-diagram threshold", () => {
    expect(slowRenderLabel(SLOW_RENDER_NODES - 1)).toBeNull();
    expect(slowRenderLabel(12)).toBeNull();
  });

  it("names the node count before a large render", () => {
    expect(slowRenderLabel(SLOW_RENDER_NODES)).toBe("Rendering 200 nodes…");
    expect(renderOverlayText(1001)).toBe("Rendering 1,001 nodes…");
  });

  it("counts declared nodes and edge endpoints", () => {
    const source = ["flowchart LR", 'a["Core"]', "a --> b", "a --> c"].join("\n");
    expect(countDiagramNodes(source)).toBe(3);
  });

  it("paints the overlay before a large draw and drops a queued cancel", async () => {
    const events: string[] = [];
    let cancelled = false;
    const outcome = await renderGuarded({
      nodeCount: 1001,
      showOverlay: (text) => events.push(text),
      hideOverlay: () => events.push("hide"),
      cancelled: () => cancelled,
      run: async () => {
        events.push("run");
        cancelled = true;
        return "svg";
      },
    });
    expect(events[0]).toBe("Rendering 1,001 nodes…");
    expect(events.indexOf("run")).toBeGreaterThan(0);
    expect(outcome.ok).toBe(false);
    expect(events.at(-1)).toBe("hide");
  });

  it("draws a small diagram with no overlay", async () => {
    let shown = false;
    const outcome = await renderGuarded({
      nodeCount: 4,
      showOverlay: () => {
        shown = true;
      },
      hideOverlay: () => undefined,
      cancelled: () => false,
      run: async () => "svg",
    });
    expect(shown).toBe(false);
    expect(outcome).toEqual({ ok: true, value: "svg" });
  });

  it("names the cancelled render", () => {
    expect(RENDER_CANCELLED_MESSAGE).toMatch(/cancelled/i);
    expect(RENDER_CANCELLED_MESSAGE).toMatch(/editor/i);
  });
});
