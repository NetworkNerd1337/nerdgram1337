import { parseDiagram } from "./frontMatter.js";
import { buildTree, readFile, type TreeNode } from "./fsStore.js";

/**
 * Distinct tags in the workspace, with how many diagrams use each spelling.
 * `.meta` (including trash) is skipped by `buildTree`. The same spelling on
 * one diagram counts once. `Firewall` and `firewall` stay two tags, because
 * the stored text is the identity. The list is cached until a file's path or
 * modification time changes. Nothing is written to disk.
 */

export type WorkspaceTag = {
  tag: string;
  count: number;
};

let cache: { key: string; tags: WorkspaceTag[] } | null = null;

export function clearWorkspaceTagCache(): void {
  cache = null;
}

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  const files: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "folder") {
      if (node.children) files.push(...flattenFiles(node.children));
    } else {
      files.push(node);
    }
  }
  return files;
}

export async function listWorkspaceTags(): Promise<WorkspaceTag[]> {
  const files = flattenFiles(await buildTree());
  const key = files.map((file) => `${file.path}\0${file.mtimeMs ?? 0}`).join("\n");
  if (cache?.key === key) return cache.tags;

  const counts = new Map<string, number>();
  for (const file of files) {
    const content = await readFile(file.path);
    const seen = new Set<string>();
    for (const tag of parseDiagram(content.content).tags) {
      const text = tag.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }));
  cache = { key, tags };
  return tags;
}
