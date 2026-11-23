/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderTree } from "../src/components/FolderTree";
import { Sidebar } from "../src/components/Sidebar";
import { useWorkspace } from "../src/hooks/useWorkspace";
import { EMPTY_BOOKMARKS } from "../src/lib/bookmarks";
import type { TreeNode } from "../src/types";

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      tree: vi.fn(async () => {
        throw new Error("Could not read the folder list");
      }),
      bookmarks: vi.fn(async () => ({ folders: [], items: [] })),
    },
  };
});

function LoadedTree() {
  const { tree, error } = useWorkspace();
  return (
    <>
      <p className="load-error">{error}</p>
      <div className="sidebar-split" role="separator" />
      <FolderTree nodes={tree} currentPath="" onSelectFolder={() => undefined} />
    </>
  );
}

describe("empty and failed folder lists", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("draws no tree and no header when the folder list fails", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <LoadedTree />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector(".load-error")?.textContent).toContain("Could not read the folder list");
    expect(document.querySelector(".tree")).toBeNull();
    expect(document.querySelector("#folders-heading")).toBeNull();
    expect(document.querySelector(".sidebar-split")).toBeTruthy();
  });

  it("shows the header and count when folders exist, and keeps the divider with none", () => {
    const folders: TreeNode[] = [
      { name: "Examples", path: "Examples", type: "folder", mtimeMs: 0, children: [] },
      { name: "Sites", path: "Sites", type: "folder", mtimeMs: 0, children: [] },
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const sidebar = (tree: TreeNode[]) => (
      <MemoryRouter>
        <Sidebar
          tree={tree}
          bookmarks={EMPTY_BOOKMARKS}
          onBookmarks={() => undefined}
          knownPaths={new Set()}
          recent={[]}
          onClearRecent={() => undefined}
          attentionCount={null}
          currentFolder=""
          search=""
          onSearch={() => undefined}
          onSelectFolder={() => undefined}
        />
      </MemoryRouter>
    );
    act(() => {
      root?.render(sidebar([]));
    });
    expect(document.querySelector(".sidebar-split")).toBeTruthy();
    expect(document.querySelector(".tree")).toBeNull();
    expect(document.querySelector("#folders-heading")).toBeNull();
    act(() => {
      root?.render(sidebar(folders));
    });
    expect(document.querySelector(".sidebar-split")).toBeTruthy();
    expect(document.querySelector("#folders-heading .folders-word")?.textContent).toBe("Folders");
    expect(document.querySelector(".folders-count")?.textContent).toBe("2");
    expect(document.querySelector(".tree")?.getAttribute("aria-labelledby")).toBe("folders-heading");
  });
});
