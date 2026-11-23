/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderTree } from "../src/components/FolderTree";
import { COLLAPSED_FOLDERS_KEY } from "../src/lib/folderTreeState";
import type { TreeNode } from "../src/types";

function folder(path: string, children: TreeNode[] = []): TreeNode {
  const name = path.split("/").pop() ?? path;
  return { name, path, type: "folder", mtimeMs: 0, children };
}

const tree: TreeNode[] = [
  folder("Field Sites", [
    folder("Field Sites/MTJ", [folder("Field Sites/MTJ/Racks")]),
    folder("Field Sites/Other"),
  ]),
  folder("Sites", [folder("Sites/Atlanta")]),
  folder("Loose"),
];

describe("sidebar folder tree", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const selected: string[] = [];

  beforeEach(() => {
    localStorage.clear();
    selected.length = 0;
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
    localStorage.clear();
  });

  async function render(currentPath = "") {
    await act(async () => {
      root?.render(
        createElement(FolderTree, {
          nodes: tree,
          currentPath,
          onSelectFolder: (path: string) => {
            selected.push(path);
          },
        }),
      );
    });
  }

  function toggle(path: string): HTMLButtonElement {
    const element = document.querySelector(`[data-testid="folder-toggle-${CSS.escape(path)}"]`);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`missing toggle ${path}`);
    return element;
  }

  async function renderNodes(nodes: TreeNode[], extras: { onNewFolder?: () => void } = {}) {
    await act(async () => {
      root?.render(
        createElement(FolderTree, {
          nodes,
          currentPath: "",
          onSelectFolder: (path: string) => {
            selected.push(path);
          },
          onNewFolder: extras.onNewFolder,
        }),
      );
    });
  }

  it("hides the tree and the header when there are no folders, and brings them back", async () => {
    await renderNodes([]);
    expect(document.querySelector(".tree")).toBeNull();
    expect(document.querySelector("#folders-heading")).toBeNull();
    expect(document.querySelector(".folders-section")).toBeNull();

    await renderNodes([folder("Sites")]);
    expect(document.querySelector("#folders-heading")).toBeTruthy();
    expect(document.querySelector(".folders-count")?.textContent).toBe("1");
    expect(document.querySelector(".tree")).toBeTruthy();

    await renderNodes([]);
    expect(document.querySelector(".tree")).toBeNull();
    expect(document.querySelector("#folders-heading")).toBeNull();
  });

  it("remembers a collapsed folder section and offers New folder", async () => {
    const created: string[] = [];
    await renderNodes([folder("Sites"), folder("Examples")], {
      onNewFolder: () => created.push("new"),
    });
    expect(document.querySelector(".folders-count")?.textContent).toBe("2");
    const caret = document.querySelector(".folders-head .tree-chevron");
    expect(caret?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      if (caret instanceof HTMLButtonElement) caret.click();
    });
    expect(document.querySelector(".tree")).toBeNull();
    expect(localStorage.getItem("nerdgram.sidebar.foldersOpen")).toBe("0");
    const add = document.querySelector(".folders-add");
    expect(add?.getAttribute("aria-label")).toBe("New folder");
    await act(async () => {
      if (add instanceof HTMLButtonElement) add.click();
    });
    expect(created).toEqual(["new"]);

    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container!);
    await renderNodes([folder("Sites")]);
    expect(document.querySelector(".tree")).toBeNull();
    expect(document.querySelector(".folders-head .tree-chevron")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles a folder with the chevron and leaves the name as the folder opener", async () => {
    await render();
    const heading = document.querySelector(".tree");
    expect(heading?.getAttribute("aria-labelledby")).toBe("folders-heading");
    expect(document.querySelector("#folders-heading")?.textContent).toContain("Folders");
    expect(document.querySelector(".folders-count")?.textContent).toBe("7");
    expect(document.querySelector(".nav-label")).toBeNull();
    const firstFolder = document.querySelector(".tree-level");
    expect(heading?.contains(firstFolder as Node)).toBe(true);
    expect(toggle("Field Sites").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-testid="folder-link-Field Sites/MTJ"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="folder-toggle-Loose"]')).toBeNull();
    expect(document.querySelectorAll(".tree-chevron-spacer").length).toBeGreaterThan(0);

    await act(async () => {
      toggle("Field Sites").click();
    });
    expect(toggle("Field Sites").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-testid="folder-link-Field Sites/MTJ"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) ?? "[]")).toContain("Field Sites");

    const name = document.querySelector('[data-testid="folder-link-Field Sites"]');
    if (!(name instanceof HTMLButtonElement)) throw new Error("folder name missing");
    expect(name.getAttribute("title")).toBe("Field Sites");
    expect(name.querySelector(".tree-label")?.textContent).toBe("Field Sites");
    await act(async () => {
      name.click();
    });
    expect(selected).toEqual(["Field Sites"]);
    expect(toggle("Field Sites").getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      toggle("Field Sites").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(toggle("Field Sites").getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      toggle("Field Sites").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(toggle("Field Sites").getAttribute("aria-expanded")).toBe("false");
  });

  it("remembers collapsed folders across a reload", async () => {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(["Sites"]));
    await render();
    expect(document.querySelector('[data-testid="folder-link-Sites/Atlanta"]')).toBeNull();
    expect(toggle("Sites").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-testid="folder-link-Field Sites/MTJ"]')).not.toBeNull();
  });

  it("collapse all keeps the active path open and expand all opens every folder", async () => {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(["Field Sites", "Field Sites/MTJ"]));
    await render("Field Sites/MTJ/Racks");
    expect(toggle("Field Sites").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("Field Sites/MTJ").getAttribute("aria-expanded")).toBe("true");
    const active = document.querySelector('[data-testid="folder-link-Field Sites/MTJ/Racks"]');
    expect(active?.className).toContain("active");
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) ?? "[]") as string[];
    expect(stored).not.toContain("Field Sites");
    expect(stored).not.toContain("Field Sites/MTJ");

    const collapse = [...document.querySelectorAll("button")].find((button) => button.textContent === "Collapse all");
    if (!(collapse instanceof HTMLButtonElement)) throw new Error("Collapse all missing");
    await act(async () => {
      collapse.click();
    });
    expect(document.querySelector('[data-testid="folder-link-Sites/Atlanta"]')).toBeNull();
    expect(document.querySelector('[data-testid="folder-link-Field Sites/MTJ/Racks"]')).not.toBeNull();
    expect(toggle("Field Sites").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("Sites").getAttribute("aria-expanded")).toBe("false");

    const expand = [...document.querySelectorAll("button")].find((button) => button.textContent === "Expand all");
    if (!(expand instanceof HTMLButtonElement)) throw new Error("Expand all missing");
    expect(expand.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => {
      expand.click();
    });
    expect(toggle("Sites").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-testid="folder-link-Sites/Atlanta"]')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) ?? "[]")).toEqual([]);
    expect(expand.getAttribute("aria-disabled")).toBe("true");
  });
});
