import fs from "node:fs/promises";
import { DATA_MAX_CHARS, recordedSourceFile } from "./diagramData.js";
import { parentDir } from "./diagramCompanions.js";
import { resolveSafePath } from "./paths.js";
import { httpFail, normalizeRelative } from "./storage.js";
import { readFile } from "./fsStore.js";

/** Extensions this read will return. `.txt` is included only here. */
const SIDECAR_EXTENSIONS = [".network.json", ".csv", ".json", ".cdp", ".lldp", ".txt"] as const;

export function sidecarExtension(name: string): (typeof SIDECAR_EXTENSIONS)[number] | "" {
  const base = name.split("/").pop()?.toLowerCase() ?? "";
  return SIDECAR_EXTENSIONS.find((ext) => base.endsWith(ext)) ?? "";
}

/**
 * The data file named by `nerdgram.source.file` when it sits in the diagram's
 * own folder. Anything else is refused: another folder, `..`, a hidden name,
 * or an extension this read does not allow.
 */
export function sidecarPathForDiagram(diagramPath: string, recordedFile: string): string {
  const diagram = normalizeRelative(diagramPath);
  const recorded = recordedFile.replace(/\\/g, "/").trim();
  if (!recorded || recorded.includes("\0") || recorded.startsWith("/") || /^[A-Za-z]:/.test(recorded)) {
    throw httpFail(400, "That diagram does not name a data file in its own folder.", "invalid");
  }
  const normalized = normalizeRelative(recorded);
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => part.length === 0 || part === "." || part === ".." || part.startsWith("."))) {
    throw httpFail(400, "That diagram does not name a data file in its own folder.", "invalid");
  }
  if (!sidecarExtension(normalized)) {
    throw httpFail(400, "That diagram does not name a data file in its own folder.", "invalid");
  }
  if (parentDir(normalized) !== parentDir(diagram)) {
    throw httpFail(400, "That diagram does not name a data file in its own folder.", "invalid");
  }
  return normalized;
}

export async function readDiagramSidecar(diagramPath: string): Promise<{
  path: string;
  content: string;
  bytes: number;
}> {
  const diagram = await readFile(diagramPath);
  const recorded = recordedSourceFile(diagram.content);
  if (!recorded) throw httpFail(404, "This diagram has no data file.", "not_found");
  const relative = sidecarPathForDiagram(diagram.path, recorded);
  const abs = resolveSafePath(relative);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "This diagram has no data file.", "not_found");
    throw err;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw httpFail(400, "That diagram does not name a data file in its own folder.", "invalid");
  }
  if (stat.size > DATA_MAX_CHARS) {
    throw httpFail(413, "The data file is larger than 4 MiB.", "too_large");
  }
  const content = await fs.readFile(abs, "utf8");
  if (content.length > DATA_MAX_CHARS) {
    throw httpFail(413, "The data file is larger than 4 MiB.", "too_large");
  }
  return { path: relative, content, bytes: Buffer.byteLength(content) };
}
