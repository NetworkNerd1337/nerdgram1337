import { useEffect, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { folderDropBand, useBookmarkFolderDrag } from "../lib/bookmarkDrag";
import {
  bookmarkFolderChoices,
  createBookmarkFolder,
  deleteBookmarkFolder,
  folderParentId,
  moveBookmark,
  moveBookmarkFolder,
  removeBookmark,
  renameBookmarkFolder,
  type BookmarkFolder,
  type BookmarkItem,
  type BookmarkState,
} from "../lib/bookmarks";
import { displayName, flattenFiles } from "../lib/paths";
import { useWorkspace } from "../hooks/useWorkspace";

/** Settings view for every bookmark and folder. The page already loads the saved list. */
export function BookmarkManager() {
  const { bookmarks, saveBookmarks, tree, loading } = useWorkspace();
  const [draft, setDraft] = useState<BookmarkState>(bookmarks);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [folderDraft, setFolderDraft] = useState<{ parentId: string | null; name: string } | null>(null);
  const known = new Set(flattenFiles(tree).map((file) => file.path));

  useEffect(() => {
    setDraft(bookmarks);
  }, [bookmarks]);

  const commit = async (next: BookmarkState) => {
    if (next === draft) return;
    setDraft(next);
    setError(null);
    try {
      await saveBookmarks(next);
      setNotice("Bookmarks saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save bookmarks");
    }
  };

  const folderDrag = useBookmarkFolderDrag(draft, (next) => void commit(next));

  const addFolder = (parentId: string | null, name: string) => {
    const next = createBookmarkFolder(draft, name, newFolderId(), parentId);
    if (next === draft) return;
    if (parentId) {
      setCollapsed((current) => {
        if (!current.has(parentId)) return current;
        const open = new Set(current);
        open.delete(parentId);
        return open;
      });
    }
    setFolderDraft(null);
    void commit(next);
  };

  const folderRoot = folderDrag.dragging && folderDrag.inside(null);

  return (
    <section
      className={`sync-card bookmark-manage${folderDrag.dragging ? " is-dragging" : ""}${folderRoot ? " is-folder-drop" : ""}`}
      id="bookmarks"
      onDragOver={(event) => folderDrag.hover(event, null, "inside")}
      onDrop={(event) => folderDrag.drop(event, null, "inside")}
    >
      <h2>Bookmarks</h2>
      <p>
        Bookmarks are stored in this NerdGram instance, in <code>.meta/favorites.json</code>. They
        are not an account. Folders can sit inside other folders. Rename, move, and remove them
        here. Drag a folder to nest it, move it back to the top, or reorder it. The middle of a
        row nests it, and the top or bottom edge places it before or after that folder. Deleting a
        folder keeps its bookmarks and the folders inside it, and moves them up to that folder's
        parent. A missing file can be removed. A rename or move inside NerdGram
        updates the bookmark.
      </p>
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <p className="file-name-hint">{notice}</p> : null}
      {loading ? <p>Loading bookmarks…</p> : null}
      {!loading && draft.items.length === 0 && draft.folders.length === 0 ? (
        <p className="sidebar-hint">No bookmarks yet. Use Bookmark on a diagram.</p>
      ) : null}
      <ItemList
        items={draft.items.filter((item) => item.folderId == null)}
        draft={draft}
        known={known}
        onCommit={(next) => void commit(next)}
      />
      <FolderLevel
        draft={draft}
        parentId={null}
        known={known}
        collapsed={collapsed}
        folderDrag={folderDrag}
        onToggle={(id) => {
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
        folderDraft={folderDraft}
        onFolderDraft={setFolderDraft}
        onAddFolder={addFolder}
        onCommit={(next) => void commit(next)}
      />
      {folderDraft && folderDraft.parentId == null ? (
        <FolderNameForm
          label="New bookmark folder name"
          value={folderDraft.name}
          onChange={(name) => setFolderDraft({ parentId: null, name })}
          onCancel={() => setFolderDraft(null)}
          onSubmit={() => addFolder(null, folderDraft.name)}
        />
      ) : (
        <p>
          <button type="button" className="btn btn-ghost" onClick={() => setFolderDraft({ parentId: null, name: "" })}>
            New folder
          </button>
        </p>
      )}
    </section>
  );
}

function newFolderId(): string {
  return `f${Math.random().toString(16).slice(2, 10)}`;
}

type FolderDrag = ReturnType<typeof useBookmarkFolderDrag>;

function FolderLevel({
  draft,
  parentId,
  known,
  collapsed,
  folderDrag,
  onToggle,
  folderDraft,
  onFolderDraft,
  onAddFolder,
  onCommit,
}: {
  draft: BookmarkState;
  parentId: string | null;
  known: Set<string>;
  collapsed: Set<string>;
  folderDrag: FolderDrag;
  onToggle: (id: string) => void;
  folderDraft: { parentId: string | null; name: string } | null;
  onFolderDraft: (draft: { parentId: string | null; name: string } | null) => void;
  onAddFolder: (parentId: string | null, name: string) => void;
  onCommit: (next: BookmarkState) => void;
}) {
  const folders = draft.folders.filter((folder) => folderParentId(folder) === parentId);
  if (folders.length === 0) return null;
  return (
    <ul className={parentId ? "bookmark-manage-list tree-children" : "bookmark-manage-list"}>
      {folders.map((folder) => (
        <FolderBlock
          key={folder.id}
          folder={folder}
          draft={draft}
          known={known}
          collapsed={collapsed}
          folderDrag={folderDrag}
          onToggle={onToggle}
          folderDraft={folderDraft}
          onFolderDraft={onFolderDraft}
          onAddFolder={onAddFolder}
          onCommit={onCommit}
        />
      ))}
      {folderDrag.end(parentId) ? <li className="bookmark-insert" aria-hidden="true" /> : null}
    </ul>
  );
}

function FolderBlock({
  folder,
  draft,
  known,
  collapsed,
  folderDrag,
  onToggle,
  folderDraft,
  onFolderDraft,
  onAddFolder,
  onCommit,
}: {
  folder: BookmarkFolder;
  draft: BookmarkState;
  known: Set<string>;
  collapsed: Set<string>;
  folderDrag: FolderDrag;
  onToggle: (id: string) => void;
  folderDraft: { parentId: string | null; name: string } | null;
  onFolderDraft: (draft: { parentId: string | null; name: string } | null) => void;
  onAddFolder: (parentId: string | null, name: string) => void;
  onCommit: (next: BookmarkState) => void;
}) {
  const open = !collapsed.has(folder.id);
  const items = draft.items.filter((item) => item.folderId === folder.id);
  const drafting = folderDraft?.parentId === folder.id;
  const band = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return folderDropBand(event.clientY, rect.top, rect.height);
  };
  return (
    <li
      className={`bookmark-folder${folderDrag.inside(folder.id) ? " is-drop-over" : ""}`}
      data-folder-id={folder.id}
      onDragOver={(event) => folderDrag.hover(event, folder.id, "inside")}
      onDrop={(event) => folderDrag.drop(event, folder.id, "inside")}
    >
      {folderDrag.before(folder.id) ? <div className="bookmark-insert" aria-hidden="true" /> : null}
      <div
        className="sidebar-row"
        draggable
        data-bookmark-folder={folder.id}
        onDragStart={(event) => folderDrag.onDragStart(event, folder.id)}
        onDragEnd={folderDrag.onDragEnd}
        onDragOver={(event) => folderDrag.hover(event, folder.id, band(event))}
        onDrop={(event) => folderDrag.drop(event, folder.id, band(event))}
      >
        <span className="bookmark-drag-handle" aria-label={`Drag folder ${folder.name}`} title="Drag to move">
          ::
        </span>
        <button
          type="button"
          className="tree-chevron"
          aria-expanded={open}
          aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          onClick={() => onToggle(folder.id)}
        />
        <label className="visually-hidden" htmlFor={`folder-${folder.id}`}>
          Folder {folder.name}
        </label>
        <input
          id={`folder-${folder.id}`}
          defaultValue={folder.name}
          key={`${folder.id}:${folder.name}`}
          aria-label={`Rename folder ${folder.name}`}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (!next || next === folder.name) return;
            onCommit(renameBookmarkFolder(draft, folder.id, next));
          }}
        />
        <label className="visually-hidden" htmlFor={`move-folder-${folder.id}`}>
          Move {folder.name}
        </label>
        <select
          id={`move-folder-${folder.id}`}
          aria-label={`Move folder ${folder.name}`}
          value={folderParentId(folder) ?? ""}
          onChange={(event) => {
            const parentId = event.target.value || null;
            onCommit(moveBookmarkFolder(draft, folder.id, parentId));
          }}
        >
          <option value="">Top level</option>
          {bookmarkFolderChoices(draft.folders, folder.id).map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost" onClick={() => onFolderDraft({ parentId: folder.id, name: "" })}>
          New subfolder
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onCommit(deleteBookmarkFolder(draft, folder.id))}>
          Delete folder
        </button>
      </div>
      {open ? (
        <>
          {drafting ? (
            <FolderNameForm
              label={`New subfolder in ${folder.name}`}
              value={folderDraft.name}
              onChange={(name) => onFolderDraft({ parentId: folder.id, name })}
              onCancel={() => onFolderDraft(null)}
              onSubmit={() => onAddFolder(folder.id, folderDraft.name)}
            />
          ) : null}
          <ItemList items={items} draft={draft} known={known} onCommit={onCommit} />
          <FolderLevel
            draft={draft}
            parentId={folder.id}
            known={known}
            collapsed={collapsed}
            folderDrag={folderDrag}
            onToggle={onToggle}
            folderDraft={folderDraft}
            onFolderDraft={onFolderDraft}
            onAddFolder={onAddFolder}
            onCommit={onCommit}
          />
        </>
      ) : null}
    </li>
  );
}

function ItemList({
  items,
  draft,
  known,
  onCommit,
}: {
  items: BookmarkItem[];
  draft: BookmarkState;
  known: Set<string>;
  onCommit: (next: BookmarkState) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="bookmark-manage-list">
      {items.map((item) => {
        const missing = !known.has(item.path);
        const name = displayName(item.path);
        return (
          <li key={item.path}>
            {missing ? (
              <span title={item.path}>
                {name} <span className="sidebar-missing">Missing</span>
              </span>
            ) : (
              <Link to={`/edit/${item.path}`} title={item.path}>
                {name}
              </Link>
            )}
            <label className="visually-hidden" htmlFor={`folder-for-${item.path}`}>
              Folder for {name}
            </label>
            <select
              id={`folder-for-${item.path}`}
              value={item.folderId ?? ""}
              aria-label={`Folder for ${name}`}
              onChange={(event) => {
                const folderId = event.target.value || null;
                onCommit(moveBookmark(draft, item.path, folderId));
              }}
            >
              <option value="">Top level</option>
              {bookmarkFolderChoices(draft.folders).map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost" onClick={() => onCommit(removeBookmark(draft, item.path))}>
              Remove
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FolderNameForm({
  label,
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  label: string;
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
      <input aria-label={label} value={value} placeholder="Folder name" autoFocus onChange={(event) => onChange(event.target.value)} />
      <button type="submit" className="btn btn-ghost">
        Add
      </button>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
