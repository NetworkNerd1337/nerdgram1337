import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  deleteBookmarkFolder,
  moveBookmark,
  removeBookmark,
  renameBookmarkFolder,
  type BookmarkState,
} from "../lib/bookmarks";
import { displayName } from "../lib/paths";
import { flattenFiles } from "../lib/paths";
import { useWorkspace } from "../hooks/useWorkspace";

/** Settings view for every bookmark and folder. */
export function BookmarkManager() {
  const { bookmarks, saveBookmarks, tree, loading } = useWorkspace();
  const [draft, setDraft] = useState<BookmarkState>(bookmarks);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = new Set(flattenFiles(tree).map((file) => file.path));

  useEffect(() => {
    setDraft(bookmarks);
  }, [bookmarks]);

  const commit = async (next: BookmarkState) => {
    setDraft(next);
    setError(null);
    try {
      await saveBookmarks(next);
      setNotice("Bookmarks saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save bookmarks");
    }
  };

  return (
    <section className="sync-card" id="bookmarks">
      <h2>Bookmarks</h2>
      <p>
        Bookmarks are stored in this NerdGram instance, in <code>.meta/favorites.json</code>. They
        are not an account. Rename, move, and remove them here. A missing file can be removed. A
        rename or move inside NerdGram updates the bookmark.
      </p>
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <p className="file-name-hint">{notice}</p> : null}
      {loading ? <p>Loading bookmarks…</p> : null}
      {!loading && draft.items.length === 0 && draft.folders.length === 0 ? (
        <p className="sidebar-hint">No bookmarks yet. Use Bookmark on a diagram.</p>
      ) : null}
      {draft.folders.length > 0 ? (
        <ul className="bookmark-manage-list">
          {draft.folders.map((folder) => (
            <li key={folder.id}>
              <label htmlFor={`folder-${folder.id}`}>Folder</label>
              <input
                id={`folder-${folder.id}`}
                defaultValue={folder.name}
                key={`${folder.id}:${folder.name}`}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (!next || next === folder.name) return;
                  void commit(renameBookmarkFolder(bookmarks, folder.id, next));
                }}
              />
              <button type="button" className="btn btn-ghost" onClick={() => void commit(deleteBookmarkFolder(draft, folder.id))}>
                Delete folder
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="bookmark-manage-list">
        {draft.items.map((item) => {
          const missing = !known.has(item.path);
          return (
            <li key={item.path}>
              {missing ? (
                <span title={item.path}>
                  {displayName(item.path)} <span className="sidebar-missing">Missing</span>
                </span>
              ) : (
                <Link to={`/edit/${item.path}`} title={item.path}>
                  {displayName(item.path)}
                </Link>
              )}
              <label className="visually-hidden" htmlFor={`folder-for-${item.path}`}>
                Folder for {displayName(item.path)}
              </label>
              <select
                id={`folder-for-${item.path}`}
                value={item.folderId ?? ""}
                aria-label={`Folder for ${displayName(item.path)}`}
                onChange={(event) => {
                  const folderId = event.target.value || null;
                  void commit(moveBookmark(draft, item.path, folderId));
                }}
              >
                <option value="">Top level</option>
                {draft.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost" onClick={() => void commit(removeBookmark(draft, item.path))}>
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <p>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void api.bookmarks().then((fresh) => {
              setDraft(fresh);
              setNotice(null);
            });
          }}
        >
          Reload
        </button>
      </p>
    </section>
  );
}
