/**
 * @vitest-environment happy-dom
 */
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaletteContext } from "../src/components/commandPaletteContext";
import { ConfirmDialog } from "../src/components/ConfirmDialog";
import { confirmChoice } from "../src/lib/confirmChoice";
import { DashboardPage } from "../src/pages/DashboardPage";
import { requestUpdateReload } from "../src/lib/updateReload";

const tree = vi.hoisted(() => vi.fn());
const bookmarks = vi.hoisted(() => vi.fn());
const trash = vi.hoisted(() => vi.fn());
const diagramMeta = vi.hoisted(() => vi.fn());
const tags = vi.hoisted(() => vi.fn());
const diagramLintSummary = vi.hoisted(() => vi.fn());
const thumbnail = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());

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
      delete: remove,
    },
  };
});

vi.mock("../src/lib/mermaidRender", () => ({
  renderMermaid: async () => ({ svg: "<svg></svg>", id: "ok" }),
}));

function key(name: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

describe("themed confirm dialog", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    document.body.innerHTML = "";
  });

  it("cancels on Escape, confirms on Enter, traps focus, and uses danger styling", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await act(async () => {
      root?.render(
        <ConfirmDialog
          title="Move to trash"
          message={'Move "Purdue model" to the trash? You can restore it later.'}
          confirmLabel="Move to trash"
          danger
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );
    });
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.body.textContent).toContain('Move "Purdue model" to the trash? You can restore it later.');
    const accept = document.querySelector("[data-confirm-accept]");
    const cancel = document.querySelector("[data-confirm-cancel]");
    expect(accept?.className).toContain("btn-danger");
    expect(accept?.className).not.toContain("btn-primary");
    expect(document.activeElement).toBe(accept);

    await act(async () => {
      key("Tab");
    });
    expect(document.activeElement).toBe(cancel);
    await act(async () => {
      key("Tab");
    });
    expect(document.activeElement).toBe(accept);

    await act(async () => {
      key("Escape");
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => {
      key("Enter");
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("keeps a reload warning on the primary button", async () => {
    await act(async () => {
      root?.render(
        <ConfirmDialog
          title="Reload now?"
          message="This diagram has unsaved edits. Reloading can discard them. Reload now?"
          confirmLabel="Reload"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
    });
    const accept = document.querySelector("[data-confirm-accept]");
    expect(accept?.className).toContain("btn-primary");
    expect(accept?.className).not.toContain("btn-danger");
  });
});

describe("dashboard delete uses the themed confirm", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", undefined);
    tree.mockReset();
    bookmarks.mockReset();
    trash.mockReset();
    diagramMeta.mockReset();
    tags.mockReset();
    diagramLintSummary.mockReset();
    thumbnail.mockReset();
    readFile.mockReset();
    remove.mockReset();
    tree.mockResolvedValue({
      tree: [{ name: "Purdue model.mmd", path: "Purdue model.mmd", type: "file", mtimeMs: 10, size: 40 }],
    });
    bookmarks.mockResolvedValue({ folders: [], items: [] });
    trash.mockResolvedValue({ items: [] });
    diagramMeta.mockResolvedValue({ diagrams: [] });
    tags.mockResolvedValue({ tags: [] });
    diagramLintSummary.mockResolvedValue({
      status: "ready",
      checkedAt: null,
      stale: false,
      checked: 0,
      errors: 0,
      warnings: 0,
      unreadable: 0,
      muted: 0,
      diagrams: [],
    });
    thumbnail.mockResolvedValue({ hit: false, path: "Purdue model.mmd", cacheKey: "k", mtimeMs: 10 });
    readFile.mockResolvedValue({
      path: "Purdue model.mmd",
      name: "Purdue model.mmd",
      content: "flowchart LR\n  A\n",
      mtimeMs: 10,
      size: 12,
      hash: "abc",
    });
    remove.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  it("moves a diagram to the trash only after the danger confirm", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PaletteContext.Provider value={{ setHost: () => undefined, openPalette: () => undefined }}>
            <DashboardPage />
          </PaletteContext.Provider>
        </MemoryRouter>,
      );
    });
    await flush();
    const removeButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Delete");
    expect(removeButton).toBeTruthy();
    await act(async () => {
      removeButton?.click();
    });
    await flush();
    expect(document.body.textContent).toContain('Move "Purdue model" to the trash? You can restore it later.');
    expect(document.querySelector("[data-confirm-accept]")?.className).toContain("btn-danger");
    const cancel = document.querySelector("[data-confirm-cancel]");
    await act(async () => {
      (cancel as HTMLButtonElement).click();
    });
    await flush();
    expect(remove).not.toHaveBeenCalled();

    const again = [...document.querySelectorAll("button")].find((button) => button.textContent === "Delete");
    await act(async () => {
      again?.click();
    });
    await flush();
    await act(async () => {
      key("Enter");
    });
    await flush();
    expect(remove).toHaveBeenCalled();
  });
});

describe("update reload confirm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete document.body.dataset.unsaved;
    vi.restoreAllMocks();
  });

  it("stays on the page when the reload warning is cancelled", async () => {
    document.body.dataset.unsaved = "true";
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);
    const pending = requestUpdateReload();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Reload now?");
    expect(document.querySelector("[data-confirm-accept]")?.className).toContain("btn-primary");
    await act(async () => {
      key("Escape");
    });
    await pending;
    expect(reload).not.toHaveBeenCalled();

    const again = requestUpdateReload();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      key("Enter");
    });
    await again;
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("confirmChoice resolves the click", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns false when Cancel is clicked", async () => {
    const pending = confirmChoice({ title: "Empty trash", message: "Empty the trash? This permanently deletes everything in it.", danger: true });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      (document.querySelector("[data-confirm-cancel]") as HTMLButtonElement).click();
    });
    await expect(pending).resolves.toBe(false);
  });
});
