import { describe, expect, it } from "vitest";
import { bookmarkScrollDelta, folderDropBand, folderDropIntent, moveBookmarkFolderTo } from "../src/lib/bookmarkDrag";
import { normalizeBookmarks, type BookmarkState } from "../src/lib/bookmarks";

const tree: BookmarkState = {
  folders: [
    { id: "sites", name: "Sites", parentId: null },
    { id: "lab", name: "Lab", parentId: null },
    { id: "rack", name: "Rack", parentId: "lab" },
  ],
  items: [{ path: "WAN.mmd", folderId: "lab" }],
};

function ids(state: BookmarkState, parentId: string | null) {
  return state.folders.filter((folder) => (folder.parentId ?? null) === parentId).map((folder) => folder.id);
}

describe("bookmark box auto-scroll", () => {
  it("scrolls only when the pointer is near the top or bottom edge", () => {
    expect(bookmarkScrollDelta(50, 0, 100)).toBe(0);
    expect(bookmarkScrollDelta(2, 0, 100)).toBeLessThan(0);
    expect(bookmarkScrollDelta(98, 0, 100)).toBeGreaterThan(0);
    expect(bookmarkScrollDelta(Number.NaN, 0, 100)).toBe(0);
    expect(bookmarkScrollDelta(10, 0, 0)).toBe(0);
  });
});

describe("bookmark folder drop intent", () => {
  it("splits a row into a middle nest band and edge reorder bands", () => {
    expect(folderDropBand(10, 0, 100)).toBe("before");
    expect(folderDropBand(50, 0, 100)).toBe("inside");
    expect(folderDropBand(90, 0, 100)).toBe("after");
    expect(folderDropBand(0, 0, 0)).toBe("inside");
  });

  it("nests, un-nests, and reorders, and refuses the folder and its descendants", () => {
    const nested = moveBookmarkFolderTo(tree, "lab", "sites", "inside");
    expect(nested.folders.find((folder) => folder.id === "lab")?.parentId).toBe("sites");
    expect(ids(nested, "sites")).toEqual(["lab"]);
    expect(nested.items.find((item) => item.path === "WAN.mmd")?.folderId).toBe("lab");

    const lifted = moveBookmarkFolderTo(nested, "lab", null, "inside");
    expect(lifted.folders.find((folder) => folder.id === "lab")?.parentId).toBeNull();
    expect(normalizeBookmarks(lifted).folders.map((folder) => folder.id)).toEqual(["sites", "lab", "rack"]);

    const reordered = moveBookmarkFolderTo(tree, "lab", "sites", "before");
    expect(ids(reordered, null)).toEqual(["lab", "sites"]);
    expect(reordered.folders.find((folder) => folder.id === "rack")?.parentId).toBe("lab");

    expect(moveBookmarkFolderTo(tree, "lab", "lab", "inside")).toBe(tree);
    expect(moveBookmarkFolderTo(tree, "lab", "lab", "before")).toBe(tree);
    expect(moveBookmarkFolderTo(tree, "lab", "rack", "inside")).toBe(tree);
    expect(moveBookmarkFolderTo(tree, "lab", "rack", "after")).toBe(tree);
    expect(folderDropIntent(tree.folders, "lab", "rack", "before").accept).toBe(false);
  });
});
