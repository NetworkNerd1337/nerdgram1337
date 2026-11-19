/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BookmarksSection } from "../src/components/BookmarksSection";
import { BOOKMARK_FOLDER_MIME } from "../src/lib/bookmarkDrag";
import { BOOKMARK_FOLDERS_KEY, normalizeBookmarks, type BookmarkState } from "../src/lib/bookmarks";

const state: BookmarkState = {
  folders: [{ id: "f1", name: "Sites", parentId: null }],
  items: [{ path: "Field Sites/Palo Alto SD-WAN.mmd", folderId: null }],
};

function mount(current: BookmarkState, onChange: (next: BookmarkState) => void = () => undefined) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter>
        <BookmarksSection
          state={current}
          knownPaths={new Set(current.items.map((item) => item.path))}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
  });
  return root;
}

function transfer(path: string) {
  const data = new Map<string, string>([["text/bookmark-path", path]]);
  return {
    types: ["text/bookmark-path"],
    setData(type: string, value: string) {
      data.set(type, value);
    },
    getData(type: string) {
      return data.get(type) ?? "";
    },
    effectAllowed: "move" as const,
    dropEffect: "move",
  };
}

function fire(target: Element, type: string, path: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer(path) });
  act(() => {
    target.dispatchEvent(event);
  });
}

function folderOf(next: BookmarkState, path: string) {
  return next.items.find((item) => item.path === path)?.folderId ?? null;
}

describe("bookmark rows", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("keeps the name readable and reaches every action from the keyboard", () => {
    root = mount(state);

    const label = document.querySelector(".sidebar-row-label");
    expect(label?.textContent).toContain("Palo Alto SD-WAN");
    expect(label?.getAttribute("title")).toContain("Palo Alto SD-WAN.mmd");
    expect(document.body.textContent).not.toContain("Remove");

    const actions = document.querySelector<HTMLButtonElement>("button[aria-label='Actions for Palo Alto SD-WAN']");
    expect(actions?.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      actions?.click();
    });
    expect(actions?.getAttribute("aria-expanded")).toBe("true");
    for (const name of ["Move Palo Alto SD-WAN up", "Move Palo Alto SD-WAN down", "Folder for Palo Alto SD-WAN", "Remove bookmark Palo Alto SD-WAN"]) {
      expect(document.querySelector(`[aria-label='${name}']`)).toBeTruthy();
    }
  });

  it("drops a top-level bookmark into a folder and does not bubble back to the top level", () => {
    const calls: BookmarkState[] = [];
    const current: BookmarkState = {
      folders: [{ id: "lab", name: "Lab", parentId: null }],
      items: [{ path: "WAN.mmd", folderId: null }],
    };
    root = mount(current, (next) => calls.push(next));
    const folder = document.querySelector("[data-folder-id='lab']");
    expect(folder).toBeTruthy();
    fire(folder as Element, "drop", "WAN.mmd");
    expect(calls.length).toBe(1);
    expect(folderOf(calls[0] as BookmarkState, "WAN.mmd")).toBe("lab");
  });

  it("drops a bookmark from a folder onto the top level", () => {
    const calls: BookmarkState[] = [];
    const current: BookmarkState = {
      folders: [{ id: "lab", name: "Lab", parentId: null }],
      items: [{ path: "WAN.mmd", folderId: "lab" }],
    };
    root = mount(current, (next) => calls.push(next));
    fire(document.getElementById("bookmark-list") as Element, "drop", "WAN.mmd");
    expect(folderOf(calls.at(-1) as BookmarkState, "WAN.mmd")).toBeNull();
  });

  it("drops a bookmark from one folder onto another", () => {
    const calls: BookmarkState[] = [];
    const current: BookmarkState = {
      folders: [
        { id: "lab", name: "Lab", parentId: null },
        { id: "sites", name: "Sites", parentId: null },
      ],
      items: [{ path: "WAN.mmd", folderId: "lab" }],
    };
    root = mount(current, (next) => calls.push(next));
    fire(document.querySelector("[data-folder-id='sites']") as Element, "drop", "WAN.mmd");
    expect(folderOf(calls.at(-1) as BookmarkState, "WAN.mmd")).toBe("sites");
  });

  it("reorders bookmarks inside a folder and shows an insertion line", () => {
    const calls: BookmarkState[] = [];
    const current: BookmarkState = {
      folders: [{ id: "lab", name: "Lab", parentId: null }],
      items: [
        { path: "A.mmd", folderId: "lab" },
        { path: "B.mmd", folderId: "lab" },
      ],
    };
    root = mount(current, (next) => calls.push(next));
    const first = document.querySelector("[data-bookmark-path='A.mmd']") as Element;
    fire(first, "dragover", "B.mmd");
    expect(document.querySelector(".bookmark-insert")).toBeTruthy();
    fire(first, "drop", "B.mmd");
    const order = (calls.at(-1) as BookmarkState).items
      .filter((item) => item.folderId === "lab")
      .map((item) => item.path);
    expect(order).toEqual(["B.mmd", "A.mmd"]);
  });

  it("chooses a position when dropping into another folder", () => {
    const calls: BookmarkState[] = [];
    const current: BookmarkState = {
      folders: [
        { id: "lab", name: "Lab", parentId: null },
        { id: "sites", name: "Sites", parentId: null },
      ],
      items: [
        { path: "A.mmd", folderId: "sites" },
        { path: "B.mmd", folderId: "sites" },
        { path: "C.mmd", folderId: "lab" },
      ],
    };
    root = mount(current, (next) => calls.push(next));
    fire(document.querySelector("[data-bookmark-path='B.mmd']") as Element, "drop", "C.mmd");
    const sites = (calls.at(-1) as BookmarkState).items
      .filter((item) => item.folderId === "sites")
      .map((item) => item.path);
    expect(sites).toEqual(["A.mmd", "C.mmd", "B.mmd"]);
  });

  it("keeps an empty collapsed folder as a drop target and enlarges zones while dragging", () => {
    localStorage.setItem(BOOKMARK_FOLDERS_KEY, JSON.stringify(["empty"]));
    const calls: BookmarkState[] = [];
    const current: BookmarkState = {
      folders: [
        { id: "empty", name: "Empty", parentId: null },
        { id: "open", name: "Open", parentId: null },
      ],
      items: [{ path: "WAN.mmd", folderId: null }],
    };
    root = mount(current, (next) => calls.push(next));
    const empty = document.querySelector("[data-folder-id='empty']") as HTMLElement;
    expect(empty.querySelector("[data-bookmark-path]")).toBeNull();
    expect(empty.querySelector(".tree-children")).toBeNull();
    const row = document.querySelector("[data-bookmark-path='WAN.mmd']") as HTMLElement;
    fire(row, "dragstart", "WAN.mmd");
    expect(document.getElementById("bookmark-list")?.className).toContain("is-dragging");
    expect(empty.className).toContain("bookmark-folder");
    fire(empty, "drop", "WAN.mmd");
    expect(folderOf(calls.at(-1) as BookmarkState, "WAN.mmd")).toBe("empty");
  });
});

const nestedFolders: BookmarkState = {
  folders: [
    { id: "sites", name: "Sites", parentId: null },
    { id: "lab", name: "Lab", parentId: null },
    { id: "rack", name: "Rack", parentId: "lab" },
  ],
  items: [],
};

function folderTransfer(id: string) {
  const data = new Map<string, string>([[BOOKMARK_FOLDER_MIME, id]]);
  return {
    types: [BOOKMARK_FOLDER_MIME],
    setData(type: string, value: string) {
      data.set(type, value);
    },
    getData(type: string) {
      return data.get(type) ?? "";
    },
    effectAllowed: "move",
    dropEffect: "move",
  };
}

function fireFolder(target: HTMLElement, type: string, id: string, band: "before" | "inside" | "after" = "inside") {
  const height = 100;
  target.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: height,
      width: 200,
      height,
      toJSON() {
        return {};
      },
    }) as DOMRect;
  const clientY = band === "before" ? 4 : band === "after" ? 96 : 50;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "dataTransfer", { value: folderTransfer(id) });
  act(() => {
    target.dispatchEvent(event);
  });
}

function rootFolderIds() {
  return [...document.querySelectorAll("#bookmark-list > .bookmark-folder")].map((node) => node.getAttribute("data-folder-id"));
}

function childFolderIds(parentId: string) {
  const parent = document.querySelector(`[data-folder-id='${parentId}']`);
  const nest = parent?.querySelector(":scope > .tree-children");
  if (!nest) return [];
  return [...nest.children]
    .filter((node) => node.classList.contains("bookmark-folder"))
    .map((node) => node.getAttribute("data-folder-id"));
}

describe("bookmark folder drag", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  function render(current: BookmarkState, onChange: (next: BookmarkState) => void) {
    root = mount(current, onChange);
  }

  it("nests a folder when the drop is in the middle, and the order survives a reload", () => {
    const calls: BookmarkState[] = [];
    render(nestedFolders, (next) => calls.push(next));
    const actions = document.querySelector<HTMLButtonElement>("button[aria-label='Actions for Lab']");
    act(() => {
      actions?.click();
    });
    expect(document.querySelector("[aria-label='Move folder Lab']")).toBeTruthy();
    act(() => {
      actions?.click();
    });
    const sites = document.querySelector("[data-folder-id='sites']") as HTMLElement;
    fireFolder(sites, "drop", "lab", "inside");
    const saved = calls.at(-1) as BookmarkState;
    expect(saved.folders.find((folder) => folder.id === "lab")?.parentId).toBe("sites");
    expect(calls).toHaveLength(1);

    act(() => root?.unmount());
    render(normalizeBookmarks(saved), () => undefined);
    expect(childFolderIds("sites")).toEqual(["lab"]);
    expect(rootFolderIds()).toEqual(["sites"]);
  });

  it("un-nests a folder dropped on the top level, and the order survives a reload", () => {
    const calls: BookmarkState[] = [];
    const current: BookmarkState = {
      folders: [
        { id: "sites", name: "Sites", parentId: null },
        { id: "lab", name: "Lab", parentId: "sites" },
      ],
      items: [],
    };
    render(current, (next) => calls.push(next));
    fireFolder(document.getElementById("bookmark-list") as HTMLElement, "drop", "lab");
    const saved = calls.at(-1) as BookmarkState;
    expect(saved.folders.find((folder) => folder.id === "lab")?.parentId).toBeNull();
    expect(calls).toHaveLength(1);

    act(() => root?.unmount());
    render(normalizeBookmarks(saved), () => undefined);
    expect(rootFolderIds()).toEqual(["sites", "lab"]);
  });

  it("reorders sibling folders from the row edge and shows the insertion line, not the inside highlight", () => {
    const calls: BookmarkState[] = [];
    render(nestedFolders, (next) => calls.push(next));
    const sitesRow = document.querySelector("[data-bookmark-folder='sites']") as HTMLElement;
    fireFolder(sitesRow, "dragstart", "lab");
    fireFolder(sitesRow, "dragover", "lab", "before");
    expect(document.querySelector(".bookmark-insert")).toBeTruthy();
    expect(document.querySelector("[data-folder-id='sites']")?.className).not.toContain("is-drop-over");
    fireFolder(sitesRow, "dragover", "lab", "inside");
    expect(document.querySelector("[data-folder-id='sites']")?.className).toContain("is-drop-over");
    expect(document.querySelector(".bookmark-insert")).toBeNull();
    fireFolder(sitesRow, "drop", "lab", "before");
    const saved = calls.at(-1) as BookmarkState;
    expect(saved.folders.filter((folder) => (folder.parentId ?? null) === null).map((folder) => folder.id)).toEqual([
      "lab",
      "sites",
    ]);

    act(() => root?.unmount());
    render(normalizeBookmarks(saved), () => undefined);
    expect(rootFolderIds()).toEqual(["lab", "sites"]);
  });

  it("refuses a drop on the folder itself or a descendant and shows no accept highlight", () => {
    const calls: BookmarkState[] = [];
    render(nestedFolders, (next) => calls.push(next));
    const labRow = document.querySelector("[data-bookmark-folder='lab']") as HTMLElement;
    fireFolder(labRow, "dragstart", "lab");
    fireFolder(labRow, "dragover", "lab", "inside");
    expect(document.querySelector(".is-drop-over")).toBeNull();
    expect(document.querySelector(".bookmark-insert")).toBeNull();
    expect(document.querySelector(".is-folder-drop")).toBeNull();
    fireFolder(labRow, "drop", "lab", "inside");
    expect(calls).toHaveLength(0);

    const rackRow = document.querySelector("[data-bookmark-folder='rack']") as HTMLElement;
    fireFolder(rackRow, "dragover", "lab", "before");
    fireFolder(rackRow, "dragover", "lab", "inside");
    fireFolder(rackRow, "dragover", "lab", "after");
    expect(document.querySelector(".is-drop-over")).toBeNull();
    expect(document.querySelector(".bookmark-insert")).toBeNull();
    expect(document.querySelector(".is-folder-drop")).toBeNull();
    fireFolder(rackRow, "drop", "lab", "inside");
    expect(calls).toHaveLength(0);
    expect(childFolderIds("lab")).toEqual(["rack"]);
  });
});
