import type { TreeNode } from "../types";
import { displayName } from "./paths";

/** File name is the primary label. A different front matter title is a second line. */
export function diagramCardLabel(
  path: string,
  title: string | null | undefined,
): { name: string; subtitle: string | null } {
  const name = displayName(path);
  const subtitle = title?.trim() ?? "";
  if (!subtitle || subtitle === name) return { name, subtitle: null };
  return { name, subtitle };
}

/** Direct children only. A zero folder count is omitted. */
export function folderCountLabel(node: Pick<TreeNode, "children">): string {
  const children = node.children ?? [];
  const diagrams = children.filter((child) => child.type === "file").length;
  const folders = children.filter((child) => child.type === "folder").length;
  const diagramLabel = `${diagrams} diagram${diagrams === 1 ? "" : "s"}`;
  if (folders === 0) return diagramLabel;
  const folderLabel = `${folders} folder${folders === 1 ? "" : "s"}`;
  return `${diagramLabel} · ${folderLabel}`;
}
