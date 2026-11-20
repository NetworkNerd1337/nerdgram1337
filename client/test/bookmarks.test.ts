import { describe, expect, it } from "vitest";
import {
  bookmarkDropIndex,
  bookmarkFolderChoices,
  createBookmarkFolder,
  deleteBookmarkFolder,
  moveBookmark,
  moveBookmarkFolder,
  normalizeBookmarks,
  placeBookmark,
  removeBookmark,
  reorderBookmark,
  reorderBookmarkFolder,
  type BookmarkState,
} from "../src/lib/bookmarks";

const start: BookmarkState = {
  folders: [{ id: "sites", name: "Sites", parentId: null }],
  items: [
    { path: "WAN.mmd", folderId: null },
    { path: "Sites/Atlanta.mmd", folderId: "sites" },
    { path: "Welcome.mmd", folderId: null },
  ],
};

const nested: BookmarkState = {
  folders: [
    { id: "sites", name: "Sites", parentId: null },
    { id: "lab", name: "Lab", parentId: "sites" },
    { id: "rack", name: "Rack", parentId: "lab" },
  ],
  items: [
    { path: "A.mmd", folderId: null },
    { path: "B.mmd", folderId: "lab" },
    { path: "C.mmd", folderId: "lab" },
    { path: "D.mmd", folderId: "rack" },
  ],
};

describe("bookmark folders", () => {
  it("creates, moves, reorders, and deletes a folder without dropping bookmarks", () => {
    const withFolder = createBookmarkFolder(start, "Lab", "lab");
    expect(withFolder.folders.map((folder) => folder.name)).toEqual(["Sites", "Lab"]);
    const moved = moveBookmark(withFolder, "WAN.mmd", "lab");
    expect(moved.items.find((item) => item.path === "WAN.mmd")?.folderId).toBe("lab");
    const reordered = reorderBookmark(moved, "Welcome.mmd", -1);
    expect(reordered.items.filter((item) => item.folderId === null).map((item) => item.path)).toEqual([
      "Welcome.mmd",
    ]);
    const deleted = deleteBookmarkFolder(moved, "lab");
    expect(deleted.folders.map((folder) => folder.id)).toEqual(["sites"]);
    expect(deleted.items.find((item) => item.path === "WAN.mmd")?.folderId).toBeNull();
    expect(deleted.items.map((item) => item.path)).toContain("Sites/Atlanta.mmd");
    expect(removeBookmark(deleted, "Welcome.mmd").items.map((item) => item.path)).not.toContain("Welcome.mmd");
  });

  it("nests a subfolder and moves bookmarks and child folders up to the deleted folder's parent", () => {
    const created = createBookmarkFolder(nested, "Bench", "bench", "lab");
    expect(created.folders.find((folder) => folder.id === "bench")?.parentId).toBe("lab");
    const deleted = deleteBookmarkFolder(nested, "lab");
    expect(deleted.folders.find((folder) => folder.id === "lab")).toBeUndefined();
    expect(deleted.folders.find((folder) => folder.id === "rack")?.parentId).toBe("sites");
    expect(deleted.items.find((item) => item.path === "B.mmd")?.folderId).toBe("sites");
    expect(deleted.items.find((item) => item.path === "C.mmd")?.folderId).toBe("sites");
    expect(deleted.items.find((item) => item.path === "D.mmd")?.folderId).toBe("rack");
  });

  it("rejects moving a folder into itself or a descendant", () => {
    expect(moveBookmarkFolder(nested, "lab", "lab")).toBe(nested);
    expect(moveBookmarkFolder(nested, "sites", "lab")).toBe(nested);
    expect(moveBookmarkFolder(nested, "sites", "rack")).toBe(nested);
    const lifted = moveBookmarkFolder(nested, "rack", null);
    expect(lifted.folders.find((folder) => folder.id === "rack")?.parentId).toBeNull();
    const intoSites = moveBookmarkFolder(nested, "rack", "sites");
    expect(intoSites.folders.find((folder) => folder.id === "rack")?.parentId).toBe("sites");
  });

  it("reorders a folder among its siblings", () => {
    const extra = createBookmarkFolder(nested, "Other", "other", null);
    const moved = reorderBookmarkFolder(extra, "sites", 1);
    expect(moved.folders.filter((folder) => (folder.parentId ?? null) === null).map((folder) => folder.id)).toEqual([
      "other",
      "sites",
    ]);
    expect(moved.folders.find((folder) => folder.id === "lab")?.parentId).toBe("sites");
  });

  it("labels nested folders with a path and hides a folder's descendants from its move list", () => {
    expect(bookmarkFolderChoices(nested.folders).map((choice) => choice.label)).toEqual([
      "Sites",
      "Sites / Lab",
      "Sites / Lab / Rack",
    ]);
    expect(bookmarkFolderChoices(nested.folders, "lab").map((choice) => choice.id)).toEqual(["sites"]);
  });
});

describe("bookmark drag placement", () => {
  it("moves a top-level bookmark into a folder at the chosen index", () => {
    const next = placeBookmark(nested, "A.mmd", "lab", 0);
    expect(next.items.filter((item) => item.folderId === "lab").map((item) => item.path)).toEqual([
      "A.mmd",
      "B.mmd",
      "C.mmd",
    ]);
  });

  it("moves a bookmark from a folder back to the top level", () => {
    const next = placeBookmark(nested, "B.mmd", null, 0);
    expect(next.items.find((item) => item.path === "B.mmd")?.folderId).toBeNull();
    expect(next.items.filter((item) => item.folderId === null).map((item) => item.path)).toEqual(["B.mmd", "A.mmd"]);
  });

  it("moves a bookmark from one folder to another at a chosen index", () => {
    const next = placeBookmark(nested, "D.mmd", "lab", 1);
    expect(next.items.filter((item) => item.folderId === "lab").map((item) => item.path)).toEqual([
      "B.mmd",
      "D.mmd",
      "C.mmd",
    ]);
    expect(next.items.find((item) => item.path === "D.mmd")?.folderId).toBe("lab");
  });

  it("moves one bookmark through folders and back, reorders inside a folder, nests it, and keeps that place after a reload", () => {
    const start: BookmarkState = {
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
    const pathsIn = (state: BookmarkState, folderId: string | null) =>
      state.items.filter((item) => item.folderId === folderId).map((item) => item.path);

    const inFolder1 = placeBookmark(start, "WAN.mmd", "folder1", bookmarkDropIndex(start.items, "folder1", null, "WAN.mmd"));
    expect(pathsIn(inFolder1, "folder1")).toEqual(["A.mmd", "B.mmd", "WAN.mmd"]);
    expect(pathsIn(inFolder1, null)).toEqual([]);

    const inFolder2 = placeBookmark(
      inFolder1,
      "WAN.mmd",
      "folder2",
      bookmarkDropIndex(inFolder1.items, "folder2", null, "WAN.mmd"),
    );
    expect(inFolder2.items.find((item) => item.path === "WAN.mmd")?.folderId).toBe("folder2");
    expect(pathsIn(inFolder2, "folder2")).toEqual(["WAN.mmd"]);

    const back = placeBookmark(inFolder2, "WAN.mmd", null, 0);
    expect(pathsIn(back, null)).toEqual(["WAN.mmd"]);
    expect(back.items.find((item) => item.path === "WAN.mmd")?.folderId).toBeNull();

    const reordered = placeBookmark(
      inFolder1,
      "B.mmd",
      "folder1",
      bookmarkDropIndex(inFolder1.items, "folder1", "A.mmd", "B.mmd"),
    );
    expect(pathsIn(reordered, "folder1")).toEqual(["B.mmd", "A.mmd", "WAN.mmd"]);

    const nestedPlace = placeBookmark(inFolder2, "WAN.mmd", "nested", 0);
    expect(nestedPlace.items.find((item) => item.path === "WAN.mmd")?.folderId).toBe("nested");
    const reloaded = normalizeBookmarks(JSON.parse(JSON.stringify(nestedPlace)) as unknown);
    expect(reloaded.items.find((item) => item.path === "WAN.mmd")?.folderId).toBe("nested");
    expect(reloaded.folders.find((folder) => folder.id === "nested")?.parentId).toBe("folder2");
    expect(pathsIn(reloaded, "folder1")).toEqual(["A.mmd", "B.mmd"]);
  });

  it("reorders bookmarks within the same folder", () => {
    expect(bookmarkDropIndex(nested.items, "lab", "B.mmd", "C.mmd")).toBe(0);
    const next = placeBookmark(nested, "C.mmd", "lab", bookmarkDropIndex(nested.items, "lab", "B.mmd", "C.mmd"));
    expect(next.items.filter((item) => item.folderId === "lab").map((item) => item.path)).toEqual(["C.mmd", "B.mmd"]);
    const down = reorderBookmark(nested, "B.mmd", 1);
    expect(down.items.filter((item) => item.folderId === "lab").map((item) => item.path)).toEqual(["C.mmd", "B.mmd"]);
  });
});

describe("bookmark file normalization", () => {
  it("treats a missing, unknown, or cyclic parent as the top level and keeps a child of a flattened folder", () => {
    const next = normalizeBookmarks({
      folders: [
        { id: "sites", name: "Sites" },
        { id: "lab", name: "Lab", parentId: "missing" },
        { id: "rack", name: "Rack", parentId: "lab" },
        { id: "a", name: "A", parentId: "b" },
        { id: "b", name: "B", parentId: "a" },
        { id: "child", name: "Child", parentId: "a" },
        { id: "self", name: "Self", parentId: "self" },
      ],
      items: [
        { path: "Gone.mmd", folderId: "nope" },
        { path: "Kept.mmd", folderId: "rack" },
      ],
    });
    expect(next.folders.find((folder) => folder.id === "sites")?.parentId).toBeNull();
    expect(next.folders.find((folder) => folder.id === "lab")?.parentId).toBeNull();
    expect(next.folders.find((folder) => folder.id === "rack")?.parentId).toBe("lab");
    expect(next.folders.find((folder) => folder.id === "a")?.parentId).toBeNull();
    expect(next.folders.find((folder) => folder.id === "b")?.parentId).toBeNull();
    expect(next.folders.find((folder) => folder.id === "child")?.parentId).toBe("a");
    expect(next.folders.find((folder) => folder.id === "self")?.parentId).toBeNull();
    expect(next.items.find((item) => item.path === "Gone.mmd")?.folderId).toBeNull();
    expect(next.items.find((item) => item.path === "Kept.mmd")?.folderId).toBe("rack");
  });
});
