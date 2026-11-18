import { useState } from "react";
import { Link } from "react-router-dom";
import type { DragPayload } from "../lib/drag";
import type { TreeNode } from "../types";
import { Brand } from "./Brand";
import { BookmarksSection } from "./BookmarksSection";
import { CommandsButton } from "./CommandPalette";
import { FolderTree } from "./FolderTree";
import { useUpdate } from "./updateContext";
import { displayName } from "../lib/paths";
import { RECENT_OPEN_KEY } from "../lib/recent";
import { readFlag, writeFlag, type BookmarkState } from "../lib/bookmarks";
import { formatVersionLabel } from "../lib/versionLabel";
import type { RecentEntry } from "../lib/recent";

type SidebarProps = {
  tree: TreeNode[];
  bookmarks: BookmarkState;
  onBookmarks: (next: BookmarkState) => void;
  knownPaths: ReadonlySet<string>;
  recent: RecentEntry[];
  onClearRecent: () => void;
  attentionCount: number;
  attentionActive?: boolean;
  onOpenAttention?: () => void;
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
  attentionActive = false,
  onOpenAttention,
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
}: SidebarProps) {
  const updates = useUpdate();
  const version = updates.status
    ? formatVersionLabel(updates.status.currentVersion, updates.status.codename)
    : null;
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
          className={`nav-link${currentFolder === "" && !trashActive && !attentionActive ? " active" : ""}${rootDrop}`}
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
        <button
          type="button"
          className={`nav-link${attentionActive ? " active" : ""}`}
          onClick={() => onOpenAttention?.()}
        >
          Needs attention
          {attentionCount > 0 ? <span className="attention-badge"> ({attentionCount})</span> : null}
        </button>
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

      <div className="nav-section">
        <div className="nav-label">Templates</div>
        <Link className="nav-link" to="/templates">
          Template gallery
        </Link>
      </div>

      <div className="nav-section">
        <div className="nav-label">Settings</div>
        <Link className="nav-link" to="/settings#appearance">
          Appearance
        </Link>
        <Link className="nav-link" to="/settings#style-presets">
          Style presets
        </Link>
        <Link className="nav-link" to="/settings#host">
          Host
        </Link>
        <Link className="nav-link" to="/settings#diagram-folder">
          Diagram folder
        </Link>
        <Link className="nav-link" to="/settings#instance">
          Instance name
        </Link>
        <Link className="nav-link" to="/settings#github-sync">
          GitHub sync
        </Link>
        <Link className="nav-link" to="/settings#tokens">
          Automation tokens
        </Link>
        <Link className="nav-link" to="/settings#diagram-checks">
          Diagram checks
        </Link>
        <Link className="nav-link" to="/settings#bookmarks">
          Bookmarks
        </Link>
      </div>

      <div className="nav-section">
        <div className="nav-label">Reference</div>
        <Link className="nav-link" to="/reference" target="_blank" rel="noopener">
          Open Syntax Reference Library
        </Link>
      </div>

      <button type="button" className="sidebar-about" onClick={updates.openAbout}>
        <span>About</span>
        <span>{version ?? "version"}</span>
      </button>
    </aside>
  );
}
