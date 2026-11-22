import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataFileExtension } from "./dataFiles.js";
import { getMetaPath } from "./paths.js";
import { trimSlashes } from "./trim.js";

export { trimChar, trimSlashes } from "./trim.js";

/**
 * Shared disk helpers for diagram writes.
 *
 * Live diagrams stay plain `.mmd` files in the data directory. Trash,
 * revision history, and editor locks live under `.meta/`, which `buildTree`
 * already skips because the name starts with a dot:
 *
 * - `.meta/trash/items/<id>/` — one soft-deleted file or folder
 * - `.meta/versions/p_<encoded-path>/` — previous contents of one diagram
 * - `.meta/locks/p_<encoded-path>.json` — single-editor lock for one path. A path whose encoded name would exceed 255 bytes uses `h_<sha256>.json` instead, and the record still stores the path. The record includes instanceId, instanceName, and hostname. Older files without those fields still read.
 * - `.meta/thumbs/p_<encoded-path>.json` — cached dashboard thumbnail SVG
 * - `.meta/search/index.json` — optional text-search cache; rebuilt from the diagrams if missing
 * - `.meta/replace/operations.json` — ids for workspace replace undo, pointing at revision ids
 * - `.meta/diagram-sightings.json` — path and content hash of diagrams already seen, used to repair click links after a rename outside the app
 * - `.meta/listen-host.json` — older Host setting. A valid value is copied once into the instance config (`~/.nerdgram/instance.json` or `NERDGRAM_INSTANCE_FILE`) when that config has no Host yet. The file is left in place and then ignored. New saves do not write it. HOST still overrides the saved Host. Git sync does not copy `.meta`
 * - `.meta/style-presets.json` — named style presets and the optional default for new diagrams. Applying a preset copies values into the `.mmd` file. The preset file is not part of a diagram.
 *
 * Move, duplicate, and import (#9) should reuse `atomicWriteText`,
 * `evaluateWrite`, and `resolveAvailablePath` instead of calling
 * `fs.writeFile` on a diagram directly. Creating a diagram from a bundled
 * template (#17) uses the same helpers. GitHub sync (#14) copies `.mmd`
 * files and the `.csv`, `.json`, `.network.json`, `.cdp`, and `.lldp` data files stored next to a generated
 * diagram. It does not copy `.meta` (favorites, style presets, syntax overrides, trash,
 * revisions, locks, thumbnails, the search index, or tokens). Bundled
 * templates live outside this directory, in the repo `templates/` folder,
 * and are not part of the mirror. User templates live in `.templates/`
 * under the data directory. That name starts with a dot, so the tree,
 * trash, and search skip it, and GitHub sync does not copy it.
 */

/** How many previous revisions to keep for each diagram. Newest are kept. */
export const REVISION_RETENTION = 20;

/**
 * How many named baselines each diagram keeps, in addition to
 * `REVISION_RETENTION`. Named baselines are not dropped by that limit.
 * `NERDGRAM_BASELINE_CAP` overrides this with a whole number from 1 to 200.
 */
export const BASELINE_CAP = 20;

/**
 * Writable editors heartbeat on this interval. The server tells the client
 * the same value on acquire so the two sides do not drift.
 */
export const LOCK_HEARTBEAT_MS = 15_000;

/**
 * A lock whose heartbeat is older than this can be taken by another editor.
 * This is longer than the heartbeat so a background browser tab, which may
 * throttle timers, can miss a beat without losing the diagram.
 */
export const LOCK_STALE_MS = 90_000;

/** mtime values within this many milliseconds count as the same observation. */
export const MTIME_MATCH_TOLERANCE_MS = 1;

export const TRASH_DIR_NAME = "trash";
export const VERSIONS_DIR_NAME = "versions";
export const LOCKS_DIR_NAME = "locks";

export function getTrashRoot(): string {
  return path.join(getMetaPath(), TRASH_DIR_NAME);
}

export function getVersionsRoot(): string {
  return path.join(getMetaPath(), VERSIONS_DIR_NAME);
}

export function getLocksRoot(): string {
  return path.join(getMetaPath(), LOCKS_DIR_NAME);
}

export function normalizeRelative(input: string): string {
  return trimSlashes(input.replace(/\\/g, "/"));
}

/**
 * One file name directly inside `root`. A name with a separator, `.`, or
 * `..` is rejected, and the resolved path has to stay in that directory.
 */
export function resolveUnder(root: string, fileName: string): string {
  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("\0") ||
    fileName === "." ||
    fileName === ".."
  ) {
    throw httpFail(400, "Invalid template id", "invalid");
  }
  const base = path.resolve(root);
  const full = path.resolve(base, fileName);
  if (!full.startsWith(base + path.sep) || path.dirname(full) !== base) {
    throw httpFail(400, "Invalid template id", "invalid");
  }
  return full;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function createId(): string {
  return `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
}

export function assertSafeId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(id)) {
    throw httpFail(400, "Invalid id", "invalid");
  }
}

/** One path segment, reversible, and safe as a file or directory name. */
export function encodeStorageKey(relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized.includes("\0")) {
    throw httpFail(400, "Invalid path", "invalid");
  }
  return `p_${encodeURIComponent(normalized)}`;
}

/**
 * A storage filename that fits in 255 bytes. Short paths keep the reversible
 * `p_` key. Longer paths use `h_` plus a sha256 of the path. `suffix` is the
 * extra the caller appends, such as `.json`, and is counted in the limit.
 */
export function safeStorageKey(relativePath: string, suffix = ""): string {
  const encoded = encodeStorageKey(relativePath);
  if (Buffer.byteLength(`${encoded}${suffix}`) <= 255) return encoded;
  const digest = createHash("sha256").update(normalizeRelative(relativePath), "utf8").digest("hex");
  return `h_${digest}`;
}

export function decodeStorageKey(key: string): string | null {
  if (!key.startsWith("p_")) return null;
  try {
    const decoded = decodeURIComponent(key.slice(2));
    if (!decoded || decoded.includes("\0") || decoded.startsWith("/")) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function mtimeMatches(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= MTIME_MATCH_TOLERANCE_MS;
}

export function httpFail(
  status: number,
  message: string,
  code: string,
  details?: Record<string, unknown>,
): Error {
  return Object.assign(new Error(message), { status, code, details });
}

export type DiskState =
  | { exists: false }
  | {
      exists: true;
      content: string;
      mtimeMs: number;
      size: number;
      hash: string;
    };

export type WriteBaseline = {
  expectedMtimeMs?: number | null;
  expectedHash?: string | null;
  force?: boolean;
};

export type WriteIntent = WriteBaseline & {
  content: string;
};

export type WriteDecision =
  | { action: "create" }
  | { action: "unchanged" }
  | { action: "overwrite" }
  | { action: "reject"; code: "missing" | "conflict" | "exists" };

/**
 * Decide whether a write may replace a diagram.
 *
 * A hash match means the bytes the editor last saw are still the bytes on
 * disk, so a drifted mtime is not a conflict. A hash mismatch is a conflict
 * even when mtime still matches. Sending neither baseline on an existing
 * file is refused: creates are the only writes that may omit it.
 * Identical bytes are a no-op so a retry cannot move mtime or grow history.
 */
export function evaluateWrite(disk: DiskState, intent: WriteIntent): WriteDecision {
  const hasBaseline =
    typeof intent.expectedMtimeMs === "number" ||
    (typeof intent.expectedHash === "string" && intent.expectedHash.length > 0);

  if (!disk.exists) {
    if (hasBaseline && !intent.force) return { action: "reject", code: "missing" };
    return { action: "create" };
  }

  if (hashContent(intent.content) === disk.hash) return { action: "unchanged" };
  if (intent.force) return { action: "overwrite" };
  if (!hasBaseline) return { action: "reject", code: "exists" };

  if (typeof intent.expectedHash === "string" && intent.expectedHash.length > 0) {
    if (intent.expectedHash !== disk.hash) return { action: "reject", code: "conflict" };
    return { action: "overwrite" };
  }

  if (
    typeof intent.expectedMtimeMs === "number" &&
    !mtimeMatches(disk.mtimeMs, intent.expectedMtimeMs)
  ) {
    return { action: "reject", code: "conflict" };
  }

  return { action: "overwrite" };
}

function insertSuffix(relativePath: string, suffix: string): string {
  const normalized = normalizeRelative(relativePath);
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : "";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const lower = base.toLowerCase();
  const dataExt = dataFileExtension(base);
  const renamed = lower.endsWith(".mmd")
    ? `${base.slice(0, -".mmd".length)}${suffix}.mmd`
    : dataExt
      ? `${base.slice(0, -dataExt.length)}${suffix}${base.slice(-dataExt.length)}`
      : `${base}${suffix}`;
  return dir ? `${dir}/${renamed}` : renamed;
}

/**
 * First free path at or near `desired`.
 *
 * With `word: "copy"`, a taken `Notes.mmd` becomes `Notes (copy).mmd`, then
 * `Notes (copy 2).mmd`. Trash restore uses `word: "restored"` the same way.
 * Without a word, the suffixes are ` 2`, ` 3`, which import uses when the
 * user chooses to rename instead of replacing.
 */
export async function resolveAvailablePath(
  desired: string,
  isTaken: (candidate: string) => boolean | Promise<boolean>,
  options?: { word?: string },
): Promise<string> {
  if (!(await isTaken(desired))) return desired;
  const word = options?.word;
  const start = word ? 1 : 2;
  for (let n = start; n < 1000; n += 1) {
    const suffix = word ? (n === 1 ? ` (${word})` : ` (${word} ${n})`) : ` ${n}`;
    const candidate = insertSuffix(desired, suffix);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw httpFail(409, "No free path is available", "collision", { path: desired });
}

export function rewriteMovedPath(
  itemPath: string,
  fromPath: string,
  toPath: string,
  isDir: boolean,
): string {
  const item = normalizeRelative(itemPath);
  const from = normalizeRelative(fromPath);
  const to = normalizeRelative(toPath);
  if (item === from) return to;
  if (isDir && item.startsWith(`${from}/`)) return `${to}${item.slice(from.length)}`;
  return item;
}

async function replaceFile(tmp: string, dest: string): Promise<void> {
  try {
    await fs.rename(tmp, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Windows refuses to rename onto an existing file.
    if (code !== "EEXIST" && code !== "EPERM") throw err;
    await fs.rm(dest, { force: true });
    await fs.rename(tmp, dest);
  }
}

/** Write a file by renaming a temp file into place. Callers on the same disk get an atomic replace. */
export async function atomicWriteText(absolutePath: string, content: string): Promise<void> {
  const dir = path.dirname(absolutePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.ng-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await fs.writeFile(tmp, content, "utf8");
    await replaceFile(tmp, absolutePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function atomicWriteJson(absolutePath: string, value: unknown): Promise<void> {
  await atomicWriteText(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile<T>(absolutePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absolutePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.stat(absolutePath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}
