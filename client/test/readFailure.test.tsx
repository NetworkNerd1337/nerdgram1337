/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api";
import { MermaidThumbnail } from "../src/components/MermaidThumbnail";
import { EditorPage } from "../src/pages/EditorPage";
import { clearThumbnailMemory } from "../src/lib/thumbnailCache";

const thumbnail = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const saveThumbnail = vi.hoisted(() => vi.fn());
const tree = vi.hoisted(() => vi.fn());
const diagramLinks = vi.hoisted(() => vi.fn());
const acquireLock = vi.hoisted(() => vi.fn());
const heartbeatLock = vi.hoisted(() => vi.fn());
const releaseLock = vi.hoisted(() => vi.fn());
const pollLock = vi.hoisted(() => vi.fn());
const writeFile = vi.hoisted(() => vi.fn());
const takeoverLock = vi.hoisted(() => vi.fn());
const renderMermaid = vi.hoisted(() => vi.fn());

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: {
      thumbnail,
      readFile,
      saveThumbnail,
      tree,
      diagramLinks,
      acquireLock,
      heartbeatLock,
      releaseLock,
      pollLock,
      writeFile,
      takeoverLock,
      listExporters: vi.fn(async () => ({ exporters: [] })),
    },
  };
});

vi.mock("../src/lib/mermaidRender", () => ({
  renderMermaid,
}));

vi.mock("../src/lib/exportDiagram", () => ({
  exportDiagram: vi.fn(),
}));

vi.mock("../src/components/CommandPalette", () => ({
  CommandsButton: () => <button type="button">Commands</button>,
}));

vi.mock("../src/components/MermaidCodeEditor", () => ({
  MermaidCodeEditor: () => <textarea aria-label="Mermaid source editor" />,
}));

const EIO_MESSAGE =
  "Couldn't read `Network topology.mmd`. The file may still be syncing or the folder may be unavailable on this computer (EIO).";

function unreadableError(): ApiError {
  return new ApiError(500, {
    error: EIO_MESSAGE,
    code: "unreadable",
    errno: "EIO",
  });
}

const readable = {
  path: "Network topology.mmd",
  name: "Network topology.mmd",
  content: "flowchart LR\n  A[Core] --> B[Edge]\n",
  mtimeMs: 10,
  size: 20,
  hash: "abc",
};

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

describe("dashboard card read errors", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", undefined);
    clearThumbnailMemory();
    thumbnail.mockReset();
    readFile.mockReset();
    saveThumbnail.mockReset();
    renderMermaid.mockReset();
    saveThumbnail.mockResolvedValue({});
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    clearThumbnailMemory();
  });

  function renderCard(): void {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <MemoryRouter>
          <MermaidThumbnail path="Network topology.mmd" mtimeMs={10} />
        </MemoryRouter>,
      );
    });
  }

  it("shows Can't read file, not Parse error, and Retry reads again", async () => {
    thumbnail.mockRejectedValueOnce(unreadableError()).mockResolvedValueOnce({ hit: false, path: "Network topology.mmd" });
    readFile.mockResolvedValue(readable);
    renderMermaid.mockResolvedValue({ svg: "<svg id=\"ok\"></svg>", id: "ok" });

    renderCard();
    await settle();
    await settle();

    expect(document.body.textContent).toContain("Can't read file");
    expect(document.body.textContent).toContain("still be syncing");
    expect(document.body.textContent).toContain("(EIO)");
    expect(document.body.textContent).not.toContain("Parse error");
    expect(document.body.textContent).not.toMatch(/i\/o error/i);
    expect(document.body.textContent).not.toContain("Ryan's laptop");
    expect(host?.querySelector("[data-status]")?.getAttribute("data-status")).toBe("unreadable");
    expect(readFile).not.toHaveBeenCalled();

    const retry = [...(host?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Retry");
    expect(retry).toBeTruthy();
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    await settle();

    expect(thumbnail).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenCalledWith("Network topology.mmd");
    expect(document.body.textContent).not.toContain("Can't read file");
    expect(document.body.textContent).not.toContain("Parse error");
    expect(host?.querySelector("img")).toBeTruthy();
  });

  it("keeps Parse error when the file was read and Mermaid cannot draw it", async () => {
    thumbnail.mockResolvedValue({ hit: false, path: "Network topology.mmd" });
    readFile.mockResolvedValue({ ...readable, content: "flowchart LR\n  A -->\n" });
    renderMermaid.mockRejectedValue(new Error("Parse error on line 2"));

    renderCard();
    await settle();
    await settle();

    expect(document.body.textContent).toContain("Parse error");
    expect(document.body.textContent).toContain("Preview unavailable");
    expect(document.body.textContent).not.toContain("Can't read file");
    expect(host?.querySelector("button")).toBeNull();
  });

  it("shows Can't read file when the thumbnail misses and the file read fails", async () => {
    thumbnail.mockResolvedValue({ hit: false, path: "Network topology.mmd" });
    readFile.mockRejectedValue(unreadableError());

    renderCard();
    await settle();
    await settle();

    expect(document.body.textContent).toContain("Can't read file");
    expect(document.body.textContent).not.toContain("Parse error");
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});

describe("editor read errors", () => {
  beforeEach(() => {
    sessionStorage.clear();
    readFile.mockReset();
    acquireLock.mockReset();
    heartbeatLock.mockReset();
    releaseLock.mockReset();
    pollLock.mockReset();
    tree.mockReset();
    diagramLinks.mockReset();
    tree.mockResolvedValue({ tree: [] });
    diagramLinks.mockResolvedValue({ path: "Network topology.mmd", linksTo: [], linkedFrom: [] });
    releaseLock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    document.body.innerHTML = "";
  });

  function renderEditor(): void {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <MemoryRouter initialEntries={["/edit/Network%20topology.mmd"]}>
          <Routes>
            <Route path="/edit/*" element={<EditorPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  it("shows Can't read file with Retry and no lock holder", async () => {
    readFile.mockRejectedValueOnce(unreadableError()).mockResolvedValueOnce(readable);
    acquireLock.mockResolvedValue({
      path: "Network topology.mmd",
      token: "tok",
      sessionId: "session",
      heartbeatAt: "2026-11-17T00:00:00.000Z",
      acquiredAt: "2026-11-17T00:00:00.000Z",
      heartbeatEveryMs: 15000,
      staleAfterMs: 90000,
    });

    renderEditor();
    await settle();
    await settle();

    const banner = host?.querySelector("[data-testid='cant-read-file']");
    expect(banner?.textContent).toContain("Can't read file");
    expect(banner?.textContent).toContain("still be syncing");
    expect(banner?.textContent).not.toContain("Ryan's laptop");
    expect(banner?.textContent).not.toContain("macbook");
    expect(host?.querySelector("[data-testid='instance-lock-alert']")).toBeNull();
    expect(document.body.textContent).not.toContain("Parse error");

    const retry = [...(banner?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Retry");
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    await settle();

    expect(readFile).toHaveBeenCalledTimes(2);
    expect(host?.querySelector("[data-testid='cant-read-file']")).toBeNull();
    expect(acquireLock).toHaveBeenCalled();
  });

  it("shows the lock holder only when the file was read and the lock is 423", async () => {
    readFile.mockResolvedValue(readable);
    acquireLock.mockRejectedValue(
      new ApiError(423, {
        error: "This diagram is open in another window.",
        code: "locked",
        lock: {
          acquiredAt: "2026-11-17T01:00:00.000Z",
          heartbeatAt: "2026-11-17T01:00:00.000Z",
          staleAfterMs: 90000,
          instanceId: "other",
          instanceName: "Ryan's laptop",
          hostname: "macbook",
          sameInstance: false,
        },
      }),
    );

    renderEditor();
    await settle();
    await settle();

    expect(host?.querySelector("[data-testid='cant-read-file']")).toBeNull();
    const alert = host?.querySelector("[data-testid='instance-lock-alert']");
    expect(alert?.textContent).toContain("Ryan's laptop");
    expect(alert?.textContent).toContain("macbook");
    expect(document.body.textContent).not.toContain("Can't read file");
  });

  it("a heartbeat 423 goes read-only and does not acquire the lock again", async () => {
    readFile.mockResolvedValue(readable);
    acquireLock.mockResolvedValue({
      path: "Network topology.mmd",
      token: "tok",
      sessionId: "session",
      heartbeatAt: "2026-11-17T00:00:00.000Z",
      acquiredAt: "2026-11-17T00:00:00.000Z",
      heartbeatEveryMs: 30,
      staleAfterMs: 90000,
    });
    heartbeatLock.mockRejectedValue(new ApiError(423, { error: "The editor lock is no longer held by this window.", code: "locked" }));
    pollLock.mockResolvedValue({ held: true, error: "held", code: "locked" });

    renderEditor();
    await settle();
    await settle();
    expect(acquireLock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(heartbeatLock).toHaveBeenCalled();
    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Another window took over this diagram. Autosave has stopped.");
  });
});
