import { useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import {
  BOOKMARK_FOLDERS_KEY,
  BOOKMARKS_OPEN_KEY,
  createBookmarkFolder,
  deleteBookmarkFolder,
  moveBookmark,
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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  const itemsIn = (folderId: string | null) => state.items.filter((item) => item.folderId === folderId);

  const onDragStart = (event: DragEvent, path: string) => {
    event.dataTransfer.setData("text/bookmark-path", path);
    event.dataTransfer.effectAllowed = "move";
  };

  const allowDrop = (event: DragEvent) => {
    if ([...event.dataTransfer.types].includes("text/bookmark-path")) event.preventDefault();
  };

  const dropOnFolder = (event: DragEvent, folderId: string | null) => {
    const path = event.dataTransfer.getData("text/bookmark-path");
    if (!path) return;
    event.preventDefault();
    onChange(moveBookmark(state, path, folderId));
  };

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
        <div id="bookmark-list" className="sidebar-block-body" onDragOver={allowDrop} onDrop={(event) => dropOnFolder(event, null)}>
          {state.items.length === 0 && state.folders.length === 0 ? (
            <p className="sidebar-hint">Bookmarked diagrams appear here.</p>
          ) : null}
          <ul className="sidebar-rows">
            {itemsIn(null).map((item) => (
              <BookmarkRow
                key={item.path}
                path={item.path}
                missing={!knownPaths.has(item.path)}
                folders={state.folders}
                onDragStart={onDragStart}
                onRemove={() => onChange(removeBookmark(state, item.path))}
                onUp={() => onChange(reorderBookmark(state, item.path, -1))}
                onDown={() => onChange(reorderBookmark(state, item.path, 1))}
                onMove={(folderId) => onChange(moveBookmark(state, item.path, folderId))}
              />
            ))}
          </ul>
          {state.folders.map((folder) => {
            const folderOpen = !collapsed.has(folder.id);
            return (
              <div key={folder.id} className="bookmark-folder" onDragOver={allowDrop} onDrop={(event) => dropOnFolder(event, folder.id)}>
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
                  <span className="sidebar-row-actions">
                    <button type="button" className="sidebar-mini" aria-label={`Move ${folder.name} up`} onClick={() => onChange(reorderBookmarkFolder(state, folder.id, -1))}>
                      Up
                    </button>
                    <button type="button" className="sidebar-mini" aria-label={`Move ${folder.name} down`} onClick={() => onChange(reorderBookmarkFolder(state, folder.id, 1))}>
                      Down
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
                  </span>
                </div>
                {folderOpen ? (
                  <ul className="sidebar-rows sidebar-rows-nested">
                    {itemsIn(folder.id).map((item) => (
                      <BookmarkRow
                        key={item.path}
                        path={item.path}
                        missing={!knownPaths.has(item.path)}
                        folders={state.folders}
                        onDragStart={onDragStart}
                        onRemove={() => onChange(removeBookmark(state, item.path))}
                        onUp={() => onChange(reorderBookmark(state, item.path, -1))}
                        onDown={() => onChange(reorderBookmark(state, item.path, 1))}
                        onMove={(folderId) => onChange(moveBookmark(state, item.path, folderId))}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          {draft != null ? (
            <form
              className="sidebar-rename"
              onSubmit={(event) => {
                event.preventDefault();
                const next = createBookmarkFolder(state, draft, newFolderId());
                if (next !== state) onChange(next);
                setDraft(null);
              }}
            >
              <input
                aria-label="New bookmark folder name"
                value={draft}
                placeholder="Folder name"
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" className="sidebar-mini">
                Add
              </button>
              <button type="button" className="sidebar-mini" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="tree-collapse-all" onClick={() => setDraft("")}>
              New folder
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function BookmarkRow({
  path,
  missing,
  folders,
  onDragStart,
  onRemove,
  onUp,
  onDown,
  onMove,
}: {
  path: string;
  missing: boolean;
  folders: BookmarkState["folders"];
  onDragStart: (event: DragEvent, path: string) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const name = displayName(path);
  return (
    <li className="sidebar-row" draggable onDragStart={(event) => onDragStart(event, path)}>
      {missing ? (
        <span className="sidebar-row-label is-missing" title={`${path} (missing)`}>
          {name}
          <span className="sidebar-missing"> Missing</span>
        </span>
      ) : (
        <Link className="sidebar-row-label" to={`/edit/${path}`} title={path}>
          {name}
        </Link>
      )}
      <span className="sidebar-row-actions">
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
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <button type="button" className="sidebar-mini" aria-label={`Remove bookmark ${name}`} onClick={onRemove}>
          Remove
        </button>
      </span>
    </li>
  );
}
