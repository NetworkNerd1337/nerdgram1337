/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDivider } from "../src/components/EditorDivider";
import { EDITOR_SPLIT_KEY } from "../src/lib/editorSplit";
import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_PX,
  SIDEBAR_MIN_PX,
  SIDEBAR_STEP,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
} from "../src/lib/sidebarWidth";

describe("sidebar width", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("clamps between the minimum and half the viewport, and not past 560", () => {
    expect(clampSidebarWidth(280, 1400)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(100, 1400)).toBe(SIDEBAR_MIN_PX);
    expect(clampSidebarWidth(900, 1400)).toBe(SIDEBAR_MAX_PX);
    expect(clampSidebarWidth(500, 800)).toBe(400);
    expect(clampSidebarWidth(Number.NaN, 1400)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(280, 300)).toBe(150);
  });

  it("remembers a width and does not touch the editor split", () => {
    expect(readSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "nope");
    expect(readSidebarWidth(localStorage)).toBe(DEFAULT_SIDEBAR_WIDTH);
    localStorage.setItem(EDITOR_SPLIT_KEY, "42");
    writeSidebarWidth(localStorage, 344.4);
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("344");
    expect(readSidebarWidth(localStorage)).toBe(344);
    expect(localStorage.getItem(EDITOR_SPLIT_KEY)).toBe("42");
  });

  it("is a focusable separator that arrow keys, Home, and Enter resize", () => {
    let value = 280;
    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <EditorDivider
            className="app-split"
            label="Resize sidebar"
            value={value}
            min={200}
            max={560}
            step={SIDEBAR_STEP}
            valueText={`${value} pixels`}
            onChange={(next) => {
              value = next;
            }}
            onReset={() => {
              value = DEFAULT_SIDEBAR_WIDTH;
            }}
            onHome={() => {
              value = DEFAULT_SIDEBAR_WIDTH;
            }}
            onPointerDown={() => undefined}
            onPointerMove={() => undefined}
            onPointerUp={() => undefined}
          />,
        );
      });
    }
    render();
    const separator = document.querySelector<HTMLElement>("[role='separator']");
    expect(separator?.className).toContain("app-split");
    expect(separator?.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator?.getAttribute("aria-valuenow")).toBe("280");
    expect(separator?.getAttribute("aria-valuemin")).toBe("200");
    expect(separator?.getAttribute("aria-valuemax")).toBe("560");
    expect(separator?.getAttribute("aria-valuetext")).toBe("280 pixels");
    expect(separator?.getAttribute("aria-label")).toBe("Resize sidebar");
    expect(separator?.tabIndex).toBe(0);
    expect(separator?.style.cursor).toBe("col-resize");

    separator?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(value).toBe(280 + SIDEBAR_STEP);
    render();
    expect(document.querySelector("[role='separator']")?.getAttribute("aria-valuenow")).toBe(String(280 + SIDEBAR_STEP));

    document.querySelector("[role='separator']")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(value).toBe(DEFAULT_SIDEBAR_WIDTH);
    render();
    document.querySelector("[role='separator']")?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(value).toBe(DEFAULT_SIDEBAR_WIDTH - SIDEBAR_STEP);
    render();
    document.querySelector("[role='separator']")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(value).toBe(DEFAULT_SIDEBAR_WIDTH);

    document.querySelector("[role='separator']")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(value).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});
