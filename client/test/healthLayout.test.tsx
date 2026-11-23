/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PaletteContext } from "../src/components/commandPaletteContext";
import { HealthPage } from "../src/pages/HealthPage";

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      tree: vi.fn(async () => ({ tree: [] })),
      bookmarks: vi.fn(async () => ({ folders: [], items: [] })),
      setBookmarks: vi.fn(async (value: unknown) => value),
      diagramLint: vi.fn(async () => ({
        checked: 0,
        relinted: 0,
        durationMs: 1,
        cachedAt: "2026-11-18T00:00:00.000Z",
        diagrams: [],
        unreadable: [],
        muted: [],
      })),
    },
  };
});

vi.mock("../src/components/Sidebar", () => ({
  Sidebar: () => <aside className="sidebar">Sidebar</aside>,
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

describe("Diagram health layout", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  it("puts the main region in the flexible column, after the sidebar divider", async () => {
    host = document.createElement("div");
    host.style.width = "1280px";
    host.style.height = "800px";
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/health"]}>
          <PaletteContext.Provider value={{ setHost: () => undefined, openPalette: () => undefined }}>
            <HealthPage />
          </PaletteContext.Provider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const shell = host.querySelector(".app-shell");
    expect(shell).toBeTruthy();
    const children = [...(shell?.children ?? [])];
    expect(children[0]?.classList.contains("sidebar")).toBe(true);
    expect(children[1]?.classList.contains("app-split")).toBe(true);
    const main = children[2];
    expect(main?.tagName).toBe("MAIN");
    expect(main?.classList.contains("health-page")).toBe(true);

    const width = main?.getBoundingClientRect().width ?? 0;
    if (width > 0) expect(width).toBeGreaterThan(600);
  });
});
