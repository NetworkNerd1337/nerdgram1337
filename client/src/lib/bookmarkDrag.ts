import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  bookmarkFolderDropIndex,
  folderParentAllowed,
  folderParentId,
  placeBookmarkFolder,
  type BookmarkFolder,
  type BookmarkState,
} from "./bookmarks";

export const BOOKMARK_FOLDER_MIME = "text/bookmark-folder";

/** Top and bottom quarters of a folder row. The middle half means "drop inside". */
export const FOLDER_EDGE = 0.25;

export type FolderBand = "before" | "inside" | "after";

export type FolderDropIntent =
  | { accept: false }
  | { accept: true; mode: "inside" | "edge"; parentId: string | null; beforeId: string | null };

/**
 * A row with no height counts as the middle, so a drop still nests.
 * `clientY` is relative to the row's top.
 */
export function folderDropBand(clientY: number, top: number, height: number): FolderBand {
  if (!Number.isFinite(clientY) || !Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return "inside";
  const ratio = (clientY - top) / height;
  if (ratio <= FOLDER_EDGE) return "before";
  if (ratio >= 1 - FOLDER_EDGE) return "after";
  return "inside";
}

function isDescendant(folders: readonly BookmarkFolder[], ancestorId: string, id: string): boolean {
  const parents = new Map(folders.map((folder) => [folder.id, folderParentId(folder)]));
  const seen = new Set<string>();
  let current = parents.get(id) ?? null;
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

/**
 * `overId` null is the top-level container: the folder moves to the top.
 * The folder's own row, and every folder inside it, refuses every band.
 */
export function folderDropIntent(
  folders: readonly BookmarkFolder[],
  movingId: string,
  overId: string | null,
  band: FolderBand,
): FolderDropIntent {
  if (!movingId || !folders.some((folder) => folder.id === movingId)) return { accept: false };
  if (overId == null) {
    if (!folderParentAllowed(folders, movingId, null)) return { accept: false };
    return { accept: true, mode: "inside", parentId: null, beforeId: null };
  }
  const over = folders.find((folder) => folder.id === overId);
  if (!over || overId === movingId || isDescendant(folders, movingId, overId)) return { accept: false };
  if (band === "inside") {
    if (!folderParentAllowed(folders, movingId, overId)) return { accept: false };
    return { accept: true, mode: "inside", parentId: overId, beforeId: null };
  }
  const parentId = folderParentId(over);
  if (!folderParentAllowed(folders, movingId, parentId)) return { accept: false };
  if (band === "before") return { accept: true, mode: "edge", parentId, beforeId: overId };
  const siblings = folders.filter((folder) => folderParentId(folder) === parentId);
  const index = siblings.findIndex((folder) => folder.id === overId);
  let next = siblings[index + 1];
  if (next?.id === movingId) next = siblings[index + 2];
  return { accept: true, mode: "edge", parentId, beforeId: next?.id ?? null };
}

export function moveBookmarkFolderTo(
  state: BookmarkState,
  movingId: string,
  overId: string | null,
  band: FolderBand,
): BookmarkState {
  const intent = folderDropIntent(state.folders, movingId, overId, band);
  if (!intent.accept) return state;
  const index = bookmarkFolderDropIndex(state.folders, intent.parentId, intent.beforeId, movingId);
  return placeBookmarkFolder(state, movingId, intent.parentId, index);
}

function sameIntent(current: FolderDropIntent | null, next: FolderDropIntent | null): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  if (!current.accept || !next.accept) return current.accept === next.accept;
  return current.mode === next.mode && current.parentId === next.parentId && current.beforeId === next.beforeId;
}

function dragBlocked(event: DragEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, input, select, textarea, a, label"));
}

/** Drag a bookmark folder to nest it, un-nest it, or reorder it among siblings. */
export function useBookmarkFolderDrag(state: BookmarkState, onChange: (next: BookmarkState) => void) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [intent, setIntent] = useState<FolderDropIntent | null>(null);
  const draggingRef = useRef<string | null>(null);
  const guard = useRef<Event | null>(null);

  const finish = () => {
    draggingRef.current = null;
    setDraggingId(null);
    setIntent(null);
  };

  useEffect(() => {
    if (!draggingId) return;
    const end = () => finish();
    window.addEventListener("dragend", end);
    return () => window.removeEventListener("dragend", end);
  }, [draggingId]);

  const isFolderDrag = (event: DragEvent) => {
    if (draggingRef.current) return true;
    const types = event.dataTransfer?.types;
    return Boolean(types && [...types].includes(BOOKMARK_FOLDER_MIME));
  };

  const movingId = (event: DragEvent) => event.dataTransfer?.getData(BOOKMARK_FOLDER_MIME) || draggingRef.current || "";

  const claim = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const native = event.nativeEvent;
    if (guard.current === native) return false;
    guard.current = native;
    return true;
  };

  const show = (next: FolderDropIntent | null) => {
    setIntent((current) => (sameIntent(current, next) ? current : next));
  };

  const hover = (event: DragEvent, overId: string | null, band: FolderBand) => {
    if (!isFolderDrag(event)) return false;
    if (!claim(event)) return true;
    const next = folderDropIntent(state.folders, movingId(event), overId, band);
    if (!next.accept) {
      event.dataTransfer.dropEffect = "none";
      show(null);
      return true;
    }
    event.dataTransfer.dropEffect = "move";
    show(next);
    return true;
  };

  const drop = (event: DragEvent, overId: string | null, band: FolderBand) => {
    if (!isFolderDrag(event)) return false;
    if (!claim(event)) return true;
    const next = moveBookmarkFolderTo(state, movingId(event), overId, band);
    if (next !== state) onChange(next);
    finish();
    return true;
  };

  const accepted = intent?.accept ? intent : null;

  return {
    dragging: Boolean(draggingId),
    inside(id: string | null) {
      return Boolean(accepted && accepted.mode === "inside" && accepted.parentId === id);
    },
    before(id: string) {
      return Boolean(accepted && accepted.mode === "edge" && accepted.beforeId === id);
    },
    end(parentId: string | null) {
      return Boolean(accepted && accepted.mode === "edge" && accepted.parentId === parentId && accepted.beforeId == null);
    },
    onDragStart(event: DragEvent, id: string) {
      if (dragBlocked(event)) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.dataTransfer.setData(BOOKMARK_FOLDER_MIME, id);
      event.dataTransfer.effectAllowed = "move";
      draggingRef.current = id;
      setDraggingId(id);
      setIntent(null);
    },
    onDragEnd: finish,
    hover,
    drop,
  };
}
