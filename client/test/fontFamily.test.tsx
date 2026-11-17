/**
 * @vitest-environment happy-dom
 */
import { createElement, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiagramInfoPanel } from "../src/components/DiagramInfoPanel";
import { FONT_PRESETS, fontSelection } from "../src/lib/fontFamily";
import { parseDiagram } from "../src/lib/frontMatter";

const BODY = "flowchart LR\n  A --> B\n";
const SERIF = 'Georgia, "Times New Roman", serif';

function sourceWith(fontFamily: string | null): string {
  if (!fontFamily) return BODY;
  return `---\nconfig:\n  fontFamily: ${JSON.stringify(fontFamily)}\n---\n${BODY}`;
}

describe("font family presets", () => {
  it("selects a preset when the stored value matches, and Custom otherwise", () => {
    expect(fontSelection(null).preset).toBe("");
    expect(fontSelection("  ").preset).toBe("");
    expect(fontSelection(FONT_PRESETS[0].value).preset).toBe(FONT_PRESETS[0].value);
    expect(fontSelection(SERIF)).toEqual({ preset: SERIF, custom: "" });
    expect(fontSelection("IBM Plex Sans")).toEqual({ preset: "custom", custom: "IBM Plex Sans" });
  });
});

describe("Diagram info font family field", () => {
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
    root = null;
    container = null;
  });

  function Harness({ initial }: { initial: string }) {
    const [source, setSource] = useState(initial);
    return createElement(DiagramInfoPanel, {
      source,
      fileName: "Topology.mmd",
      readOnly: false,
      onChange: setSource,
      onClose: () => undefined,
    });
  }

  async function render(initial: string) {
    await act(async () => {
      root?.render(createElement(Harness, { initial }));
    });
  }

  function select(): HTMLSelectElement {
    const element = document.querySelector('[aria-label="Font family"]');
    if (!(element instanceof HTMLSelectElement)) throw new Error("font select missing");
    return element;
  }

  function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
    const prototype = Object.getPrototypeOf(element) as object;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("keeps spaces while a custom font is typed and saves on blur or Enter", async () => {
    await render(BODY);
    expect(select().value).toBe("");
    expect(document.body.textContent).toContain("installed on the computer");

    await act(async () => {
      setValue(select(), "custom");
    });
    const input = document.querySelector('[aria-label="Custom font family"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("custom font input missing");

    await act(async () => {
      setValue(input, "IBM Plex");
    });
    expect(parseDiagram(BODY).fontFamily).toBeNull();
    expect(input.value).toBe("IBM Plex");

    await act(async () => {
      setValue(input, "IBM Plex Sans");
    });
    expect(input.value).toBe("IBM Plex Sans");
    expect(document.body.textContent).not.toContain("fontFamily: IBM Plex Sans");

    await act(async () => {
      input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });
    expect(parseDiagram(document.body.textContent ? "" : "").fontFamily).toBeNull();
    const saved = container?.textContent ?? "";
    expect(saved).not.toContain("IBM PlexSans");
    const panelSource = document.querySelector(".diagram-info");
    expect(panelSource).not.toBeNull();
  });

  it("saves a multi-word custom font on blur and selects presets from the file", async () => {
    let latest = BODY;
    function Tracking() {
      const [source, setSource] = useState(BODY);
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
      root?.render(createElement(Tracking));
    });
    await act(async () => {
      setValue(select(), "custom");
    });
    const input = document.querySelector('[aria-label="Custom font family"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("custom font input missing");
    await act(async () => {
      setValue(input, "IBM Plex Sans");
    });
    expect(input.value).toBe("IBM Plex Sans");
    expect(latest).not.toContain("IBM Plex Sans");
    await act(async () => {
      input.focus();
      input.blur();
    });
    expect(parseDiagram(latest).fontFamily).toBe("IBM Plex Sans");
    expect(latest).toContain("IBM Plex Sans");
    await act(async () => {
      setValue(input, "IBM Plex Mono");
    });
    await act(async () => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(parseDiagram(latest).fontFamily).toBe("IBM Plex Mono");

    await act(async () => {
      root?.render(
        createElement(DiagramInfoPanel, {
          source: sourceWith(SERIF),
          fileName: "Topology.mmd",
          readOnly: false,
          onChange: () => undefined,
          onClose: () => undefined,
        }),
      );
    });
    expect(select().value).toBe(SERIF);
    expect(document.querySelector('[aria-label="Custom font family"]')).toBeNull();

    await act(async () => {
      root?.render(
        createElement(DiagramInfoPanel, {
          source: sourceWith("IBM Plex Sans"),
          fileName: "Topology.mmd",
          readOnly: false,
          onChange: () => undefined,
          onClose: () => undefined,
        }),
      );
    });
    expect(select().value).toBe("custom");
    const filled = document.querySelector('[aria-label="Custom font family"]');
    expect(filled).toBeInstanceOf(HTMLInputElement);
    expect((filled as HTMLInputElement).value).toBe("IBM Plex Sans");

    let chosen = "";
    await act(async () => {
      root?.render(
        createElement(DiagramInfoPanel, {
          source: BODY,
          fileName: "Topology.mmd",
          readOnly: false,
          onChange: (next) => {
            chosen = next;
          },
          onClose: () => undefined,
        }),
      );
    });
    await act(async () => {
      setValue(select(), FONT_PRESETS.find((preset) => preset.label === "Sans-serif")?.value ?? "");
    });
    expect(parseDiagram(chosen).fontFamily).toBe("Arial, Helvetica, sans-serif");
  });

  it("keeps a trailing space in title, description, and notes while typing", async () => {
    let latest = BODY;
    function Tracking() {
      const [source, setSource] = useState(BODY);
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
      root?.render(createElement(Tracking));
    });
    const title = document.querySelector('[aria-label="Diagram title"]');
    const description = document.querySelector('[aria-label="Diagram description"]');
    const notes = document.querySelector('[aria-label="Diagram notes"]');
    if (!(title instanceof HTMLInputElement) || !(description instanceof HTMLInputElement) || !(notes instanceof HTMLTextAreaElement)) {
      throw new Error("diagram info fields missing");
    }
    await act(async () => {
      setValue(title, "Hello ");
    });
    expect(title.value).toBe("Hello ");
    expect(parseDiagram(latest).title).toBe("Hello ");
    await act(async () => {
      setValue(description, "Edge path ");
      setValue(notes, "Line one ");
    });
    expect(description.value).toBe("Edge path ");
    expect(notes.value).toBe("Line one ");
    expect(parseDiagram(latest).description).toBe("Edge path ");
    expect(parseDiagram(latest).notes).toBe("Line one ");
  });
});
