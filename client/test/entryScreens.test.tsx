/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaletteContext } from "../src/components/commandPaletteContext";
import { GeneratePage } from "../src/pages/GeneratePage";
import { NewDiagramPage } from "../src/pages/NewDiagramPage";

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      tree: vi.fn(async () => ({ tree: [] })),
      bookmarks: vi.fn(async () => ({ folders: [], items: [] })),
      stylePresets: vi.fn(async () => ({ presets: [], defaultPresetId: null })),
      listTranslators: vi.fn(async () => ({ translators: [] })),
    },
  };
});

describe("new diagram screens", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function render(node: ReactNode): Promise<void> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PaletteContext.Provider value={{ setHost: () => undefined, openPalette: () => undefined }}>
            {node}
          </PaletteContext.Provider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("gives Paste Mermaid a description and no mode pill", async () => {
    await render(<NewDiagramPage />);
    expect(document.querySelector("h1")?.textContent).toBe("What do you want to diagram?");
    expect(document.querySelector(".paste-mode")).toBeNull();
    expect(document.body.textContent).not.toContain("</>");
    const lead = document.querySelector(".entry-lead");
    expect(lead?.textContent).toContain("Paste Mermaid code");
    expect(lead?.tagName).toBe("P");
  });

  it("uses the same description spacing on From data", async () => {
    await render(<GeneratePage />);
    expect(document.querySelector("h1")?.textContent).toBe("Generate a diagram from data");
    expect(document.querySelector(".paste-mode")).toBeNull();
    expect(document.querySelector(".entry-lead")?.textContent).toContain("Network JSON");
  });
});
