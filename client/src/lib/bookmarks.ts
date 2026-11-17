export const BOOKMARKS_OPEN_KEY = "nerdgram.sidebar.bookmarksOpen";
export const BOOKMARK_FOLDERS_KEY = "nerdgram.sidebar.bookmarkFolders";

export type BookmarkFolder = {
  id: string;
  name: string;
};

export type BookmarkItem = {
  path: string;
  folderId: string | null;
};

export type BookmarkState = {
  folders: BookmarkFolder[];
  items: BookmarkItem[];
};

export const EMPTY_BOOKMARKS: BookmarkState = { folders: [], items: [] };

export function bookmarkPaths(state: BookmarkState): string[] {
  return state.items.map((item) => item.path);
}

export function createBookmarkFolder(state: BookmarkState, name: string, id: string): BookmarkState {
  const trimmed = name.trim();
  if (!trimmed || state.folders.some((folder) => folder.id === id)) return state;
  return { ...state, folders: [...state.folders, { id, name: trimmed }] };
}

export function renameBookmarkFolder(state: BookmarkState, id: string, name: string): BookmarkState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name: trimmed } : folder)),
  };
}

/** Deleting a folder keeps its bookmarks and moves them to the top level. */
export function deleteBookmarkFolder(state: BookmarkState, id: string): BookmarkState {
  return {
    folders: state.folders.filter((folder) => folder.id !== id),
    items: state.items.map((item) => (item.folderId === id ? { ...item, folderId: null } : item)),
  };
}

export function moveBookmark(state: BookmarkState, path: string, folderId: string | null): BookmarkState {
  return {
    ...state,
    items: state.items.map((item) => (item.path === path ? { ...item, folderId } : item)),
  };
}

export function removeBookmark(state: BookmarkState, path: string): BookmarkState {
  return { ...state, items: state.items.filter((item) => item.path !== path) };
}

function siblingIndexes(items: BookmarkItem[], folderId: string | null): number[] {
  const indexes: number[] = [];
  items.forEach((item, index) => {
    if (item.folderId === folderId) indexes.push(index);
  });
  return indexes;
}

/** Move a bookmark up or down among the bookmarks in the same folder. */
export function reorderBookmark(state: BookmarkState, path: string, direction: -1 | 1): BookmarkState {
  const index = state.items.findIndex((item) => item.path === path);
  if (index < 0) return state;
  const item = state.items[index];
  if (!item) return state;
  const siblings = siblingIndexes(state.items, item.folderId);
  const at = siblings.indexOf(index);
  const swapAt = siblings[at + direction];
  if (at < 0 || swapAt == null) return state;
  const items = [...state.items];
  const other = items[swapAt];
  if (!other) return state;
  items[index] = other;
  items[swapAt] = item;
  return { ...state, items };
}

export function reorderBookmarkFolder(state: BookmarkState, id: string, direction: -1 | 1): BookmarkState {
  const index = state.folders.findIndex((folder) => folder.id === id);
  const swap = index + direction;
  if (index < 0 || swap < 0 || swap >= state.folders.length) return state;
  const folders = [...state.folders];
  const current = folders[index];
  const other = folders[swap];
  if (!current || !other) return state;
  folders[index] = other;
  folders[swap] = current;
  return { ...state, folders };
}

export function readFlag(storage: Pick<Storage, "getItem"> | null, key: string, fallback: boolean): boolean {
  try {
    const raw = storage?.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

export function writeFlag(storage: Pick<Storage, "setItem"> | null, key: string, open: boolean): void {
  try {
    storage?.setItem(key, open ? "1" : "0");
  } catch {
    // Private mode still works for this visit.
  }
}

export function readIdSet(storage: Pick<Storage, "getItem"> | null, key: string): Set<string> {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0));
  } catch {
    return new Set();
  }
}

export function writeIdSet(storage: Pick<Storage, "setItem"> | null, key: string, ids: Set<string>): void {
  try {
    storage?.setItem(key, JSON.stringify([...ids].sort()));
  } catch {
    // Ignore storage failures.
  }
}
