/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookmarkManager } from "../src/components/BookmarkManager";
import { BOOKMARK_FOLDER_MIME } from "../src/lib/bookmarkDrag";
import type { BookmarkState } from "../src/lib/bookmarks";

const saved = vi.hoisted(() => {
  const initial = (): BookmarkState => ({
    folders: [
      { id: "sites", name: "Sites", parentId: null },
      { id: "other", name: "Other", parentId: null },
      { id: "lab", name: "Lab", parentId: "sites" },
      { id: "rack", name: "Rack", parentId: "lab" },
    ],
    items: [{ path: "WAN.mmd", folderId: "lab" }],
  });
  const store: { bookmarks: BookmarkState; save: ReturnType<typeof vi.fn> } = {
    bookmarks: initial(),
    save: vi.fn(async (next: BookmarkState) => {
      store.bookmarks = next;
      return next;
    }),
  };
  return { store, initial };
});

vi.mock("../src/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    bookmarks: saved.store.bookmarks,
    saveBookmarks: saved.store.save,
    tree: [],
    loading: false,
  }),
}));

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

function show(current: BookmarkState = saved.store.bookmarks) {
  saved.store.bookmarks = current;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter>
        <BookmarkManager />
      </MemoryRouter>,
    );
  });
  return root;
}

function rootFolderIds() {
  return [...document.querySelectorAll("#bookmarks ul.bookmark-manage-list > li[data-folder-id]")].map((node) =>
    node.getAttribute("data-folder-id"),
  );
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

describe("bookmark settings", () => {
  let root: Root | null = null;

  beforeEach(() => {
    stubFrames();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    saved.store.bookmarks = saved.initial();
    saved.store.save.mockClear();
    frames.clear();
    vi.unstubAllGlobals();
  });

  it("shows a nested folder tree and does not offer Reload", () => {
    root = show();

    expect(document.querySelector("button")?.textContent ?? "").not.toBe("Reload");
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Reload")).toBe(false);
    expect(document.body.textContent).toContain("Sites / Lab");
    const lab = document.querySelector("#folder-lab") as HTMLInputElement;
    expect(lab.value).toBe("Lab");
    act(() => {
      document.querySelector<HTMLButtonElement>("button[aria-label='Collapse Sites']")?.click();
    });
    expect(document.querySelector("#folder-lab")).toBeNull();
    act(() => {
      document.querySelector<HTMLButtonElement>("button[aria-label='Expand Sites']")?.click();
    });
    expect(document.querySelector("#folder-lab")).toBeTruthy();
  });

  it("nests, un-nests, and reorders folders, refuses a descendant, and keeps the saved order", async () => {
    root = show();
    expect(document.querySelector("[aria-label='Move folder Lab']")).toBeTruthy();

    const sites = document.querySelector("[data-folder-id='sites']") as HTMLElement;
    fireFolder(sites, "drop", "other", "inside");
    await act(async () => {
      await Promise.resolve();
    });
    expect(saved.store.bookmarks.folders.find((folder) => folder.id === "other")?.parentId).toBe("sites");

    act(() => root?.unmount());
    root = show(saved.store.bookmarks);
    const sitesAgain = document.querySelector("[data-folder-id='sites']") as HTMLElement;
    expect(sitesAgain.querySelector("[data-folder-id='other']")).toBeTruthy();

    fireFolder(document.getElementById("bookmarks") as HTMLElement, "drop", "other");
    await act(async () => {
      await Promise.resolve();
    });
    expect(saved.store.bookmarks.folders.find((folder) => folder.id === "other")?.parentId).toBeNull();

    act(() => root?.unmount());
    root = show(saved.store.bookmarks);
    const sitesRow = document.querySelector("[data-bookmark-folder='sites']") as HTMLElement;
    fireFolder(sitesRow, "dragover", "other", "before");
    expect(document.querySelector("#bookmarks .bookmark-insert")).toBeTruthy();
    expect(document.querySelector("[data-folder-id='sites']")?.className).not.toContain("is-drop-over");
    fireFolder(sitesRow, "dragover", "other", "inside");
    expect(document.querySelector("[data-folder-id='sites']")?.className).toContain("is-drop-over");
    fireFolder(sitesRow, "drop", "other", "before");
    await act(async () => {
      await Promise.resolve();
    });
    const top = saved.store.bookmarks.folders.filter((folder) => (folder.parentId ?? null) === null).map((folder) => folder.id);
    expect(top[0]).toBe("other");

    act(() => root?.unmount());
    root = show(saved.store.bookmarks);
    expect(rootFolderIds()[0]).toBe("other");

    const before = saved.store.save.mock.calls.length;
    const rackRow = document.querySelector("[data-bookmark-folder='rack']") as HTMLElement;
    fireFolder(rackRow, "dragover", "sites", "inside");
    fireFolder(rackRow, "drop", "sites", "inside");
    await act(async () => {
      await Promise.resolve();
    });
    expect(saved.store.save.mock.calls.length).toBe(before);
    expect(document.querySelector(".is-drop-over")).toBeNull();
    expect(document.querySelector(".bookmark-insert")).toBeNull();
    expect(saved.store.bookmarks.folders.find((folder) => folder.id === "rack")?.parentId).toBe("lab");
  });

  it("does not mark the manager as dragging until the next frame, then accepts a second drag", () => {
    root = show();
    const row = document.querySelector("[data-bookmark-folder='other']") as HTMLElement;
    const section = document.getElementById("bookmarks") as HTMLElement;
    fireFolder(row, "dragstart", "other");
    expect(section.className).not.toContain("is-dragging");
    flushFrames();
    expect(section.className).toContain("is-dragging");
    fireFolder(row, "dragend", "other");
    expect(section.className).not.toContain("is-dragging");
    fireFolder(row, "dragstart", "other");
    expect(section.className).not.toContain("is-dragging");
    flushFrames();
    expect(section.className).toContain("is-dragging");
    const sites = document.querySelector("[data-folder-id='sites']") as HTMLElement;
    fireFolder(sites, "drop", "other", "inside");
    expect(saved.store.bookmarks.folders.find((folder) => folder.id === "other")?.parentId).toBe("sites");
  });
});
