/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TagCombobox } from "../src/components/TagCombobox";
import type { TagCount } from "../src/lib/tagSuggestions";

const catalog: TagCount[] = [
  { tag: "firewall", count: 12 },
  { tag: "edge", count: 3 },
  { tag: "lab", count: 8 },
];

describe("tag combobox", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const added: string[] = [];

  beforeEach(() => {
    added.length = 0;
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
  });

  function render(exclude: string[] = []) {
    act(() => {
      root?.render(
        createElement(TagCombobox, {
          catalog,
          exclude,
          onAdd: (tag: string) => added.push(tag),
        }),
      );
    });
  }

  function input(): HTMLInputElement {
    const node = container?.querySelector("input");
    if (!(node instanceof HTMLInputElement)) throw new Error("missing tag input");
    return node;
  }

  function options(): string[] {
    return [...(container?.querySelectorAll("[role='option']") ?? [])].map((node) => node.textContent ?? "");
  }

  it("opens the most-used tags on focus and leaves out tags already on the diagram", () => {
    render(["firewall"]);
    act(() => {
      input().focus();
    });
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(options().join("\n")).toContain("lab");
    expect(options().join("\n")).not.toContain("firewall");
    expect(options()[0]).toContain("lab");
  });

  it("moves with the arrow keys, picks with Enter, and creates a new tag when nothing is highlighted", () => {
    render();
    const field = input();
    act(() => {
      field.focus();
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(added).toEqual(["firewall"]);

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, "wan");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options().some((text) => text.includes("Create"))).toBe(true);
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(added).toEqual(["firewall", "wan"]);
  });

  it("puts the existing spelling ahead of a case-only variant", () => {
    render();
    const field = input();
    act(() => {
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, "Firewall");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const text = options();
    expect(text[0]?.toLowerCase().startsWith("firewall")).toBe(true);
    expect(text.at(-1)).toContain("Create");
    expect(text.at(-1)).toContain("Firewall");
  });
});
