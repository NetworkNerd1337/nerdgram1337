import { randomBytes } from "node:crypto";
import { getFavoritesPath } from "./paths.js";
import {
  atomicWriteJson,
  httpFail,
  normalizeRelative,
  readJsonFile,
  rewriteMovedPath,
} from "./storage.js";

/**
 * Bookmarks are the renamed favorites list. The file is still
 * `<data>/.meta/favorites.json` so an existing list carries over.
 * A legacy file is a JSON array of paths. New writes use a versioned object
 * with folders. A folder may name `parentId`. A missing parent is the top level.
 * Paths stay the list trash, rename, and move already follow.
 */

export type BookmarkFolder = {
  id: string;
  name: string;
  /** Null is the top level. Older files omit it and still load. */
  parentId: string | null;
};

export type BookmarkItem = {
  path: string;
  folderId: string | null;
};

export type BookmarkState = {
  folders: BookmarkFolder[];
  items: BookmarkItem[];
};

function emptyState(): BookmarkState {
  return { folders: [], items: [] };
}

export async function getBookmarks(): Promise<BookmarkState> {
  return readState();
}

export async function setBookmarks(input: unknown): Promise<BookmarkState> {
  return writeState(parseBookmarkState(input));
}

export async function getFavorites(): Promise<string[]> {
  return (await readState()).items.map((item) => item.path);
}

export async function setFavorites(paths: string[]): Promise<string[]> {
  const state = await readState();
  const byPath = new Map(state.items.map((item) => [item.path, item]));
  const items: BookmarkItem[] = [];
  const seen = new Set<string>();
  for (const entry of paths) {
    const path = normalizeRelative(entry);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const existing = byPath.get(path);
    items.push(existing ? { ...existing, path } : { path, folderId: null });
  }
  const next = await writeState({ folders: state.folders, items });
  return next.items.map((item) => item.path);
}

export async function toggleFavorite(relativePath: string): Promise<{
  favorites: string[];
  favorited: boolean;
  bookmarks: BookmarkState;
}> {
  const state = await readState();
  const normalized = normalizeRelative(relativePath);
  if (!normalized) throw httpFail(400, "path is required", "invalid");
  const items = state.items.filter((item) => item.path !== normalized);
  const favorited = items.length === state.items.length;
  if (favorited) items.push({ path: normalized, folderId: null });
  const bookmarks = await writeState({ folders: state.folders, items });
  return { favorites: bookmarks.items.map((item) => item.path), favorited, bookmarks };
}

export function favoritePathsFor(
  favorites: readonly string[],
  relativePath: string,
  isDir: boolean,
): string[] {
  const normalized = normalizeRelative(relativePath);
  return favorites
    .map((entry) => normalizeRelative(entry))
    .filter((entry) => entry === normalized || (isDir && entry.startsWith(`${normalized}/`)));
}

/** Remove bookmarks for a trashed path and return the paths that were stored. */
export async function takeFavorites(relativePath: string, isDir: boolean): Promise<string[]> {
  const current = await getFavorites();
  const taken = favoritePathsFor(current, relativePath, isDir);
  if (taken.length === 0) return [];
  const takenSet = new Set(taken);
  const next = current.filter((entry) => !takenSet.has(normalizeRelative(entry)));
  await setFavorites(next);
  return taken;
}

export async function addFavorites(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const current = await getFavorites();
  const next = [...current];
  for (const entry of paths) {
    const normalized = normalizeRelative(entry);
    if (!normalized || next.some((existing) => normalizeRelative(existing) === normalized)) {
      continue;
    }
    next.push(normalized);
  }
  if (next.length !== current.length) await setFavorites(next);
}

export async function rewriteFavoritePaths(
  fromPath: string,
  toPath: string,
  isDir: boolean,
): Promise<void> {
  const state = await readState();
  let changed = false;
  const items = state.items.map((item) => {
    const rewritten = rewriteMovedPath(item.path, fromPath, toPath, isDir);
    if (rewritten !== item.path) changed = true;
    return { ...item, path: rewritten };
  });
  if (!changed) return;
  await writeState({ folders: state.folders, items });
}

export function newBookmarkFolderId(): string {
  return `f${randomBytes(4).toString("hex")}`;
}

function parseBookmarkState(input: unknown): BookmarkState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpFail(400, "bookmarks must be an object", "invalid");
  }
  const record = input as { folders?: unknown; items?: unknown };
  if (!Array.isArray(record.folders) || !Array.isArray(record.items)) {
    throw httpFail(400, "bookmarks needs folders and items", "invalid");
  }
  return normalizeState({ folders: record.folders, items: record.items });
}

async function readState(): Promise<BookmarkState> {
  try {
    const parsed = await readJsonFile<unknown>(getFavoritesPath());
    if (Array.isArray(parsed)) {
      return normalizeState({
        folders: [],
        items: parsed.filter((entry): entry is string => typeof entry === "string").map((path) => ({ path, folderId: null })),
      });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyState();
    const record = parsed as { folders?: unknown; items?: unknown; version?: unknown };
    if (!Array.isArray(record.items)) return emptyState();
    return normalizeState({
      folders: Array.isArray(record.folders) ? record.folders : [],
      items: record.items,
    });
  } catch {
    return emptyState();
  }
}

async function writeState(state: BookmarkState): Promise<BookmarkState> {
  const next = normalizeState(state);
  await atomicWriteJson(getFavoritesPath(), { version: 1, folders: next.folders, items: next.items });
  return next;
}

function normalizeState(state: { folders: unknown; items: unknown }): BookmarkState {
  const drafts: { id: string; name: string; parent: string | null }[] = [];
  const folderIds = new Set<string>();
  if (Array.isArray(state.folders)) {
    for (const entry of state.folders) {
      if (!entry || typeof entry !== "object") continue;
      const id = cleanId((entry as { id?: unknown }).id);
      const name = cleanFolderName((entry as { name?: unknown }).name);
      if (!id || !name || folderIds.has(id)) continue;
      folderIds.add(id);
      const rawParent = (entry as { parentId?: unknown }).parentId;
      drafts.push({ id, name, parent: typeof rawParent === "string" ? rawParent.trim() : null });
    }
  }
  const parentOf = new Map<string, string | null>();
  for (const folder of drafts) {
    const parent = folder.parent && folderIds.has(folder.parent) && folder.parent !== folder.id ? folder.parent : null;
    parentOf.set(folder.id, parent);
  }
  const folders: BookmarkFolder[] = drafts.map((folder) => {
    const parent = parentOf.get(folder.id) ?? null;
    return {
      id: folder.id,
      name: folder.name,
      parentId: parent && !folderParentCycles(folder.id, parentOf) ? parent : null,
    };
  });
  const items: BookmarkItem[] = [];
  const seen = new Set<string>();
  if (Array.isArray(state.items)) {
    for (const entry of state.items) {
      const pathValue = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as { path?: unknown }).path : "";
      const path = typeof pathValue === "string" ? normalizeRelative(pathValue) : "";
      if (!path || seen.has(path) || path.split("/").some((part) => part.startsWith("."))) continue;
      seen.add(path);
      const rawFolder = entry && typeof entry === "object" ? (entry as { folderId?: unknown }).folderId : null;
      const folderId = typeof rawFolder === "string" && folderIds.has(rawFolder) ? rawFolder : null;
      items.push({ path, folderId });
    }
  }
  return { folders, items };
}

function folderParentCycles(id: string, parentOf: Map<string, string | null>): boolean {
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

function cleanId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(id) ? id : "";
}

function cleanFolderName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.replace(/[<>:"|?*\\/\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return "";
  return name;
}
