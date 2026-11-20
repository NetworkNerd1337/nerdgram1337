/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationView } from "../src/components/PresentationView";

vi.mock("../src/api", () => ({
  api: {
    tree: async () => ({ tree: [] }),
    readFile: async (path: string) => ({ path, content: "flowchart LR\n  A --> B\n", hash: "h", mtimeMs: 1 }),
  },
}));

vi.mock("../src/lib/mermaidRender", () => ({
  renderMermaid: async () => ({
    id: "mock",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"></svg>`,
  }),
}));

function installMatchMedia(narrow: boolean): void {
  window.matchMedia = ((query: string) => {
    const matches = query.includes("max-width: 520px") ? narrow : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    };
  }) as typeof window.matchMedia;
}

describe("presentation controls at a phone width", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function mount(): Promise<void> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<PresentationView source={"flowchart LR\n  A --> B\n"} path="Campus.mmd" onExit={() => undefined} />);
    });
  }

  it("keeps zoom, fit, and exit on the bar and moves the rest into More at 390px", async () => {
    installMatchMedia(true);
    await mount();
    const rootNode = document.querySelector(".presentation");
    expect(rootNode?.className).toContain("is-compact");
    const bar = document.querySelector(".presentation-bar");
    expect(bar?.querySelector("[aria-label='Zoom out']")).toBeTruthy();
    expect(bar?.querySelector("[aria-label='Fit page']")).toBeTruthy();
    expect(bar?.querySelector("[aria-label='Exit presentation']")).toBeTruthy();
    expect(document.getElementById("presentation-more")).toBeNull();
    expect(bar?.querySelector(":scope > [aria-label='Rotate left']")).toBeNull();

    await act(async () => {
      [...document.querySelectorAll("button")].find((button) => button.textContent === "More")?.click();
    });
    const menu = document.getElementById("presentation-more");
    expect(menu?.querySelector("[aria-label='Rotate left']")).toBeTruthy();
    expect(menu?.querySelector("[aria-label='Hide title']")).toBeTruthy();
    expect(menu?.querySelector("[aria-label='Enter full screen']")).toBeTruthy();
    expect(bar?.querySelector(":scope > [aria-label='Rotate left']")).toBeNull();
  });

  it("leaves every control on the bar at a desktop width", async () => {
    installMatchMedia(false);
    await mount();
    const rootNode = document.querySelector(".presentation");
    expect(rootNode?.className).not.toContain("is-compact");
    const bar = document.querySelector(".presentation-bar");
    expect(bar?.querySelector(":scope > [aria-label='Rotate left']")).toBeTruthy();
    expect(bar?.querySelector(":scope > [aria-label='Enter full screen']")).toBeTruthy();
    expect(document.body.textContent).not.toContain("More");
  });

  it("puts the compact bar in the page flow and keeps the desktop toolbar on one row", () => {
    const css = readFileSync(path.resolve("src/index.css"), "utf8");
    const bar = css.slice(
      css.indexOf(".presentation.is-compact .presentation-bar {"),
      css.indexOf(".presentation.is-compact .presentation-bar .btn"),
    );
    expect(bar).toContain("position: relative");
    expect(bar).toContain("flex-wrap: nowrap");
    const hint = css.slice(css.indexOf(".presentation-rotate-hint {"), css.indexOf(".presentation-rotate-hint .btn"));
    expect(hint).toContain("position: relative");
    expect(hint).not.toContain("position: absolute");
    const toolbar = css.slice(
      css.indexOf(".preview-toolbar.is-single-row {"),
      css.indexOf(".preview-toolbar.is-single-row select"),
    );
    expect(toolbar).toContain("flex-wrap: nowrap");
  });
});
