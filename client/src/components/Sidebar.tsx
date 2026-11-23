import { useState } from "react";
import { Link } from "react-router-dom";
import type { DragPayload } from "../lib/drag";
import type { TreeNode } from "../types";
import { Brand } from "./Brand";
import { BookmarksSection } from "./BookmarksSection";
import { CommandsButton } from "./CommandPalette";
import { FolderTree } from "./FolderTree";
import { displayName } from "../lib/paths";
import { RECENT_OPEN_KEY } from "../lib/recent";
import { readFlag, writeFlag, type BookmarkState } from "../lib/bookmarks";
import type { RecentEntry } from "../lib/recent";

function diagramHealthLinkLabel(count: number | null): string {
  if (count == null || count <= 0) return "Diagram health";
  return `Diagram health, ${count} ${count === 1 ? "issue" : "issues"}`;
}

type SidebarProps = {
  tree: TreeNode[];
  bookmarks: BookmarkState;
  onBookmarks: (next: BookmarkState) => void;
  knownPaths: ReadonlySet<string>;
  recent: RecentEntry[];
  onClearRecent: () => void;
  /** Null until a check has run. A count is shown only when it is greater than zero. */
  attentionCount: number | null;
  currentFolder: string;
  search: string;
  onSearch: (value: string) => void;
  namesOnly?: boolean;
  onNamesOnly?: (value: boolean) => void;
  onSelectFolder: (path: string) => void;
  trashCount?: number;
  trashActive?: boolean;
  onOpenTrash?: () => void;
  dropHighlight?: { path: string; valid: boolean } | null;
  onFolderDragOver?: (path: string, event: DragPayload) => void;
  onFolderDrop?: (path: string, event: DragPayload) => void;
  onTrashDragOver?: (event: DragPayload) => void;
  onTrashDrop?: (event: DragPayload) => void;
  healthActive?: boolean;
};

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function Sidebar({
  tree,
  bookmarks,
  onBookmarks,
  knownPaths,
  recent,
  onClearRecent,
  attentionCount,
  currentFolder,
  search,
  onSearch,
  namesOnly = false,
  onNamesOnly,
  onSelectFolder,
  trashCount = 0,
  trashActive = false,
  onOpenTrash,
  dropHighlight = null,
  onFolderDragOver,
  onFolderDrop,
  onTrashDragOver,
  onTrashDrop,
  healthActive = false,
}: SidebarProps) {
  const [recentOpen, setRecentOpen] = useState(() => readFlag(browserStorage(), RECENT_OPEN_KEY, true));
  const rootDrop =
    dropHighlight?.path === ""
      ? dropHighlight.valid
        ? " drop-valid"
        : " drop-invalid"
      : "";
  const toggleRecent = () => {
    const next = !recentOpen;
    setRecentOpen(next);
    writeFlag(browserStorage(), RECENT_OPEN_KEY, next);
  };
  return (
    <aside className="sidebar">
      <Link to="/" onClick={() => onSelectFolder("")}>
        <Brand />
      </Link>

      <div className="search-box">
        <span aria-hidden="true">⌕</span>
        <input
          id="diagram-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search diagrams"
          aria-label="Search diagrams"
        />
      </div>
      <label className="search-option">
        <input
          type="checkbox"
          checked={namesOnly}
          onChange={(event) => onNamesOnly?.(event.target.checked)}
        />
        Names only
      </label>
      <CommandsButton />

      <div className="nav-section">
        <div className="nav-label">Your space</div>
        <button
          type="button"
          className={`nav-link${currentFolder === "" && !trashActive && !healthActive ? " active" : ""}${rootDrop}`}
          onClick={() => onSelectFolder("")}
          onDragOver={onFolderDragOver ? (event) => onFolderDragOver("", event) : undefined}
          onDrop={onFolderDrop ? (event) => onFolderDrop("", event) : undefined}
        >
          Dashboard
        </button>
        <section className="sidebar-block" aria-label="Recent">
          <div className="sidebar-block-head">
            <button
              type="button"
              className="tree-chevron"
              aria-expanded={recentOpen}
              aria-controls="recent-list"
              onClick={toggleRecent}
            >
              <span className="visually-hidden">{recentOpen ? "Collapse recent" : "Expand recent"}</span>
            </button>
            <span className="sidebar-block-title">Recent</span>
            {recent.length > 0 ? (
              <button type="button" className="tree-collapse-all" onClick={onClearRecent}>
                Clear
              </button>
            ) : null}
          </div>
          {recentOpen ? (
            <div id="recent-list" className="sidebar-block-body">
              {recent.length === 0 ? (
                <p className="sidebar-hint">Diagrams you open show up here.</p>
              ) : (
                <ul className="sidebar-rows">
                  {recent.map((item) => (
                    <li key={item.path}>
                      <Link
                        className="sidebar-row-label"
                        to={`/edit/${item.path}`}
                        title={displayName(item.path) === item.path ? item.path : `${displayName(item.path)} (${item.path})`}
                      >
                        {displayName(item.path)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>
        <BookmarksSection state={bookmarks} knownPaths={knownPaths} onChange={onBookmarks} />
        <Link className="nav-link" to="/templates">
          Template gallery
        </Link>
        <Link
          className={`nav-link nav-link-health${healthActive ? " active" : ""}`}
          to="/health"
          aria-label={diagramHealthLinkLabel(attentionCount)}
        >
          Diagram health
          {attentionCount != null && attentionCount > 0 ? (
            <span className="attention-badge" aria-hidden="true">{` (${attentionCount})`}</span>
          ) : null}
        </Link>
        <Link className="nav-link" to="/reference" target="_blank" rel="noopener">
          Syntax reference
        </Link>
        <Link className="nav-link" to="/settings">
          Settings
        </Link>
        <button
          type="button"
          className={`nav-link${trashActive ? " active" : ""}`}
          onClick={() => onOpenTrash?.()}
          onDragOver={onTrashDragOver}
          onDrop={onTrashDrop}
        >
          Trash{trashCount > 0 ? ` (${trashCount})` : ""}
        </button>
        <FolderTree
          nodes={tree}
          currentPath={currentFolder}
          onSelectFolder={onSelectFolder}
          dropHighlight={dropHighlight}
          onFolderDragOver={onFolderDragOver}
          onFolderDrop={onFolderDrop}
        />
      </div>

    </aside>
  );
}
