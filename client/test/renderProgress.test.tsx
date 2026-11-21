/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFindBar } from "../src/components/NodeFindBar";
import { RenderProgress } from "../src/components/RenderProgress";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const host = () => {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("render and find controls", () => {
  it("shows the overlay copy and Cancel", () => {
    let cancelled = false;
    const element = host();
    act(() => {
      root = createRoot(element);
      root.render(<RenderProgress text="Rendering 1,001 nodes… 3s" onCancel={() => (cancelled = true)} />);
    });
    expect(element.textContent).toContain("Rendering 1,001 nodes… 3s");
    const button = element.querySelector("button");
    expect(button?.textContent).toBe("Cancel");
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(cancelled).toBe(true);
  });

  it("closes node search on Escape and steps the matches", () => {
    let step = 0;
    let closed = false;
    const element = host();
    act(() => {
      root = createRoot(element);
      root.render(
        <NodeFindBar
          query="10.1"
          onQuery={() => undefined}
          index={0}
          count={2}
          onStep={(delta) => (step = delta)}
          onClose={() => (closed = true)}
        />,
      );
    });
    expect(element.textContent).toContain("1 of 2");
    const buttons = [...element.querySelectorAll("button")];
    act(() => buttons.find((button) => button.textContent === "Next")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => buttons.find((button) => button.textContent === "Previous")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = element.querySelector("input");
    act(() => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(step).toBe(-1);
    expect(closed).toBe(true);
  });
});
