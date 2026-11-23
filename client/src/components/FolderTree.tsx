import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { DragPayload } from "../lib/drag";
import { readFlag, writeFlag } from "../lib/bookmarks";
import {
  collapseAllFolders,
  countFolders,
  expandAllFolders,
  expandAncestors,
  FOLDERS_OPEN_KEY,
  hasSubfolders,
  readCollapsedFolders,
  toggleCollapsed,
  writeCollapsedFolders,
} from "../lib/folderTreeState";
import type { TreeNode } from "../types";

type FolderTreeProps = {
  nodes: TreeNode[];
  currentPath: string;
  onSelectFolder: (path: string) => void;
  onNewFolder?: () => void;
  dropHighlight?: { path: string; valid: boolean } | null;
  onFolderDragOver?: (path: string, event: DragPayload) => void;
  onFolderDrop?: (path: string, event: DragPayload) => void;
};

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function FolderTree({
  nodes,
  currentPath,
  onSelectFolder,
  onNewFolder,
  dropHighlight = null,
  onFolderDragOver,
  onFolderDrop,
}: FolderTreeProps) {
  const [stored, setStored] = useState<Set<string>>(() => readCollapsedFolders(window.localStorage));
  const [foldersOpen, setFoldersOpen] = useState(() => readFlag(browserStorage(), FOLDERS_OPEN_KEY, true));
  const collapsed = useMemo(() => expandAncestors(stored, currentPath), [stored, currentPath]);

  useEffect(() => {
    writeCollapsedFolders(window.localStorage, collapsed);
  }, [collapsed]);

  const folderCount = countFolders(nodes);
  const nested = nodes.some((node) => node.type === "folder" && hasSubfolders(node));
  const expandDisabled = collapsed.size === 0;
  const fullyCollapsed = collapseAllFolders(nodes, currentPath);
  const collapseDisabled = fullyCollapsed.size === collapsed.size && [...fullyCollapsed].every((path) => collapsed.has(path));
  const toggleFolders = () => {
    const next = !foldersOpen;
    setFoldersOpen(next);
    writeFlag(browserStorage(), FOLDERS_OPEN_KEY, next);
  };

  if (folderCount === 0) return null;

  return (
    <section className="folders-section" aria-labelledby="folders-heading">
      <div className="folders-head">
        <button
          type="button"
          className="tree-chevron"
          aria-expanded={foldersOpen}
          aria-controls="folder-tree"
          onClick={toggleFolders}
        >
          <span className="visually-hidden">{foldersOpen ? "Collapse folders" : "Expand folders"}</span>
        </button>
        <span className="folder-glyph" aria-hidden="true" />
        <span id="folders-heading" className="folders-title">
          <span className="folders-word">Folders</span>
          <span className="folders-count">{folderCount}</span>
        </span>
        {onNewFolder ? (
          <button type="button" className="folders-add" aria-label="New folder" title="New folder" onClick={onNewFolder}>
            +
          </button>
        ) : null}
      </div>
      {foldersOpen ? (
    <div className="tree" id="folder-tree" role="region" aria-labelledby="folders-heading">
      {nested ? (
        <div className="tree-toolbar">
          <div className="tree-fold-control" role="group" aria-label="Folder tree">
            <button
              type="button"
              className="tree-fold-button"
              aria-disabled={expandDisabled}
              onClick={() => {
                if (expandDisabled) return;
                setStored(expandAllFolders());
              }}
            >
              Expand all
            </button>
            <button
              type="button"
              className="tree-fold-button"
              aria-disabled={collapseDisabled}
              onClick={() => {
                if (collapseDisabled) return;
                setStored(collapseAllFolders(nodes, currentPath));
              }}
            >
              Collapse all
            </button>
          </div>
        </div>
      ) : null}
      <FolderLevel
        nodes={nodes}
        currentPath={currentPath}
        onSelectFolder={onSelectFolder}
        depth={0}
        collapsed={collapsed}
        onToggle={(path) => setStored((current) => toggleCollapsed(current, path))}
        dropHighlight={dropHighlight}
        onFolderDragOver={onFolderDragOver}
        onFolderDrop={onFolderDrop}
      />
    </div>
      ) : null}
    </section>
  );
}

function FolderLevel({
  nodes,
  currentPath,
  onSelectFolder,
  depth,
  collapsed,
  onToggle,
  dropHighlight,
  onFolderDragOver,
  onFolderDrop,
}: {
  nodes: TreeNode[];
  currentPath: string;
  onSelectFolder: (path: string) => void;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  dropHighlight?: { path: string; valid: boolean } | null;
  onFolderDragOver?: (path: string, event: DragPayload) => void;
  onFolderDrop?: (path: string, event: DragPayload) => void;
}) {
  const folders = nodes.filter((node) => node.type === "folder");

  return (
    <div className={depth === 0 ? "tree-level" : "tree tree-children"}>
      {folders.map((folder) => {
        const expandable = hasSubfolders(folder);
        const expanded = expandable && !collapsed.has(folder.path);
        const active = currentPath === folder.path;
        const highlighted = dropHighlight?.path === folder.path;
        const dropClass = highlighted ? (dropHighlight?.valid ? " drop-valid" : " drop-invalid") : "";
        const onArrow = (event: KeyboardEvent<HTMLButtonElement>) => {
          if (!expandable) return;
          if (event.key === "ArrowRight" && !expanded) {
            event.preventDefault();
            onToggle(folder.path);
          } else if (event.key === "ArrowLeft" && expanded) {
            event.preventDefault();
            onToggle(folder.path);
          }
        };
        return (
          <div key={folder.path}>
            <div className="tree-row">
              {expandable ? (
                <button
                  type="button"
                  className="tree-chevron"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
                  data-testid={`folder-toggle-${folder.path}`}
                  onClick={() => onToggle(folder.path)}
                  onKeyDown={onArrow}
                />
              ) : (
                <span className="tree-chevron-spacer" aria-hidden="true" />
              )}
              <button
                type="button"
                className={`tree-item${active ? " active" : ""}${dropClass}`}
                data-testid={`folder-link-${folder.path}`}
                title={folder.name}
                onClick={() => onSelectFolder(folder.path)}
                onKeyDown={onArrow}
                onDragOver={
                  onFolderDragOver ? (event) => onFolderDragOver(folder.path, event) : undefined
                }
                onDrop={onFolderDrop ? (event) => onFolderDrop(folder.path, event) : undefined}
              >
                <span className="folder-glyph" aria-hidden="true" />
                <span className="tree-label">{folder.name}</span>
              </button>
            </div>
            {expanded && folder.children ? (
              <FolderLevel
                nodes={folder.children}
                currentPath={currentPath}
                onSelectFolder={onSelectFolder}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                dropHighlight={dropHighlight}
                onFolderDragOver={onFolderDragOver}
                onFolderDrop={onFolderDrop}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
