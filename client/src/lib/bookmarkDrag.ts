import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
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

const SCROLL_EDGE = 28;
const SCROLL_STEP = 12;

/**
 * Pixels to add to scrollTop. Negative scrolls toward the top.
 * The pointer has to be near the box edge. The middle returns 0.
 */
export function bookmarkScrollDelta(clientY: number, top: number, bottom: number): number {
  if (!Number.isFinite(clientY) || !Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return 0;
  const height = bottom - top;
  const band = Math.min(SCROLL_EDGE, Math.max(12, height * 0.22));
  if (clientY < top + band) {
    const closeness = (top + band - clientY) / band;
    return -Math.max(1, Math.round(SCROLL_STEP * closeness));
  }
  if (clientY > bottom - band) {
    const closeness = (clientY - (bottom - band)) / band;
    return Math.max(1, Math.round(SCROLL_STEP * closeness));
  }
  return 0;
}

/** The nearest box that can actually scroll, or the document scroller when the page itself moves. */
export function scrollableBox(node: Element | null): HTMLElement | null {
  let current = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  const doc = node?.ownerDocument ?? document;
  while (current && current !== doc.body && current !== doc.documentElement) {
    const style = getComputedStyle(current);
    const overflow = `${style.overflowY} ${style.overflow}`;
    if (/(auto|scroll)/.test(overflow) && current.scrollHeight > current.clientHeight + 1) return current;
    current = current.parentElement;
  }
  const root = doc.scrollingElement;
  if (root instanceof HTMLElement && root.scrollHeight > root.clientHeight + 1) return root;
  return null;
}

/** Scroll the bookmark box when the pointer is near its top or bottom. Returns whether it moved. */
export function nudgeBookmarkScroll(node: Element, clientY: number): boolean {
  const box = scrollableBox(node);
  if (!box) return false;
  const rect = box.getBoundingClientRect();
  const delta = bookmarkScrollDelta(clientY, rect.top, rect.bottom);
  if (!delta) return false;
  const before = box.scrollTop;
  box.scrollTop = before + delta;
  return box.scrollTop !== before;
}

/** Keep scrolling while the pointer stays in the edge band. Stop on drag end or unmount. */
export function useBookmarkAutoScroll() {
  const pointer = useRef<{ node: Element; clientY: number } | null>(null);
  const frame = useRef<number | null>(null);
  const pump = useRef<() => void>(() => undefined);

  const stop = useCallback(() => {
    pointer.current = null;
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  useEffect(() => {
    pump.current = () => {
      frame.current = null;
      const sample = pointer.current;
      if (!sample) return;
      const moved = nudgeBookmarkScroll(sample.node, sample.clientY);
      if (pointer.current && moved) frame.current = requestAnimationFrame(() => pump.current());
    };
    return stop;
  }, [stop]);

  const track = useCallback((node: Element, clientY: number) => {
    pointer.current = { node, clientY };
    if (frame.current == null) frame.current = requestAnimationFrame(() => pump.current());
  }, []);

  return { track, stop };
}

/** Drag a bookmark folder to nest it, un-nest it, or reorder it among siblings. */
export function useBookmarkFolderDrag(state: BookmarkState, onChange: (next: BookmarkState) => void) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [intent, setIntent] = useState<FolderDropIntent | null>(null);
  const draggingRef = useRef<string | null>(null);
  const guard = useRef<Event | null>(null);
  const dragFrame = useRef<number | null>(null);
  const { track: trackScroll, stop: stopScroll } = useBookmarkAutoScroll();

  const cancelFrame = useCallback(() => {
    if (dragFrame.current != null) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    cancelFrame();
    stopScroll();
    draggingRef.current = null;
    setDraggingId(null);
    setIntent(null);
  }, [stopScroll, cancelFrame]);

  useEffect(() => cancelFrame, [cancelFrame]);

  useEffect(() => {
    if (!draggingId) return;
    window.addEventListener("dragend", finish);
    return () => window.removeEventListener("dragend", finish);
  }, [draggingId, finish]);

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
    if (draggingId && event.currentTarget instanceof Element) trackScroll(event.currentTarget, event.clientY);
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
      setIntent(null);
      cancelFrame();
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = null;
        setDraggingId(id);
      });
    },
    onDragEnd: finish,
    hover,
    drop,
  };
}
