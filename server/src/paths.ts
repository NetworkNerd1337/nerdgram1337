import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyStartupDataDir } from "./instanceConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: server/src -> server -> root */
export const REPO_ROOT = path.resolve(__dirname, "../..");

export function defaultDataRoot(): string {
  return path.join(REPO_ROOT, "diagrams");
}

/**
 * NERDGRAM_DATA_DIR when it is set, otherwise `<repo>/diagrams`.
 * Startup copies a saved Diagram folder into that variable first, and only
 * when the process was not already given NERDGRAM_DATA_DIR.
 */
export function getDataRoot(): string {
  applyStartupDataDir();
  const fromEnv = process.env.NERDGRAM_DATA_DIR;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv);
  }
  return defaultDataRoot();
}

export function ensureDataRoot(): string {
  const root = getDataRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Characters Windows rejects in a file or folder name, including a drive-letter colon. */
const INVALID_PATH_CHARS = /[<>:"|?*\u0000-\u001f]/;

const INVALID_PATH_MESSAGE =
  'Invalid path. A name cannot be only spaces, and it cannot include a drive letter or : \\ * ? " < > |.';

/**
 * Resolve a user-supplied relative path under the data root.
 * Throws if the path escapes the root or a segment is not a valid file name.
 */
export function resolveSafePath(relativePath: string): string {
  const root = ensureDataRoot();
  const cleaned = (relativePath || ".")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (cleaned.includes("\0")) {
    throw new Error("Invalid path");
  }

  // Dot paths are bookkeeping (.meta) or files the dashboard already hides.
  // ".." is left for the escape check below so traversal still reports as an escape.
  const hidden = cleaned
    .split("/")
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  for (const part of hidden) {
    if (part.startsWith(".")) throw new Error("Invalid path");
    if (INVALID_PATH_CHARS.test(part) || !part.trim()) throw new Error(INVALID_PATH_MESSAGE);
    const stem = part.toLowerCase().endsWith(".mmd") ? part.slice(0, -4) : part;
    if (!stem.trim()) throw new Error(INVALID_PATH_MESSAGE);
  }

  const absolute = path.resolve(root, cleaned === "" ? "." : cleaned);
  const relative = path.relative(root, absolute);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes data directory");
  }

  return absolute;
}

export function toRelativePath(absolutePath: string): string {
  const root = ensureDataRoot();
  const relative = path.relative(root, absolutePath);
  return relative.split(path.sep).join("/");
}

export const META_DIR_NAME = ".meta";
export const FAVORITES_FILE = "favorites.json";

export function getMetaPath(): string {
  return path.join(ensureDataRoot(), META_DIR_NAME);
}

export function getFavoritesPath(): string {
  return path.join(getMetaPath(), FAVORITES_FILE);
}
