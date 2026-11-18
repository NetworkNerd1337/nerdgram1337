/**
 * @vitest-environment happy-dom
 */
import { createElement, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramInfoPanel } from "../src/components/DiagramInfoPanel";
import { StylePresetChoice } from "../src/components/StylePresetChoice";
import { parseDiagram } from "../src/lib/frontMatter";
import type { StyleSnapshot } from "../src/lib/stylePresets";

const BODY = "flowchart LR\n  A --> B\n";

const house: StyleSnapshot = {
  theme: "forest",
  look: "classic",
  handDrawnSeed: null,
  layout: null,
  fontFamily: "IBM Plex Sans",
  themeVariables: { primaryColor: "#112233" },
  themeCSS: null,
  flowchartCurve: null,
  elk: { mergeEdges: null, nodePlacementStrategy: null },
  displayMode: null,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch() {
  const calls: { url: string; method: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, method, body });
      if (url.includes("/api/style-presets") && method === "GET") {
        return jsonResponse({
          version: 1,
          defaultId: "sp0123456789abcdef",
          presets: [{ id: "sp0123456789abcdef", name: "House", style: house }],
        });
      }
      if (url.includes("/api/style-presets") && method === "POST") {
        return jsonResponse({
          version: 1,
          defaultId: "sp0123456789abcdef",
          presets: [{ id: "sp0123456789abcdef", name: "House", style: house }],
          preset: { id: "spfedcba9876543210", name: "Saved", style: house },
        });
      }
      if (url.includes("/api/fonts")) {
        return jsonResponse({ fonts: [{ fontFamily: "IBM Plex Sans", count: 2 }] });
      }
      if (url.includes("/api/colors")) {
        return jsonResponse({ colors: [{ color: "#112233", count: 3 }] });
      }
      if (url.includes("/api/tags")) return jsonResponse({ tags: [] });
      return jsonResponse({});
    }),
  );
  return calls;
}

describe("Diagram info style presets", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  async function render(initial: string) {
    let latest = initial;
    function Harness() {
      const [source, setSource] = useState(initial);
      return createElement(DiagramInfoPanel, {
        source,
        fileName: "Topology.mmd",
        readOnly: false,
        onChange: (next) => {
          latest = next;
          setSource(next);
        },
        onClose: () => undefined,
      });
    }
    await act(async () => {
      root?.render(createElement(Harness));
    });
    await act(async () => {
      await Promise.resolve();
    });
    return () => latest;
  }

  function setSelect(label: string, value: string) {
    const element = document.querySelector(`[aria-label="${label}"]`);
    if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} missing`);
    const prototype = Object.getPrototypeOf(element) as { value?: { set?: (v: string) => void } };
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("previews a preset, copies it into the file, and undoes that copy", async () => {
    installFetch();
    const latest = await render(`---\nconfig:\n  theme: dark\n---\n${BODY}`);
    await act(async () => {
      setSelect("Apply style preset", "sp0123456789abcdef");
    });
    expect(document.body.textContent).toContain("House will change this file");
    expect(document.body.textContent).toContain("Theme: dark → forest");
    const apply = [...document.querySelectorAll("button")].find((button) => button.textContent === "Apply");
    await act(async () => {
      apply?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(parseDiagram(latest()).theme).toBe("forest");
    expect(parseDiagram(latest()).themeVariables.primaryColor).toBe("#112233");
    expect(parseDiagram(latest()).body).toBe(BODY);
    expect(latest()).not.toContain("sp0123456789abcdef");
    const undo = [...document.querySelectorAll("button")].find((button) => button.textContent === "Undo");
    await act(async () => {
      undo?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(parseDiagram(latest()).theme).toBe("dark");
    expect(parseDiagram(latest()).themeVariables.primaryColor).toBeUndefined();
  });

  it("suggests a custom font and applies a color swatch from the keyboard", async () => {
    installFetch();
    const latest = await render(BODY);
    await act(async () => {
      setSelect("Font family", "custom");
    });
    const input = document.querySelector('[aria-label="Custom font family"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("custom font input missing");
    await act(async () => {
      input.focus();
      const prototype = Object.getPrototypeOf(input) as object;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, "ibm");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("IBM Plex Sans");
    expect(document.body.textContent).toContain("2 diagrams");
    const option = document.querySelector('[role="listbox"] [role="option"] button');
    await act(async () => {
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(parseDiagram(latest()).fontFamily).toBe("IBM Plex Sans");

    const swatch = document.querySelector('[aria-label="Colors for Primary"] [role="option"]');
    expect(swatch).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      (swatch as HTMLButtonElement).focus();
      swatch?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      (swatch as HTMLButtonElement).click();
    });
    expect(parseDiagram(latest()).themeVariables.primaryColor).toBe("#112233");
    expect(swatch?.getAttribute("aria-label")).toMatch(/3 diagrams/);
  });
});

describe("create flow preset choice", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    vi.unstubAllGlobals();
  });

  async function renderChoice(mode: "create" | "template") {
    let choice = "";
    function Harness() {
      return createElement(StylePresetChoice, {
        mode,
        onChange: (next) => {
          choice = next.id;
        },
      });
    }
    await act(async () => {
      root?.render(createElement(Harness));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return () => choice;
  }

  it("starts on the default preset for a new diagram and on the template style for a template", async () => {
    installFetch();
    const created = await renderChoice("create");
    const select = document.querySelector('[aria-label="Style preset"]');
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect((select as HTMLSelectElement).value).toBe("sp0123456789abcdef");
    expect(created()).toBe("sp0123456789abcdef");
    expect(document.body.textContent).toContain("No preset");

    await act(async () => {
      root?.unmount();
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const template = await renderChoice("template");
    const templateSelect = document.querySelector('[aria-label="Style preset"]');
    expect((templateSelect as HTMLSelectElement).value).toBe("");
    expect(template()).toBe("");
    expect(document.body.textContent).toContain("Keep template style");
  });
});
