import { colorsInDiagram, canonicalColor, type WorkspaceColor } from "./stylePresetModel.js";
import { parseDiagram } from "./frontMatter.js";
import { buildTree, readFile, type TreeNode } from "./fsStore.js";

/**
 * Font families and colors already stored on diagrams. `.meta`, including
 * trash, is skipped by `buildTree`. A value on one diagram counts once.
 * Nothing is written to disk.
 */

export type WorkspaceFont = {
  fontFamily: string;
  count: number;
};

let fontCache: { key: string; fonts: WorkspaceFont[] } | null = null;
let colorCache: { key: string; colors: WorkspaceColor[] } | null = null;

export function clearWorkspaceValueCache(): void {
  fontCache = null;
  colorCache = null;
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

async function diagramFiles(): Promise<{ key: string; files: TreeNode[] }> {
  const files = flattenFiles(await buildTree());
  const key = files.map((file) => `${file.path}\0${file.mtimeMs ?? 0}`).join("\n");
  return { key, files };
}

export async function listWorkspaceFonts(): Promise<WorkspaceFont[]> {
  const { key, files } = await diagramFiles();
  if (fontCache?.key === key) return fontCache.fonts;
  const counts = new Map<string, number>();
  for (const file of files) {
    const content = await readFile(file.path);
    const font = parseDiagram(content.content).fontFamily?.trim() ?? "";
    if (!font) continue;
    counts.set(font, (counts.get(font) ?? 0) + 1);
  }
  const fonts = [...counts.entries()]
    .map(([fontFamily, count]) => ({ fontFamily, count }))
    .sort((a, b) => b.count - a.count || a.fontFamily.localeCompare(b.fontFamily, undefined, { sensitivity: "base" }));
  fontCache = { key, fonts };
  return fonts;
}

export async function listWorkspaceColors(): Promise<WorkspaceColor[]> {
  const { key, files } = await diagramFiles();
  if (colorCache?.key === key) return colorCache.colors;
  const counts = new Map<string, number>();
  for (const file of files) {
    const content = await readFile(file.path);
    const seen = new Set<string>();
    for (const color of colorsInDiagram(parseDiagram(content.content))) {
      const canonical = canonicalColor(color);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
  }
  const colors = [...counts.entries()]
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color))
    .slice(0, 50);
  colorCache = { key, colors };
  return colors;
}
