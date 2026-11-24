/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderActions } from "../src/components/HeaderActions";
import { PaletteContext } from "../src/components/commandPaletteContext";
import { UpdateContext, type UpdateContextValue } from "../src/components/updateContext";
import { builtinCommands } from "../src/lib/builtinCommands";
import { HealthPage } from "../src/pages/HealthPage";
import { ReferencePage } from "../src/pages/ReferencePage";
import { SettingsPage } from "../src/pages/SettingsPage";
import { TemplatesPage } from "../src/pages/TemplatesPage";

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      tree: vi.fn(async () => ({ tree: [] })),
      bookmarks: vi.fn(async () => ({ folders: [], items: [] })),
      setBookmarks: vi.fn(async (value: unknown) => value),
      templates: vi.fn(async () => ({ templates: [] })),
      syncStatus: vi.fn(async () => {
        throw new Error("offline");
      }),
      referenceList: vi.fn(async () => ({
        pages: [],
        manifest: { lastSyncedAt: null, attribution: "" },
      })),
      doctor: vi.fn(async () => ({ ok: true, status: "ok", issues: [], writable: true, caseInsensitive: false })),
      diagramLint: vi.fn(async () => ({
        checked: 0,
        relinted: 0,
        durationMs: 1,
        cachedAt: "2026-11-23T00:00:00.000Z",
        diagrams: [],
        unreadable: [],
        muted: [],
      })),
      stylePresets: vi.fn(async () => ({ version: 1, defaultId: null, presets: [] })),
      tokens: vi.fn(async () => ({ tokens: [] })),
      listenHost: vi.fn(async () => ({})),
      dataDir: vi.fn(async () => ({})),
      instance: vi.fn(async () => ({})),
    },
  };
});

vi.mock("../src/components/Sidebar", () => ({
  Sidebar: () => <aside className="sidebar">Sidebar</aside>,
}));

vi.mock("../src/components/AppearanceSettings", () => ({ AppearanceSettings: () => null }));
vi.mock("../src/components/StylePresetsSettings", () => ({ StylePresetsSettings: () => null }));
vi.mock("../src/components/DiagramFolderSettings", () => ({ DiagramFolderSettings: () => null }));
vi.mock("../src/components/HostSettings", () => ({ HostSettings: () => null }));
vi.mock("../src/components/InstanceSettings", () => ({ InstanceSettings: () => null }));
vi.mock("../src/components/BookmarkManager", () => ({ BookmarkManager: () => null }));
vi.mock("../src/components/LintSettings", () => ({ LintSettings: () => null }));
vi.mock("../src/components/TokenSettings", () => ({ TokenSettings: () => null }));
vi.mock("../src/components/UpdateHost", () => ({ UpdateSettingsFields: () => null }));

const updates = {
  status: null,
  versionInfo: null,
  updateError: null,
  job: null,
  busy: false,
  checking: false,
  checkFeedback: null,
  notice: null,
  panel: null,
  actionError: null,
  openAbout: () => undefined,
  closePanel: () => undefined,
  checkNow: async () => undefined,
  later: async () => undefined,
  skip: async () => undefined,
  clearSkipped: async () => undefined,
  setAutomatic: async () => undefined,
  setPrerelease: async () => undefined,
  openNotes: () => undefined,
  openUpgrade: () => undefined,
  startApply: async () => undefined,
  reload: () => undefined,
  dismissNotice: () => undefined,
} as UpdateContextValue;

function names(root: ParentNode | null): string[] {
  return [...(root?.querySelectorAll("a, button") ?? [])].map((item) => {
    const named = item.getAttribute("aria-label");
    if (named) return named;
    return (item.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

describe("header actions", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function render(node: ReactNode) {
    act(() => root?.unmount());
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <UpdateContext.Provider value={updates}>
            <PaletteContext.Provider value={{ setHost: () => undefined, openPalette: () => undefined }}>
              {node}
            </PaletteContext.Provider>
          </UpdateContext.Provider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("renders About, Support, and Commands, then Back to dashboard, then children", async () => {
    await render(
      <HeaderActions>
        <button type="button">Rule settings</button>
      </HeaderActions>,
    );
    expect(names(document.querySelector(".header-actions"))).toEqual([
      "About NerdGram1337",
      "Support NerdGram1337 on Ko-fi",
      expect.stringMatching(/^Commands/),
      "Rule settings",
    ]);

    await render(
      <HeaderActions backToDashboard>
        <button type="button">Sync Syntax Reference</button>
      </HeaderActions>,
    );
    const row = names(document.querySelector(".header-actions"));
    expect(row[0]).toBe("About NerdGram1337");
    expect(row[1]).toBe("Support NerdGram1337 on Ko-fi");
    expect(row[2]).toMatch(/^Commands/);
    expect(row[3]).toBe("Back to dashboard");
    expect(row[4]).toBe("Sync Syntax Reference");
  });

  it("keeps each page on the standard order", async () => {
    await render(<SettingsPage />);
    const settings = document.querySelector(".reference-top-actions");
    const settingsNames = names(settings);
    expect(settingsNames.slice(0, 4)).toEqual([
      "About NerdGram1337",
      "Support NerdGram1337 on Ko-fi",
      expect.stringMatching(/^Commands/),
      "Back to dashboard",
    ]);
    expect(settings?.className).toContain("reference-top-actions");

    await render(<ReferencePage />);
    const reference = names(document.querySelector(".reference-top-actions"));
    expect(reference.filter((name) => name === "Back to dashboard")).toEqual([]);
    expect(reference.at(-1)).toBe("Sync Syntax Reference");
    expect(reference[0]).toBe("About NerdGram1337");

    await render(<HealthPage />);
    const health = names(document.querySelector(".health-head .header-actions"));
    expect(health.slice(0, 3)).toEqual([
      "About NerdGram1337",
      "Support NerdGram1337 on Ko-fi",
      expect.stringMatching(/^Commands/),
    ]);
    expect(health.at(-1)).toBe("Rule settings");
    expect(health).not.toContain("Back to dashboard");
    expect(document.querySelector(".health-page ~ .narrow-app-bar")).toBeTruthy();

    await render(<TemplatesPage />);
    const gallery = names(document.querySelector(".reference-top-actions"));
    expect(gallery).toEqual([
      "About NerdGram1337",
      "Support NerdGram1337 on Ko-fi",
      expect.stringMatching(/^Commands/),
      "Back to dashboard",
    ]);
    expect(document.querySelector(".reference-top-actions")?.textContent).not.toContain("Paste Mermaid");
    expect(gallery).not.toContain("Dashboard");
    expect(builtinCommands.some((command) => command.title === "Paste Mermaid")).toBe(true);
  });

  it("does not wrap the settings actions at desktop width", () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");
    const rule = css.slice(css.indexOf(".reference-top-actions,"), css.indexOf(".reference-body"));
    expect(rule).toContain("flex-wrap: nowrap");
    expect(rule).toContain("flex-shrink: 0");
    const narrow = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(narrow).toContain(".reference-top-actions");
    expect(narrow).toContain("flex-wrap: wrap");
    const healthNarrow = css.slice(css.indexOf("@media (max-width: 960px)"));
    expect(healthNarrow).toContain(".health-page ~ .narrow-app-bar");
    expect(healthNarrow).toContain("display: none");
  });
});
