export const BOOKMARKS_OPEN_KEY = "nerdgram.sidebar.bookmarksOpen";
export const BOOKMARK_FOLDERS_KEY = "nerdgram.sidebar.bookmarkFolders";

export type BookmarkFolder = {
  id: string;
  name: string;
  /** Absent or null is the top level. Older bookmark files omit this. */
  parentId?: string | null;
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

const FOLDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;

export function bookmarkPaths(state: BookmarkState): string[] {
  return state.items.map((item) => item.path);
}

export function folderParentId(folder: BookmarkFolder): string | null {
  return folder.parentId ?? null;
}

/** Depth-first list. `label` is a path such as `Sites / Lab`. Self and descendants are left out when `excludeId` is set. */
export function bookmarkFolderChoices(
  folders: readonly BookmarkFolder[],
  excludeId?: string,
): { id: string; label: string; depth: number }[] {
  const hidden = new Set<string>();
  if (excludeId) {
    hidden.add(excludeId);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of folders) {
        const parent = folderParentId(folder);
        if (parent && hidden.has(parent) && !hidden.has(folder.id)) {
          hidden.add(folder.id);
          grew = true;
        }
      }
    }
  }
  const result: { id: string; label: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    for (const folder of folders) {
      if (folderParentId(folder) !== parentId || hidden.has(folder.id)) continue;
      const label = prefix ? `${prefix} / ${folder.name}` : folder.name;
      result.push({ id: folder.id, label, depth });
      walk(folder.id, depth + 1, label);
    }
  };
  walk(null, 0, "");
  return result;
}

export function folderParentAllowed(folders: readonly BookmarkFolder[], id: string, parentId: string | null): boolean {
  if (parentId == null) return true;
  if (parentId === id) return false;
  if (!folders.some((folder) => folder.id === parentId)) return false;
  const parents = new Map(folders.map((folder) => [folder.id, folderParentId(folder)]));
  const seen = new Set<string>();
  let current: string | null = parentId;
  while (current) {
    if (current === id) return false;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return true;
}

export function createBookmarkFolder(
  state: BookmarkState,
  name: string,
  id: string,
  parentId: string | null = null,
): BookmarkState {
  const trimmed = name.trim();
  if (!trimmed || state.folders.some((folder) => folder.id === id)) return state;
  if (parentId && !state.folders.some((folder) => folder.id === parentId)) return state;
  return { ...state, folders: [...state.folders, { id, name: trimmed, parentId }] };
}

export function renameBookmarkFolder(state: BookmarkState, id: string, name: string): BookmarkState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name: trimmed } : folder)),
  };
}

/**
 * Deleting a folder keeps its bookmarks and child folders.
 * They move up to the deleted folder's parent, which is the top level when the folder was already there.
 */
export function deleteBookmarkFolder(state: BookmarkState, id: string): BookmarkState {
  const folder = state.folders.find((item) => item.id === id);
  if (!folder) return state;
  const parentId = folderParentId(folder);
  return {
    folders: state.folders
      .filter((item) => item.id !== id)
      .map((item) => (folderParentId(item) === id ? { ...item, parentId } : item)),
    items: state.items.map((item) => (item.folderId === id ? { ...item, folderId: parentId } : item)),
  };
}

export function moveBookmarkFolder(state: BookmarkState, id: string, parentId: string | null): BookmarkState {
  const folder = state.folders.find((item) => item.id === id);
  if (!folder) return state;
  if (folderParentId(folder) === parentId) return state;
  if (!folderParentAllowed(state.folders, id, parentId)) return state;
  return {
    ...state,
    folders: state.folders.map((item) => (item.id === id ? { ...item, parentId } : item)),
  };
}

export function moveBookmark(state: BookmarkState, path: string, folderId: string | null): BookmarkState {
  if (folderId && !state.folders.some((folder) => folder.id === folderId)) return state;
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

/** Index among the destination's bookmarks after `movingPath` is taken out. `beforePath` null appends. */
export function bookmarkDropIndex(
  items: readonly BookmarkItem[],
  folderId: string | null,
  beforePath: string | null,
  movingPath: string,
): number {
  const siblings = items.filter((item) => item.folderId === folderId && item.path !== movingPath);
  if (!beforePath || beforePath === movingPath) return siblings.length;
  const at = siblings.findIndex((item) => item.path === beforePath);
  return at < 0 ? siblings.length : at;
}

/** Move a bookmark into a folder (or the top level) at a sibling index. */
export function placeBookmark(state: BookmarkState, path: string, folderId: string | null, index: number): BookmarkState {
  if (folderId && !state.folders.some((folder) => folder.id === folderId)) return state;
  const current = state.items.find((item) => item.path === path);
  if (!current) return state;
  const without = state.items.filter((item) => item.path !== path);
  const siblings = without.filter((item) => item.folderId === folderId);
  const clamped = Math.max(0, Math.min(index, siblings.length));
  const moving: BookmarkItem = { path: current.path, folderId };
  const items = [...without];
  if (clamped === siblings.length) {
    const last = siblings[siblings.length - 1];
    const at = last ? without.indexOf(last) + 1 : without.length;
    items.splice(at, 0, moving);
  } else {
    const anchor = siblings[clamped];
    if (!anchor) return state;
    items.splice(without.indexOf(anchor), 0, moving);
  }
  if (
    items.length === state.items.length &&
    items.every((item, at) => item.path === state.items[at]?.path && item.folderId === state.items[at]?.folderId)
  ) {
    return state;
  }
  return { ...state, items };
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

function siblingFolderIndexes(folders: BookmarkFolder[], parentId: string | null): number[] {
  const indexes: number[] = [];
  folders.forEach((folder, index) => {
    if (folderParentId(folder) === parentId) indexes.push(index);
  });
  return indexes;
}

export function reorderBookmarkFolder(state: BookmarkState, id: string, direction: -1 | 1): BookmarkState {
  const index = state.folders.findIndex((folder) => folder.id === id);
  if (index < 0) return state;
  const folder = state.folders[index];
  if (!folder) return state;
  const siblings = siblingFolderIndexes(state.folders, folderParentId(folder));
  const at = siblings.indexOf(index);
  const swapAt = siblings[at + direction];
  if (at < 0 || swapAt == null) return state;
  const folders = [...state.folders];
  const other = folders[swapAt];
  if (!other) return state;
  folders[index] = other;
  folders[swapAt] = folder;
  return { ...state, folders };
}

function cleanFolderId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return FOLDER_ID.test(id) ? id : "";
}

function cleanFolderName(value: unknown): string {
  if (typeof value !== "string") return "";
  let name = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    name += code < 32 || "<>:\"|?*\\/".includes(char) ? " " : char;
  }
  name = name.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return "";
  return name;
}

function parentCycles(id: string, parentOf: Map<string, string | null>): boolean {
  const seen = new Set<string>();
  let current = parentOf.get(id) ?? null;
  while (current) {
    if (current === id) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

/**
 * Older files have no `parentId`. A missing parent, an unknown parent, or a
 * parent cycle becomes the top level. A child of a folder that was flattened
 * stays under that folder.
 */
export function normalizeBookmarks(input: unknown): BookmarkState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return EMPTY_BOOKMARKS;
  const record = input as { folders?: unknown; items?: unknown };
  const drafts: { id: string; name: string; parent: string | null }[] = [];
  const ids = new Set<string>();
  if (Array.isArray(record.folders)) {
    for (const entry of record.folders) {
      if (!entry || typeof entry !== "object") continue;
      const id = cleanFolderId((entry as { id?: unknown }).id);
      const name = cleanFolderName((entry as { name?: unknown }).name);
      if (!id || !name || ids.has(id)) continue;
      ids.add(id);
      const rawParent = (entry as { parentId?: unknown }).parentId;
      drafts.push({ id, name, parent: typeof rawParent === "string" ? rawParent.trim() : null });
    }
  }
  const parentOf = new Map<string, string | null>();
  for (const folder of drafts) {
    const parent = folder.parent && ids.has(folder.parent) && folder.parent !== folder.id ? folder.parent : null;
    parentOf.set(folder.id, parent);
  }
  const folders: BookmarkFolder[] = drafts.map((folder) => {
    const parent = parentOf.get(folder.id) ?? null;
    return {
      id: folder.id,
      name: folder.name,
      parentId: parent && !parentCycles(folder.id, parentOf) ? parent : null,
    };
  });
  const items: BookmarkItem[] = [];
  const seen = new Set<string>();
  if (Array.isArray(record.items)) {
    for (const entry of record.items) {
      const pathValue = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as { path?: unknown }).path : "";
      const path = typeof pathValue === "string" ? pathValue.trim() : "";
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const rawFolder = entry && typeof entry === "object" ? (entry as { folderId?: unknown }).folderId : null;
      const folderId = typeof rawFolder === "string" && ids.has(rawFolder) ? rawFolder : null;
      items.push({ path, folderId });
    }
  }
  return { folders, items };
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
