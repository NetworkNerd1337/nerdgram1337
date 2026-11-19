import { createGeneratedDiagram, importInputFromBody, refreshGeneratedDiagram, upsertGeneratedDiagram } from "../diagramDataFiles.js";
import { lintWorkspaceCached } from "../diagramLintCache.js";
import * as historyApi from "../historyApi.js";
import { lintDiagramSource } from "../mermaidSyntax.js";
import * as store from "../fsStore.js";
import { resolveSafePath } from "../paths.js";
import { createRateLimiter, renderDiagram } from "../renderDiagram.js";
import { applyReplace, previewReplace } from "../replace.js";
import * as search from "../search.js";
import { httpFail } from "../storage.js";
import fs from "node:fs/promises";
import type { GenerateArgs, McpBackend, RefreshArgs, RenderArgs } from "./backend.js";

const MAX_EXPORT_FILES = 500;
const MAX_EXPORT_CHARS = 8_000_000;

type TreeNode = { type: string; path: string; children?: TreeNode[] };

function walkFiles(nodes: TreeNode[]): TreeNode[] {
  const files: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "folder" && node.children) files.push(...walkFiles(node.children));
    else if (node.type === "file") files.push(node);
  }
  return files;
}

async function statWorkspaceFile(filePath: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.stat(resolveSafePath(filePath));
    if (!stat.isFile()) return null;
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

function oneOfPathOrSource(input: { path?: string; source?: string }, label: string): void {
  if (input.path && input.source != null) throw httpFail(400, `Send path or source, not both.`, "invalid");
  if (!input.path && input.source == null && label === "render") {
    throw httpFail(400, "path or source is required", "invalid");
  }
}

function generateBody(input: GenerateArgs): Record<string, unknown> {
  return {
    text: input.data,
    format: input.format,
    path: input.path,
    ...(input.view != null ? { view: input.view } : {}),
    ...(input.includeDown != null ? { includeDown: input.includeDown } : {}),
    ...(input.vlan != null ? { vlan: input.vlan } : {}),
    ...(input.direction != null ? { direction: input.direction } : {}),
    ...(input.groupBy != null ? { groupBy: input.groupBy } : {}),
    ...(input.localDevice != null ? { localDevice: input.localDevice } : {}),
    ...(input.title != null ? { title: input.title } : {}),
    ...(input.edgesText != null ? { edgesText: input.edgesText } : {}),
    ...(input.storeData != null ? { storeData: input.storeData } : {}),
  };
}

export function createLocalBackend(options: {
  tokenId: string;
  limiter: ReturnType<typeof createRateLimiter>;
}): McpBackend {
  const { tokenId, limiter } = options;

  return {
    list(folder) {
      return store.listFolder(folder);
    },
    search(input) {
      return search.searchDiagrams({
        q: input.q,
        namesOnly: input.names === true,
        contents: input.contents !== false,
        regex: input.regex === true,
      });
    },
    get(filePath) {
      return store.readFile(filePath);
    },
    async exportFolder(folder) {
      const files = walkFiles(await store.buildTree(folder || "."));
      if (files.length > MAX_EXPORT_FILES) throw httpFail(413, "That folder has too many diagrams to export at once.", "too_large");
      const exported: { path: string; content: string }[] = [];
      let chars = 0;
      for (const file of files) {
        const content = await store.readFile(file.path);
        chars += content.content.length;
        if (chars > MAX_EXPORT_CHARS) throw httpFail(413, "That folder is too large to export at once.", "too_large");
        exported.push({ path: content.path, content: content.content });
      }
      return { path: folder, files: exported };
    },
    async lint(input) {
      oneOfPathOrSource(input, "lint");
      const paths = walkFiles(await store.buildTree()).map((file) => file.path);
      if (input.source != null) {
        if (input.source.length > 512 * 1024) throw httpFail(400, "source is too large", "invalid");
        return { diagnostics: await lintDiagramSource(input.source, { diagramPaths: paths }) };
      }
      if (input.path) {
        const file = await store.readFile(input.path);
        return {
          path: file.path,
          diagnostics: await lintDiagramSource(file.content, { diagramPaths: paths, sourcePath: file.path }),
        };
      }
      return lintWorkspaceCached({
        files: paths.map((filePath) => ({ path: filePath })),
        stat: (filePath) => statWorkspaceFile(filePath),
        read: async (filePath) => store.readFile(filePath),
      });
    },
    async render(input: RenderArgs) {
      oneOfPathOrSource(input, "render");
      const decision = limiter.take(tokenId);
      if (!decision.ok) {
        throw httpFail(429, "Too many render requests.", "rate_limited", { retryAfterSec: decision.retryAfterSec });
      }
      const source = input.source ?? (await store.readFile(input.path || "")).content;
      const rendered = await renderDiagram({ source, format: input.format, background: input.background });
      if (input.format === "svg") return { format: "svg", svg: rendered.body.toString("utf8") };
      return { format: "png", png: rendered.body };
    },
    history(filePath) {
      return historyApi.listHistory(filePath);
    },
    diff(input) {
      return historyApi.diffHistory(input.path, input.from, input.to);
    },
    async create(input) {
      try {
        await store.readFile(input.path);
        throw httpFail(409, "A diagram already exists at that path.", "exists", { path: input.path });
      } catch (err) {
        const status = err && typeof err === "object" && "status" in err ? (err as { status: unknown }).status : undefined;
        if (status !== 404) throw err;
      }
      return store.writeFile(input.path, input.content);
    },
    put(input) {
      return store.writeFile(input.path, input.content, {
        expectedHash: input.expectedHash ?? null,
        force: input.expectedHash == null,
      });
    },
    mkdir(folder) {
      return store.createFolder(folder);
    },
    rename(input) {
      return store.renameItem(input.from, input.to, { updateLinks: input.updateLinks !== false });
    },
    move(input) {
      return store.moveItem(input.from, input.toFolder ?? "", { updateLinks: input.updateLinks !== false });
    },
    duplicate(input) {
      return store.duplicateItem(input.path, {
        copyData: input.copyData,
        to: input.to?.trim() ? input.to : undefined,
      });
    },
    async trash(input) {
      const deleted = await store.deleteItem(input.path, {
        confirmLinks: input.confirmLinks !== false,
        deleteData: input.deleteData,
      });
      return {
        path: deleted.path,
        trashed: true,
        ...(deleted.dataKept.length > 0 ? { dataKept: deleted.dataKept, message: deleted.message } : {}),
      };
    },
    generate(input) {
      const body = generateBody(input);
      return createGeneratedDiagram({
        ...importInputFromBody(body),
        path: input.path,
        storeData: input.storeData,
      });
    },
    upsert(input) {
      const body = generateBody(input);
      return upsertGeneratedDiagram({
        ...importInputFromBody(body),
        path: input.path,
        storeData: input.storeData,
      });
    },
    async refresh(input: RefreshArgs) {
      const refreshed = await refreshGeneratedDiagram({
        path: input.path,
        text: input.data,
        edgesText: input.edgesText,
        writeData: input.data != null,
      });
      const written = await store.writeFile(refreshed.path, refreshed.mermaid, { force: true });
      return { ...refreshed, saved: true, mtimeMs: written.mtimeMs, hash: written.hash };
    },
    replacePreview(input) {
      return previewReplace(input);
    },
    replaceApply(input) {
      return applyReplace(input);
    },
    baseline(input) {
      const body = { id: input.id, name: input.name, note: input.note };
      return historyApi.createBaseline(input.path, body, input.note != null);
    },
    async diagramPaths() {
      return walkFiles(await store.buildTree()).map((file) => file.path);
    },
  };
}
