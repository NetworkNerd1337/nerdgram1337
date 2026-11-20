/**
 * @vitest-environment happy-dom
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;

function stubFrames() {
  frames.clear();
  frameId = 0;
  const request = (callback: FrameRequestCallback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  };
  const cancel = (id: number) => {
    frames.delete(id);
  };
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  window.requestAnimationFrame = request;
  window.cancelAnimationFrame = cancel;
}

function flushFrames() {
  const queued = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of queued) callback(0);
  });
}

function fire(target: Element, type: string, path: string, clientY?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer(path) });
  if (clientY != null) Object.defineProperty(event, "clientY", { value: clientY });
  act(() => {
    target.dispatchEvent(event);
  });
}

function folderOf(next: BookmarkState, path: string) {
  return next.items.find((item) => item.path === path)?.folderId ?? null;
}

describe("bookmark rows", () => {
  let root: Root | null = null;

  beforeEach(() => {
    stubFrames();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
    frames.clear();
    vi.unstubAllGlobals();
  });

  it("lines New folder up with the other sidebar actions", () => {
    root = mount(state);
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "New folder");
    expect(button?.className).toContain("sidebar-action");
    expect(button?.className).not.toContain("tree-collapse-all");
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

  it("keeps an empty collapsed folder as a drop target without resizing when the drag starts", () => {
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
    expect(document.querySelector(".bookmark-end")).toBeTruthy();
    const row = document.querySelector("[data-bookmark-path='WAN.mmd']") as HTMLElement;
    const list = document.getElementById("bookmark-list");
    fire(row, "dragstart", "WAN.mmd");
    expect(list?.className).not.toContain("is-dragging");
    flushFrames();
    expect(list?.className).toContain("is-dragging");
    expect(empty.className).toContain("bookmark-folder");
    fire(empty, "drop", "WAN.mmd");
    expect(folderOf(calls.at(-1) as BookmarkState, "WAN.mmd")).toBe("empty");
    expect(list?.className).not.toContain("is-dragging");
  });

  it("does not apply the dragging style synchronously and can drag the same row twice", () => {
    const calls: BookmarkState[] = [];
    const current: BookmarkState = {
      folders: [
        { id: "folder1", name: "Folder1", parentId: null },
        { id: "folder2", name: "Folder2", parentId: null },
      ],
      items: [{ path: "WAN.mmd", folderId: null }],
    };
    root = mount(current, (next) => calls.push(next));
    const row = document.querySelector("[data-bookmark-path='WAN.mmd']") as HTMLElement;
    const list = document.getElementById("bookmark-list") as HTMLElement;
    fire(row, "dragstart", "WAN.mmd");
    fire(row, "dragend", "WAN.mmd");
    flushFrames();
    expect(list.className).not.toContain("is-dragging");

    fire(row, "dragstart", "WAN.mmd");
    expect(list.className).not.toContain("is-dragging");
    flushFrames();
    expect(list.className).toContain("is-dragging");
    fire(document.querySelector("[data-folder-id='folder1']") as Element, "drop", "WAN.mmd");
    expect(folderOf(calls.at(-1) as BookmarkState, "WAN.mmd")).toBe("folder1");
    expect(list.className).not.toContain("is-dragging");

    fire(row, "dragstart", "WAN.mmd");
    expect(list.className).not.toContain("is-dragging");
    flushFrames();
    expect(list.className).toContain("is-dragging");
    fire(document.querySelector("[data-folder-id='folder2']") as Element, "drop", "WAN.mmd");
    expect(folderOf(calls.at(-1) as BookmarkState, "WAN.mmd")).toBe("folder2");
    expect(calls).toHaveLength(2);
  });

  it("scrolls the bookmark box when the pointer is near the bottom edge", () => {
    root = mount(state);
    const list = document.getElementById("bookmark-list") as HTMLElement;
    list.style.overflowY = "auto";
    let top = 0;
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 400 });
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    list.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 200,
        bottom: 80,
        width: 200,
        height: 80,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    const row = document.querySelector("[data-bookmark-path]") as HTMLElement;
    fire(row, "dragstart", "Field Sites/Palo Alto SD-WAN.mmd");
    flushFrames();
    fire(row, "dragover", "Field Sites/Palo Alto SD-WAN.mmd", 76);
    flushFrames();
    expect(top).toBeGreaterThan(0);
  });

  it("moves a bookmark from the top into two folders, back out, into a nested folder, and keeps the place after reload", () => {
    const calls: BookmarkState[] = [];
    let current: BookmarkState = {
      folders: [
        { id: "folder1", name: "Folder1", parentId: null },
        { id: "folder2", name: "Folder2", parentId: null },
        { id: "nested", name: "Nested", parentId: "folder2" },
      ],
      items: [
        { path: "WAN.mmd", folderId: null },
        { path: "A.mmd", folderId: "folder1" },
        { path: "B.mmd", folderId: "folder1" },
      ],
    };
    const show = () => {
      act(() => root?.unmount());
      root = mount(current, (next) => {
        calls.push(next);
      });
    };
    show();
    const dropOn = (selector: string, path = "WAN.mmd") => {
      fire(document.querySelector(selector) as Element, "drop", path);
      current = normalizeBookmarks(calls.at(-1));
      show();
    };
    dropOn("[data-folder-id='folder1']");
    expect(folderOf(current, "WAN.mmd")).toBe("folder1");
    fire(document.querySelector("[data-bookmark-path='A.mmd']") as Element, "drop", "B.mmd");
    current = normalizeBookmarks(calls.at(-1));
    show();
    expect(
      current.items.filter((item) => item.folderId === "folder1").map((item) => item.path),
    ).toEqual(["B.mmd", "A.mmd", "WAN.mmd"]);
    dropOn("[data-folder-id='folder2']");
    expect(folderOf(current, "WAN.mmd")).toBe("folder2");
    dropOn("[data-folder-id='nested']");
    expect(folderOf(current, "WAN.mmd")).toBe("nested");
    dropOn("#bookmark-list");
    expect(folderOf(current, "WAN.mmd")).toBeNull();
    expect(current.folders.find((folder) => folder.id === "nested")?.parentId).toBe("folder2");
  });

  it("draws the drop line inside the target row and hides it beside the source", () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, "../src/index.css"), "utf8");
    expect(css).toMatch(/\.bookmark-insert\s*\{[^}]*position:\s*absolute/);
    const current: BookmarkState = {
      folders: [{ id: "lab", name: "Lab", parentId: null }],
      items: [
        { path: "A.mmd", folderId: "lab" },
        { path: "B.mmd", folderId: "lab" },
      ],
    };
    root = mount(current);
    const rowA = document.querySelector("[data-bookmark-path='A.mmd']") as HTMLElement;
    const rowB = document.querySelector("[data-bookmark-path='B.mmd']") as HTMLElement;
    const beforeTop = rowA.offsetTop;
    fire(rowA, "dragover", "B.mmd");
    const line = document.querySelector(".bookmark-insert");
    expect(line?.parentElement).toBe(rowA);
    expect(rowA.offsetTop).toBe(beforeTop);
    expect(rowB.previousElementSibling).not.toBe(line);
    fire(rowA, "dragover", "A.mmd");
    expect(document.querySelector(".bookmark-insert")).toBeNull();
    fire(rowB, "dragover", "A.mmd");
    expect(document.querySelector(".bookmark-insert")).toBeNull();
  });

  it("switches Actions menus with one click and closes on Escape", () => {
    const current: BookmarkState = {
      folders: [],
      items: [
        { path: "A.mmd", folderId: null },
        { path: "B.mmd", folderId: null },
      ],
    };
    root = mount(current);
    const first = document.querySelector<HTMLButtonElement>("button[aria-label='Actions for A']");
    const second = document.querySelector<HTMLButtonElement>("button[aria-label='Actions for B']");
    const rowA = document.querySelector("[data-bookmark-path='A.mmd']") as HTMLElement;
    const rowB = document.querySelector("[data-bookmark-path='B.mmd']") as HTMLElement;
    const topA = rowA.offsetTop;
    const topB = rowB.offsetTop;
    act(() => {
      first?.click();
    });
    expect(first?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[aria-label='Actions for A']")?.parentElement?.querySelector(".sidebar-menu-panel")).toBeTruthy();
    expect(rowA.offsetTop).toBe(topA);
    expect(rowB.offsetTop).toBe(topB);
    act(() => {
      second?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      second?.click();
    });
    expect(first?.getAttribute("aria-expanded")).toBe("false");
    expect(second?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[aria-label='Remove bookmark B']")).toBeTruthy();
    expect(document.querySelector("[aria-label='Remove bookmark A']")).toBeNull();
    const removeB = document.querySelector<HTMLButtonElement>("[aria-label='Remove bookmark B']");
    removeB?.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(second?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(second);
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

  beforeEach(() => {
    stubFrames();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
    frames.clear();
    vi.unstubAllGlobals();
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

  it("does not mark a folder drag until the next frame, then accepts a second drag", () => {
    const calls: BookmarkState[] = [];
    render(nestedFolders, (next) => calls.push(next));
    const row = document.querySelector("[data-bookmark-folder='lab']") as HTMLElement;
    const list = document.getElementById("bookmark-list") as HTMLElement;
    fireFolder(row, "dragstart", "lab");
    expect(list.className).not.toContain("is-dragging");
    flushFrames();
    expect(list.className).toContain("is-dragging");
    fireFolder(row, "dragend", "lab");
    expect(list.className).not.toContain("is-dragging");
    fireFolder(row, "dragstart", "lab");
    expect(list.className).not.toContain("is-dragging");
    flushFrames();
    expect(list.className).toContain("is-dragging");
    const sites = document.querySelector("[data-folder-id='sites']") as HTMLElement;
    fireFolder(sites, "drop", "lab", "inside");
    expect(calls.at(-1)?.folders.find((folder) => folder.id === "lab")?.parentId).toBe("sites");
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
