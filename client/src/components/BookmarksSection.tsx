import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  BOOKMARK_FOLDERS_KEY,
  BOOKMARKS_OPEN_KEY,
  bookmarkDropIndex,
  bookmarkFolderChoices,
  createBookmarkFolder,
  deleteBookmarkFolder,
  folderParentId,
  moveBookmark,
  moveBookmarkFolder,
  placeBookmark,
  readFlag,
  readIdSet,
  removeBookmark,
  renameBookmarkFolder,
  reorderBookmark,
  reorderBookmarkFolder,
  writeFlag,
  writeIdSet,
  type BookmarkState,
} from "../lib/bookmarks";
import { bookmarkInsertIsNoOp, folderDropBand, useBookmarkAutoScroll, useBookmarkFolderDrag } from "../lib/bookmarkDrag";
import { displayName } from "../lib/paths";

type BookmarksSectionProps = {
  state: BookmarkState;
  knownPaths: ReadonlySet<string>;
  onChange: (next: BookmarkState) => void;
};

type DropSpot = {
  folderId: string | null;
  beforePath: string | null;
};

const BOOKMARK_DRAG = "text/bookmark-path";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function newFolderId(): string {
  return `f${Math.random().toString(16).slice(2, 10)}`;
}

export function BookmarksSection({ state, knownPaths, onChange }: BookmarksSectionProps) {
  const store = storage();
  const [open, setOpen] = useState(() => readFlag(store, BOOKMARKS_OPEN_KEY, true));
  const [collapsed, setCollapsed] = useState(() => readIdSet(store, BOOKMARK_FOLDERS_KEY));
  const [draft, setDraft] = useState<string | null>(null);
  const [draftParent, setDraftParent] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropSpot, setDropSpot] = useState<DropSpot | null>(null);
  const draggingRef = useRef<string | null>(null);
  const dragFrame = useRef<number | null>(null);
  const dragGuard = useRef<Event | null>(null);
  const { track: trackScroll, stop: stopScroll } = useBookmarkAutoScroll();
  const folderDrag = useBookmarkFolderDrag(state, onChange);

  const cancelDragFrame = useCallback(() => {
    if (dragFrame.current != null) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
  }, []);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    writeFlag(store, BOOKMARKS_OPEN_KEY, next);
  };

  const toggleFolder = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    writeIdSet(store, BOOKMARK_FOLDERS_KEY, next);
  };

  const finishDrag = useCallback(() => {
    cancelDragFrame();
    stopScroll();
    draggingRef.current = null;
    setDraggingPath(null);
    setDropSpot(null);
  }, [stopScroll, cancelDragFrame]);

  useEffect(() => cancelDragFrame, [cancelDragFrame]);

  useEffect(() => {
    if (!draggingPath) return;
    window.addEventListener("dragend", finishDrag);
    return () => window.removeEventListener("dragend", finishDrag);
  }, [draggingPath, finishDrag]);

  const itemsIn = (folderId: string | null) => state.items.filter((item) => item.folderId === folderId);
  const choices = bookmarkFolderChoices(state.folders);

  const isBookmarkDrag = (event: DragEvent) => {
    if (draggingRef.current) return true;
    return [...event.dataTransfer.types].includes(BOOKMARK_DRAG);
  };

  const claimDrag = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const native = event.nativeEvent;
    if (dragGuard.current === native) return false;
    dragGuard.current = native;
    return true;
  };

  const hoverAt = (event: DragEvent, folderId: string | null, beforePath: string | null) => {
    if (!isBookmarkDrag(event)) return;
    if (draggingPath && event.currentTarget instanceof Element) trackScroll(event.currentTarget, event.clientY);
    if (!claimDrag(event)) return;
    const moving = event.dataTransfer.getData(BOOKMARK_DRAG) || draggingRef.current || "";
    if (bookmarkInsertIsNoOp(state.items, folderId, beforePath, moving)) {
      setDropSpot((current) => (current == null ? current : null));
      return;
    }
    setDropSpot((current) =>
      current && current.folderId === folderId && current.beforePath === beforePath ? current : { folderId, beforePath },
    );
  };

  const dropAt = (event: DragEvent, folderId: string | null, beforePath: string | null) => {
    const path = event.dataTransfer.getData(BOOKMARK_DRAG) || draggingRef.current;
    if (!path) return;
    if (!claimDrag(event)) return;
    if (path !== beforePath) {
      onChange(placeBookmark(state, path, folderId, bookmarkDropIndex(state.items, folderId, beforePath, path)));
    }
    finishDrag();
  };

  const onDragStart = (event: DragEvent, path: string) => {
    event.dataTransfer.setData(BOOKMARK_DRAG, path);
    event.dataTransfer.effectAllowed = "move";
    draggingRef.current = path;
    cancelDragFrame();
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      setDraggingPath(path);
    });
  };

  const startDraft = (parentId: string | null) => {
    setDraft("");
    setDraftParent(parentId);
    if (parentId && collapsed.has(parentId)) toggleFolder(parentId);
  };

  const renderItems = (folderId: string | null) => {
    const items = itemsIn(folderId);
    return (
      <ul className="sidebar-rows bookmark-drop-zone">
        {items.map((item) => (
          <BookmarkRow
            key={item.path}
            path={item.path}
            missing={!knownPaths.has(item.path)}
            insert={dropSpot?.folderId === folderId && dropSpot.beforePath === item.path}
            choices={choices}
            onDragStart={onDragStart}
            onDragEnd={finishDrag}
            onDragOver={(event) => hoverAt(event, folderId, item.path)}
            onDrop={(event) => dropAt(event, folderId, item.path)}
            onRemove={() => onChange(removeBookmark(state, item.path))}
            onUp={() => onChange(reorderBookmark(state, item.path, -1))}
            onDown={() => onChange(reorderBookmark(state, item.path, 1))}
            onMove={(nextFolder) => onChange(moveBookmark(state, item.path, nextFolder))}
          />
        ))}
        <li
          className="bookmark-end"
          data-bookmark-end={folderId ?? ""}
          onDragOver={(event) => hoverAt(event, folderId, null)}
          onDrop={(event) => dropAt(event, folderId, null)}
        >
          {dropSpot?.folderId === folderId && dropSpot.beforePath == null ? (
            <span className="bookmark-insert" aria-hidden="true" />
          ) : null}
        </li>
      </ul>
    );
  };

  const renderFolders = (parentId: string | null): ReactNode => {
    const folders = state.folders.filter((folder) => folderParentId(folder) === parentId);
    if (folders.length === 0) return null;
    const lastId = folders[folders.length - 1]?.id;
    return (
      <>
        {folders.map((folder) => {
          const folderOpen = !collapsed.has(folder.id);
          const hovered = dropSpot?.folderId === folder.id || folderDrag.inside(folder.id);
          return (
            <div
              key={folder.id}
              className={`bookmark-folder${hovered ? " is-drop-over" : ""}`}
              data-folder-id={folder.id}
              onDragOver={(event) => {
                if (folderDrag.hover(event, folder.id, "inside")) return;
                hoverAt(event, folder.id, null);
              }}
              onDrop={(event) => {
                if (folderDrag.drop(event, folder.id, "inside")) return;
                dropAt(event, folder.id, null);
              }}
            >
              <div
                className="sidebar-row"
                draggable
                data-bookmark-folder={folder.id}
                onDragStart={(event) => folderDrag.onDragStart(event, folder.id)}
                onDragEnd={folderDrag.onDragEnd}
                onDragOver={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const band = folderDropBand(event.clientY, rect.top, rect.height, folderDrag.stickyBand(folder.id));
                  folderDrag.hover(event, folder.id, band);
                }}
                onDrop={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const band = folderDropBand(event.clientY, rect.top, rect.height, folderDrag.stickyBand(folder.id));
                  folderDrag.drop(event, folder.id, band);
                }}
              >
                {folderDrag.before(folder.id) ? <span className="bookmark-insert" aria-hidden="true" /> : null}
                <span className="bookmark-drag-handle" aria-label={`Drag folder ${folder.name}`} title="Drag to move">
                  ::
                </span>
                <button
                  type="button"
                  className="tree-chevron"
                  aria-expanded={folderOpen}
                  aria-label={folderOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
                  onClick={() => toggleFolder(folder.id)}
                />
                {renaming === folder.id ? (
                  <form
                    className="sidebar-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onChange(renameBookmarkFolder(state, folder.id, renameValue));
                      setRenaming(null);
                    }}
                  >
                    <input
                      aria-label={`Rename folder ${folder.name}`}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      autoFocus
                    />
                  </form>
                ) : (
                  <span className="sidebar-row-label" title={folder.name}>
                    {folder.name}
                  </span>
                )}
                <RowActions label={`Actions for ${folder.name}`}>
                  <button type="button" className="sidebar-mini" aria-label={`Move ${folder.name} up`} onClick={() => onChange(reorderBookmarkFolder(state, folder.id, -1))}>
                    Up
                  </button>
                  <button type="button" className="sidebar-mini" aria-label={`Move ${folder.name} down`} onClick={() => onChange(reorderBookmarkFolder(state, folder.id, 1))}>
                    Down
                  </button>
                  <label className="visually-hidden" htmlFor={`move-folder-${folder.id}`}>
                    Move {folder.name}
                  </label>
                  <select
                    id={`move-folder-${folder.id}`}
                    className="sidebar-mini"
                    aria-label={`Move folder ${folder.name}`}
                    value=""
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value) return;
                      const next = moveBookmarkFolder(state, folder.id, value === "__root__" ? null : value);
                      if (next !== state) onChange(next);
                      event.target.value = "";
                    }}
                  >
                    <option value="">Move…</option>
                    <option value="__root__">Top level</option>
                    {bookmarkFolderChoices(state.folders, folder.id).map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="sidebar-mini"
                    aria-label={`New subfolder in ${folder.name}`}
                    onClick={() => startDraft(folder.id)}
                  >
                    New subfolder
                  </button>
                  <button
                    type="button"
                    className="sidebar-mini"
                    aria-label={`Rename ${folder.name}`}
                    onClick={() => {
                      setRenaming(folder.id);
                      setRenameValue(folder.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="sidebar-mini"
                    aria-label={`Delete folder ${folder.name}`}
                    onClick={() => onChange(deleteBookmarkFolder(state, folder.id))}
                  >
                    Delete
                  </button>
                </RowActions>
              </div>
              {folderDrag.end(parentId) && folder.id === lastId ? <span className="bookmark-insert is-after" aria-hidden="true" /> : null}
              {folderOpen ? (
                <div className="tree-children">
                  {renderItems(folder.id)}
                  {renderFolders(folder.id)}
                  {draft != null && draftParent === folder.id ? (
                    <FolderDraft
                      value={draft}
                      onChange={setDraft}
                      onCancel={() => setDraft(null)}
                      onSubmit={() => {
                        const next = createBookmarkFolder(state, draft, newFolderId(), folder.id);
                        if (next !== state) onChange(next);
                        setDraft(null);
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </>
    );
  };

  const rootHovered = Boolean(draggingPath) && dropSpot?.folderId === null;
  const folderRoot = folderDrag.dragging && folderDrag.inside(null);

  return (
    <section className="sidebar-block" aria-label="Bookmarks">
      <div className="sidebar-block-head">
        <button
          type="button"
          className="tree-chevron"
          aria-expanded={open}
          aria-controls="bookmark-list"
          onClick={toggleOpen}
        >
          <span className="visually-hidden">{open ? "Collapse bookmarks" : "Expand bookmarks"}</span>
        </button>
        <span className="sidebar-block-title">Bookmarks</span>
        <Link className="tree-collapse-all" to="/settings#bookmarks">
          Manage
        </Link>
      </div>
      {open ? (
        <div
          id="bookmark-list"
          className={`sidebar-block-body${draggingPath || folderDrag.dragging ? " is-dragging" : ""}${rootHovered ? " is-drop-over" : ""}${folderRoot ? " is-folder-drop" : ""}`}
          onDragOver={(event) => {
            if (folderDrag.hover(event, null, "inside")) return;
            hoverAt(event, null, null);
          }}
          onDrop={(event) => {
            if (folderDrag.drop(event, null, "inside")) return;
            dropAt(event, null, null);
          }}
        >
          {state.items.length === 0 && state.folders.length === 0 ? (
            <p className="sidebar-hint">Bookmarked diagrams appear here.</p>
          ) : null}
          {renderItems(null)}
          {renderFolders(null)}
          {draft != null && draftParent == null ? (
            <FolderDraft
              value={draft}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSubmit={() => {
                const next = createBookmarkFolder(state, draft, newFolderId(), null);
                if (next !== state) onChange(next);
                setDraft(null);
              }}
            />
          ) : (
            <button type="button" className="sidebar-action" onClick={() => startDraft(null)}>
              New folder
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function FolderDraft({
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="sidebar-rename"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        aria-label="New bookmark folder name"
        value={value}
        placeholder="Folder name"
        autoFocus
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="submit" className="sidebar-mini">
        Add
      </button>
      <button type="button" className="sidebar-mini" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function BookmarkRow({
  path,
  missing,
  insert,
  choices,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onRemove,
  onUp,
  onDown,
  onMove,
}: {
  path: string;
  missing: boolean;
  insert: boolean;
  choices: { id: string; label: string }[];
  onDragStart: (event: DragEvent, path: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const name = displayName(path);
  const tip = name === path ? name : `${name} (${path})`;
  return (
    <li
      className="sidebar-row"
      draggable
      data-bookmark-path={path}
      onDragStart={(event) => onDragStart(event, path)}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {insert ? <span className="bookmark-insert" aria-hidden="true" /> : null}
      {missing ? (
        <span className="sidebar-row-label is-missing" title={`${tip} (missing)`}>
          {name}
          <span className="sidebar-missing"> Missing</span>
        </span>
      ) : (
        <Link className="sidebar-row-label" to={`/edit/${path}`} title={tip}>
          {name}
        </Link>
      )}
      <RowActions label={`Actions for ${name}`}>
        <button type="button" className="sidebar-mini" aria-label={`Move ${name} up`} onClick={onUp}>
          Up
        </button>
        <button type="button" className="sidebar-mini" aria-label={`Move ${name} down`} onClick={onDown}>
          Down
        </button>
        <label className="visually-hidden" htmlFor={`move-${path}`}>
          Move {name} to a folder
        </label>
        <select
          id={`move-${path}`}
          className="sidebar-mini"
          aria-label={`Folder for ${name}`}
          value=""
          onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            onMove(value === "__root__" ? null : value);
            event.target.value = "";
          }}
        >
          <option value="">Move…</option>
          <option value="__root__">Top level</option>
          {choices.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.label}
            </option>
          ))}
        </select>
        <button type="button" className="sidebar-mini" aria-label={`Remove bookmark ${name}`} onClick={onRemove}>
          Remove
        </button>
      </RowActions>
    </li>
  );
}

function placeActionsMenu(button: HTMLButtonElement, panel: HTMLElement) {
  const rect = button.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  let left = rect.left - width - 4;
  let top = rect.top;
  if (left < 8) {
    left = Math.max(8, rect.left - width - 4);
    top = rect.bottom + 4;
  }
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

function RowActions({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !panelRef.current) return;
    placeActionsMenu(buttonRef.current, panelRef.current);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div className="sidebar-menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="sidebar-mini"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        Actions
      </button>
      {open ? (
        <div ref={panelRef} id={panelId} className="sidebar-menu-panel" role="group" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
