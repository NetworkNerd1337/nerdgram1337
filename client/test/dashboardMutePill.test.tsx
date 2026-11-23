/**
 * @vitest-environment happy-dom
 */
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaletteContext } from "../src/components/commandPaletteContext";
import { ProblemsPanel } from "../src/components/ProblemsPanel";
import { UpdateContext, type UpdateContextValue } from "../src/components/updateContext";
import { DashboardPage } from "../src/pages/DashboardPage";
import { clearThumbnailMemory } from "../src/lib/thumbnailCache";
import type { ReportedDiagnostic } from "../src/lib/mermaidLint";
import type { UpdateStatus } from "../src/types";

const summaryState = vi.hoisted(() => ({
  current: {
    status: "ready" as const,
    checkedAt: "2026-11-19T18:00:00.000Z",
    stale: false,
    checked: 2,
    errors: 0,
    warnings: 0,
    unreadable: 0,
    muted: 1,
    diagrams: [] as { path: string; errors: number; warnings: number; parse: boolean; muted: boolean }[],
  },
}));

const tree = vi.hoisted(() => vi.fn());
const bookmarks = vi.hoisted(() => vi.fn());
const trash = vi.hoisted(() => vi.fn());
const diagramMeta = vi.hoisted(() => vi.fn());
const tags = vi.hoisted(() => vi.fn());
const diagramLintSummary = vi.hoisted(() => vi.fn());
const thumbnail = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const saveThumbnail = vi.hoisted(() => vi.fn());
const renderMermaid = vi.hoisted(() => vi.fn());

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      tree,
      bookmarks,
      trash,
      diagramMeta,
      tags,
      diagramLintSummary,
      thumbnail,
      readFile,
      saveThumbnail,
    },
  };
});

vi.mock("../src/lib/mermaidRender", () => ({
  renderMermaid,
}));

const warning: ReportedDiagnostic = {
  ruleId: "unused-class",
  severity: "warning",
  message: "Class spare is unused",
  from: 0,
  to: 1,
  line: 2,
  column: 1,
  fixes: [],
};

function loudSummary() {
  return {
    status: "ready" as const,
    checkedAt: "2026-11-19T18:05:00.000Z",
    stale: false,
    checked: 2,
    errors: 0,
    warnings: 4,
    unreadable: 0,
    muted: 0,
    diagrams: [{ path: "Wan.mmd", errors: 0, warnings: 4, parse: false, muted: false }],
  };
}

function mutedSummary() {
  return {
    status: "ready" as const,
    checkedAt: "2026-11-19T18:00:00.000Z",
    stale: false,
    checked: 2,
    errors: 0,
    warnings: 0,
    unreadable: 0,
    muted: 1,
    diagrams: [] as { path: string; errors: number; warnings: number; parse: boolean; muted: boolean }[],
  };
}

function EditorMute({ muted, onMuted }: { muted: boolean; onMuted: (muted: boolean) => void }) {
  return (
    <div>
      <ProblemsPanel
        diagnostics={muted ? [] : [warning, warning, warning, warning]}
        warningsMuted={muted}
        onToggleWarnings={() => onMuted(!muted)}
        onSelect={() => undefined}
        onFix={() => undefined}
      />
      <Link to="/">Back to dashboard</Link>
    </div>
  );
}

const updateStatus: UpdateStatus = {
  enabled: false,
  automatic: false,
  includePrerelease: false,
  installKind: "git",
  currentVersion: "2.1.5",
  codename: "Azimuth",
  commit: null,
  phase: "disabled",
  updateAvailable: false,
  skipped: false,
  dismissed: false,
  skippedVersions: [],
  latest: null,
  checkedAt: null,
  error: null,
  canApply: false,
  matchesLatest: true,
  docker: null,
};

const updates: UpdateContextValue = {
  status: updateStatus,
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
};

function Harness({ muted, onMuted }: { muted: boolean; onMuted: (muted: boolean) => void }) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <UpdateContext.Provider value={updates}>
        <PaletteContext.Provider value={{ setHost: () => undefined, openPalette: () => undefined }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/edit/*" element={<EditorMute muted={muted} onMuted={onMuted} />} />
          </Routes>
        </PaletteContext.Provider>
      </UpdateContext.Provider>
    </MemoryRouter>
  );
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function clickText(selector: string, text: string): void {
  const node = [...document.querySelectorAll(selector)].find((item) => item.textContent?.trim() === text);
  if (!(node instanceof HTMLElement)) throw new Error(`missing ${text}`);
  node.click();
}

describe("dashboard warning pill follows the editor mute toggle", () => {
  let root: Root | null = null;
  let muted = true;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", undefined);
    clearThumbnailMemory();
    muted = true;
    summaryState.current = mutedSummary();
    tree.mockReset();
    bookmarks.mockReset();
    trash.mockReset();
    diagramMeta.mockReset();
    tags.mockReset();
    diagramLintSummary.mockReset();
    thumbnail.mockReset();
    readFile.mockReset();
    saveThumbnail.mockReset();
    renderMermaid.mockReset();
    tree.mockResolvedValue({
      tree: [
        { name: "Wan.mmd", path: "Wan.mmd", type: "file", mtimeMs: 10, size: 80 },
        { name: "Clean.mmd", path: "Clean.mmd", type: "file", mtimeMs: 11, size: 40 },
      ],
    });
    bookmarks.mockResolvedValue({ folders: [], items: [] });
    trash.mockResolvedValue({ items: [] });
    diagramMeta.mockResolvedValue({ diagrams: [] });
    tags.mockResolvedValue({ tags: [] });
    diagramLintSummary.mockImplementation(() => Promise.resolve(summaryState.current));
    thumbnail.mockResolvedValue({ hit: false, path: "Wan.mmd", cacheKey: "k", mtimeMs: 10 });
    readFile.mockResolvedValue({
      path: "Wan.mmd",
      name: "Wan.mmd",
      content: "flowchart LR\n  A[One]\n",
      mtimeMs: 10,
      size: 20,
      hash: "abc",
    });
    saveThumbnail.mockResolvedValue({});
    renderMermaid.mockResolvedValue({ svg: "<svg></svg>", id: "ok" });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    clearThumbnailMemory();
  });

  function render(): void {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const draw = () => {
      root?.render(
        <Harness
          muted={muted}
          onMuted={(next) => {
            muted = next;
            summaryState.current = next ? mutedSummary() : loudSummary();
            draw();
          }}
        />,
      );
    };
    act(() => {
      draw();
    });
  }

  it("shows the yellow pill in grid and list after unmute, and hides it after mute", async () => {
    render();
    await flush();
    expect(document.body.textContent).toContain("Wan");
    expect(document.querySelector(".diagram-card-health")).toBeNull();
    expect(document.querySelector(".attention-badge")).toBeNull();
    expect(document.querySelector('a[href="/health"]')?.getAttribute("aria-label")).toBe("Diagram health");
    expect(document.querySelector(".card.is-health-warning")).toBeNull();

    await act(async () => {
      clickText('a[href="/edit/Wan.mmd"]', "Wan");
    });
    await flush();
    expect(document.body.textContent).toContain("Unmute");

    await act(async () => {
      clickText("button", "Unmute");
    });
    expect(document.body.textContent).toContain("Mute warnings");
    expect(document.body.textContent).toContain("4 warnings");

    await act(async () => {
      clickText('a[href="/"]', "Back to dashboard");
    });
    await flush();

    const gridPill = document.querySelector(".card.is-health-warning .diagram-card-health");
    expect(gridPill?.textContent).toBe("4 warnings");
    expect(gridPill?.className).toContain("is-warning");
    expect(document.querySelectorAll(".card.is-health-warning")).toHaveLength(1);
    expect(document.querySelector(".attention-badge")?.textContent).toContain("(1)");
    expect(document.querySelector(".attention-badge")?.textContent).not.toContain("4");
    expect(document.querySelector('a[href="/health"]')?.getAttribute("aria-label")).toBe("Diagram health, 1 issue");
    const cards = [...document.querySelectorAll(".card")];
    const clean = cards.find((card) => card.textContent?.includes("Clean"));
    expect(clean?.querySelector(".diagram-card-health")).toBeNull();

    await act(async () => {
      clickText(".view-toggle button", "List");
    });
    const listPill = document.querySelector(".list-row.is-health-warning .diagram-card-health");
    expect(listPill?.textContent).toBe("4 warnings");
    expect(document.querySelectorAll(".list-row.is-health-warning")).toHaveLength(1);

    await act(async () => {
      clickText(".view-toggle button", "Grid");
    });
    expect(document.querySelector(".card.is-health-warning .diagram-card-health")?.textContent).toBe("4 warnings");

    await act(async () => {
      clickText('a[href="/edit/Wan.mmd"]', "Wan");
    });
    await flush();
    await act(async () => {
      clickText("button", "Mute warnings");
    });
    await act(async () => {
      clickText('a[href="/"]', "Back to dashboard");
    });
    await flush();
    expect(document.querySelector(".diagram-card-health")).toBeNull();
    expect(document.querySelector(".is-health-warning")).toBeNull();
    expect(document.querySelector(".attention-badge")).toBeNull();
    expect(document.querySelector('a[href="/health"]')?.getAttribute("aria-label")).toBe("Diagram health");
    expect(document.body.textContent).toContain("Clean");
  });
});
