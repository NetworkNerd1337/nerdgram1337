/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BookmarksSection } from "../src/components/BookmarksSection";
import { BOOKMARK_FOLDERS_KEY, type BookmarkState } from "../src/lib/bookmarks";

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
