import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
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
  const dragGuard = useRef<Event | null>(null);

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

  const finishDrag = () => {
    setDraggingPath(null);
    setDropSpot(null);
  };

  useEffect(() => {
    if (!draggingPath) return;
    const end = () => {
      setDraggingPath(null);
      setDropSpot(null);
    };
    window.addEventListener("dragend", end);
    return () => window.removeEventListener("dragend", end);
  }, [draggingPath]);

  const itemsIn = (folderId: string | null) => state.items.filter((item) => item.folderId === folderId);
  const choices = bookmarkFolderChoices(state.folders);

  const isBookmarkDrag = (event: DragEvent) => {
    if (draggingPath) return true;
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
    if (!claimDrag(event)) return;
    setDropSpot((current) =>
      current && current.folderId === folderId && current.beforePath === beforePath ? current : { folderId, beforePath },
    );
  };

  const dropAt = (event: DragEvent, folderId: string | null, beforePath: string | null) => {
    const path = event.dataTransfer.getData(BOOKMARK_DRAG) || draggingPath;
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
    setDraggingPath(path);
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
          <Fragment key={item.path}>
            {dropSpot?.folderId === folderId && dropSpot.beforePath === item.path ? (
              <li className="bookmark-insert" aria-hidden="true" />
            ) : null}
            <BookmarkRow
              path={item.path}
              missing={!knownPaths.has(item.path)}
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
          </Fragment>
        ))}
        {dropSpot?.folderId === folderId && dropSpot.beforePath == null ? (
          <li className="bookmark-insert" aria-hidden="true" />
        ) : null}
        <li
          className="bookmark-end"
          data-bookmark-end={folderId ?? ""}
          onDragOver={(event) => hoverAt(event, folderId, null)}
          onDrop={(event) => dropAt(event, folderId, null)}
        />
      </ul>
    );
  };

  const renderFolders = (parentId: string | null): ReactNode => {
    const folders = state.folders.filter((folder) => folderParentId(folder) === parentId);
    if (folders.length === 0) return null;
    return folders.map((folder) => {
      const folderOpen = !collapsed.has(folder.id);
      const hovered = dropSpot?.folderId === folder.id;
      return (
        <div
          key={folder.id}
          className={`bookmark-folder${hovered ? " is-drop-over" : ""}`}
          data-folder-id={folder.id}
          onDragOver={(event) => hoverAt(event, folder.id, null)}
          onDrop={(event) => dropAt(event, folder.id, null)}
        >
          <div className="sidebar-row">
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
    });
  };

  const rootHovered = Boolean(draggingPath) && dropSpot?.folderId === null;

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
          className={`sidebar-block-body${draggingPath ? " is-dragging" : ""}${rootHovered ? " is-drop-over" : ""}`}
          onDragOver={(event) => hoverAt(event, null, null)}
          onDrop={(event) => dropAt(event, null, null)}
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
            <button type="button" className="tree-collapse-all" onClick={() => startDraft(null)}>
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

function RowActions({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
        type="button"
        className="sidebar-mini"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        Actions
      </button>
      {open ? (
        <div className="sidebar-menu-panel" role="group" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
