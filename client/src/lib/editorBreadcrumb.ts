import type { TreeNode } from "../types";
import { parentPath } from "./paths";

export type BreadcrumbSegment = {
  label: string;
  /** Null for the current file, which is not a link. */
  href: string | null;
};

export type BreadcrumbItem = BreadcrumbSegment | { kind: "ellipsis"; title: string };

export function folderHref(folder: string): string {
  if (!folder) return "/";
  const params = new URLSearchParams();
  params.set("folder", folder);
  return `/?${params.toString()}`;
}

/** Folder path from the workspace root down to the diagram file name, without `.mmd`. */
export function editorBreadcrumb(filePath: string): BreadcrumbSegment[] {
  const parts = filePath.split("/").filter(Boolean);
  const file = parts.pop() ?? "";
  const name = file.replace(/\.mmd$/i, "") || "Untitled";
  const segments: BreadcrumbSegment[] = [{ label: "Local files", href: "/" }];
  let folder = "";
  for (const part of parts) {
    folder = folder ? `${folder}/${part}` : part;
    segments.push({ label: part, href: folderHref(folder) });
  }
  segments.push({ label: name, href: null });
  return segments;
}

export function fullBreadcrumbTitle(segments: BreadcrumbSegment[]): string {
  return segments.map((segment) => segment.label).join(" / ");
}

/**
 * Keep the root, then an ellipsis, then the tail, once the path is longer
 * than `max` segments. The ellipsis tooltip is the full path.
 */
export function collapseBreadcrumb(segments: BreadcrumbSegment[], max = 4): BreadcrumbItem[] {
  if (segments.length <= max) return segments;
  const full = fullBreadcrumbTitle(segments);
  const head = segments[0];
  if (!head) return segments;
  const tail = segments.slice(-(max - 2));
  return [head, { kind: "ellipsis", title: full }, ...tail];
}

/** Walk the tree and stop at the first missing folder. An empty path is the root. */
export function nearestExistingFolder(nodes: TreeNode[], folderPath: string): string {
  const parts = folderPath.split("/").filter(Boolean);
  let current = nodes;
  let built = "";
  for (const part of parts) {
    const next = current.find((node) => node.type === "folder" && node.name === part);
    if (!next) return built;
    built = built ? `${built}/${part}` : part;
    current = next.children ?? [];
  }
  return built;
}

/** Dashboard URL for the folder that holds this diagram, or the nearest parent that still exists. */
export function editorExitHref(filePath: string, nodes: TreeNode[]): string {
  return folderHref(nearestExistingFolder(nodes, parentPath(filePath)));
}
