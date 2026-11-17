import { describe, expect, it } from "vitest";
import {
  createBookmarkFolder,
  deleteBookmarkFolder,
  moveBookmark,
  removeBookmark,
  reorderBookmark,
  type BookmarkState,
} from "../src/lib/bookmarks";

const start: BookmarkState = {
  folders: [{ id: "sites", name: "Sites" }],
  items: [
    { path: "WAN.mmd", folderId: null },
    { path: "Sites/Atlanta.mmd", folderId: "sites" },
    { path: "Welcome.mmd", folderId: null },
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
});
