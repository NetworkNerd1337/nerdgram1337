/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDivider } from "../src/components/EditorDivider";
import {
  CODE_MIN_PX,
  DEFAULT_EDITOR_SPLIT,
  EDITOR_SPLIT_KEY,
  PREVIEW_MIN_PX,
  clampEditorSplit,
  readEditorSplit,
  writeEditorSplit,
} from "../src/lib/editorSplit";

describe("editor split", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("keeps a default split, ignores junk, and remembers a number", () => {
    expect(readEditorSplit(null)).toBe(DEFAULT_EDITOR_SPLIT);
    expect(readEditorSplit(localStorage)).toBe(42);
    localStorage.setItem(EDITOR_SPLIT_KEY, "nope");
    expect(readEditorSplit(localStorage)).toBe(DEFAULT_EDITOR_SPLIT);
    writeEditorSplit(localStorage, 61.24);
    expect(localStorage.getItem(EDITOR_SPLIT_KEY)).toBe("61.2");
    expect(readEditorSplit(localStorage)).toBe(61.2);
  });

  it("clamps so neither pane collapses", () => {
    expect(clampEditorSplit(42, 1000, CODE_MIN_PX, PREVIEW_MIN_PX)).toBe(42);
    expect(clampEditorSplit(1, 1000, CODE_MIN_PX, PREVIEW_MIN_PX)).toBeCloseTo(28);
    expect(clampEditorSplit(99, 1000, CODE_MIN_PX, PREVIEW_MIN_PX)).toBeCloseTo(72);
    expect(clampEditorSplit(Number.NaN, 1000, CODE_MIN_PX, PREVIEW_MIN_PX)).toBe(DEFAULT_EDITOR_SPLIT);
    const tight = clampEditorSplit(10, 200, CODE_MIN_PX, PREVIEW_MIN_PX);
    expect(tight).toBeGreaterThan(0);
    expect(tight).toBeLessThan(100);
  });

  it("is a focusable separator that arrow keys and a double-click move", () => {
    let value = 42;
    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <EditorDivider
            value={value}
            min={20}
            max={80}
            onChange={(next) => {
              value = next;
            }}
            onReset={() => {
              value = DEFAULT_EDITOR_SPLIT;
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
    expect(separator).toBeTruthy();
    expect(separator?.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator?.getAttribute("aria-valuenow")).toBe("42");
    expect(separator?.getAttribute("aria-valuemin")).toBe("20");
    expect(separator?.getAttribute("aria-valuemax")).toBe("80");
    expect(separator?.tabIndex).toBe(0);
    expect(separator?.style.cursor).toBe("col-resize");
    expect(separator?.getAttribute("aria-label")).toMatch(/editor and preview/i);

    separator?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(value).toBe(44);
    render();
    expect(document.querySelector("[role='separator']")?.getAttribute("aria-valuenow")).toBe("44");

    document.querySelector("[role='separator']")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(value).toBe(DEFAULT_EDITOR_SPLIT);
    render();
    expect(document.querySelector("[role='separator']")?.getAttribute("aria-valuenow")).toBe("42");
  });

  it("reports a whole number at a fractional limit", () => {
    act(() => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      root.render(
        <EditorDivider
          value={78.658}
          min={22.2}
          max={78.658}
          onChange={() => undefined}
          onReset={() => undefined}
          onPointerDown={() => undefined}
          onPointerMove={() => undefined}
          onPointerUp={() => undefined}
        />,
      );
    });
    const separator = document.querySelector("[role='separator']");
    expect(separator?.getAttribute("aria-valuenow")).toBe("79");
    expect(separator?.getAttribute("aria-valuemin")).toBe("22");
    expect(separator?.getAttribute("aria-valuemax")).toBe("79");
  });

  it("clamps a wide split for a narrower window without replacing the saved choice", () => {
    const saved = 82;
    writeEditorSplit(localStorage, saved);
    const narrow = clampEditorSplit(readEditorSplit(localStorage), 992, CODE_MIN_PX, PREVIEW_MIN_PX);
    expect(narrow).toBeCloseTo(71.77, 1);
    expect(readEditorSplit(localStorage)).toBe(saved);
    const wide = clampEditorSplit(readEditorSplit(localStorage), 1592, CODE_MIN_PX, PREVIEW_MIN_PX);
    expect(wide).toBe(saved);
  });
});
