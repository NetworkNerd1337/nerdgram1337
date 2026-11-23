import type { TreeNode } from "../types";

export const COLLAPSED_FOLDERS_KEY = "nerdgram.sidebar.collapsedFolders";
export const FOLDERS_OPEN_KEY = "nerdgram.sidebar.foldersOpen";

/** Every folder in the tree, including folders nested inside other folders. */
export function countFolders(nodes: readonly TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type !== "folder") continue;
    count += 1;
    if (node.children) count += countFolders(node.children);
  }
  return count;
}

export function ancestorFolders(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const ancestors: string[] = [];
  let built = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!part) continue;
    built = built ? `${built}/${part}` : part;
    ancestors.push(built);
  }
  return ancestors;
}

export function hasSubfolders(node: Pick<TreeNode, "children">): boolean {
  return (node.children ?? []).some((child) => child.type === "folder");
}

export function foldersWithSubfolders(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type !== "folder") continue;
      if (hasSubfolders(node)) paths.push(node.path);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}

export function readCollapsedFolders(storage: Pick<Storage, "getItem">): Set<string> {
  try {
    const raw = storage.getItem(COLLAPSED_FOLDERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0));
  } catch {
    return new Set();
  }
}

export function writeCollapsedFolders(storage: Pick<Storage, "setItem">, paths: Set<string>): void {
  const list = [...paths].sort();
  storage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(list));
}

export function toggleCollapsed(collapsed: Set<string>, path: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** Drop ancestors of the active path so that folder or diagram stays visible. */
export function expandAncestors(collapsed: Set<string>, path: string): Set<string> {
  const next = new Set(collapsed);
  let changed = false;
  for (const ancestor of ancestorFolders(path)) {
    if (next.delete(ancestor)) changed = true;
  }
  return changed ? next : collapsed;
}

/** Collapse every folder that has subfolders, then open the ancestors of the active path. */
export function collapseAllFolders(nodes: TreeNode[], activePath: string): Set<string> {
  return expandAncestors(new Set(foldersWithSubfolders(nodes)), activePath);
}

/** Open every folder. The empty set is what gets stored. */
export function expandAllFolders(): Set<string> {
  return new Set();
}
