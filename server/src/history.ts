import fs from "node:fs/promises";
import path from "node:path";
import {
  BASELINE_CAP,
  REVISION_RETENTION,
  assertSafeId,
  atomicWriteJson,
  atomicWriteText,
  createId,
  decodeStorageKey,
  encodeStorageKey,
  getVersionsRoot,
  httpFail,
  normalizeRelative,
  pathExists,
  readJsonFile,
  rewriteMovedPath,
} from "./storage.js";

export type RevisionMeta = {
  id: string;
  createdAt: string;
  mtimeMs: number;
  size: number;
  hash: string;
  /** Set when this revision is a named baseline. Absent on older history. */
  name?: string;
  note?: string;
  namedAt?: string;
};

export type PublicRevision = {
  id: string;
  createdAt: string;
  mtimeMs: number;
  size: number;
  hash: string;
  name: string | null;
  note: string | null;
  namedAt: string | null;
};

const NAME_MAX = 120;
const NOTE_MAX = 500;
const RESERVED_NAMES = new Set(["current"]);

type RevisionIndex = {
  path: string;
  revisions: RevisionMeta[];
};

function versionDirFor(relativePath: string): string {
  return path.join(getVersionsRoot(), encodeStorageKey(relativePath));
}

function indexPath(dir: string): string {
  return path.join(dir, "index.json");
}

async function loadIndex(dir: string, fallbackPath: string): Promise<RevisionIndex> {
  const parsed = await readJsonFile<RevisionIndex>(indexPath(dir));
  if (!parsed || !Array.isArray(parsed.revisions)) {
    return { path: fallbackPath, revisions: [] };
  }
  return {
    path: typeof parsed.path === "string" ? parsed.path : fallbackPath,
    revisions: parsed.revisions.flatMap((revision) => {
      const meta = readRevisionMeta(revision);
      return meta ? [meta] : [];
    }),
  };
}

function readRevisionMeta(value: unknown): RevisionMeta | null {
  if (!value || typeof value !== "object") return null;
  const revision = value as Partial<RevisionMeta>;
  if (
    typeof revision.id !== "string" ||
    typeof revision.createdAt !== "string" ||
    typeof revision.mtimeMs !== "number" ||
    typeof revision.size !== "number" ||
    typeof revision.hash !== "string"
  ) {
    return null;
  }
  const meta: RevisionMeta = {
    id: revision.id,
    createdAt: revision.createdAt,
    mtimeMs: revision.mtimeMs,
    size: revision.size,
    hash: revision.hash,
  };
  if (typeof revision.name === "string" && revision.name.trim()) meta.name = revision.name;
  if (typeof revision.note === "string" && revision.note.trim()) meta.note = revision.note;
  if (typeof revision.namedAt === "string" && revision.namedAt.trim()) meta.namedAt = revision.namedAt;
  return meta;
}

export function isNamedRevision(revision: RevisionMeta): boolean {
  return typeof revision.name === "string" && revision.name.trim().length > 0;
}

export function publicRevision(revision: RevisionMeta): PublicRevision {
  return {
    id: revision.id,
    createdAt: revision.createdAt,
    mtimeMs: revision.mtimeMs,
    size: revision.size,
    hash: revision.hash,
    name: revision.name ?? null,
    note: revision.note ?? null,
    namedAt: revision.namedAt ?? null,
  };
}

/** Configured named-baseline cap. Invalid values keep the default of 20. */
export function baselineCap(): number {
  const raw = process.env.NERDGRAM_BASELINE_CAP;
  if (raw == null || raw.trim() === "") return BASELINE_CAP;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 200) return BASELINE_CAP;
  return value;
}

async function saveIndex(dir: string, index: RevisionIndex): Promise<void> {
  await atomicWriteJson(indexPath(dir), index);
}

async function prune(dir: string, index: RevisionIndex): Promise<void> {
  // Named baselines stay. Only unnamed revisions are limited to the newest
  // REVISION_RETENTION. Equal timestamps keep append order (sort is stable)
  // so a burst of saves still drops the earliest unnamed ones.
  const named = index.revisions.filter((revision) => isNamedRevision(revision));
  const unnamed = index.revisions.filter((revision) => !isNamedRevision(revision));
  unnamed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (unnamed.length > REVISION_RETENTION) {
    const dropped = unnamed.shift();
    if (!dropped) break;
    await fs.rm(path.join(dir, `${dropped.id}.mmd`), { force: true });
  }
  index.revisions = [...named, ...unnamed];
}

/**
 * Store the bytes that are about to be replaced. The new bytes stay in the
 * live `.mmd` file, so history is the previous saves, not a second copy of
 * the current one.
 */
export async function snapshotPrevious(
  relativePath: string,
  previous: { content: string; mtimeMs: number; size: number; hash: string },
): Promise<string> {
  const normalized = normalizeRelative(relativePath);
  const dir = versionDirFor(normalized);
  await fs.mkdir(dir, { recursive: true });
  const index = await loadIndex(dir, normalized);
  const id = createId();
  await atomicWriteText(path.join(dir, `${id}.mmd`), previous.content);
  index.path = normalized;
  index.revisions.push({
    id,
    createdAt: new Date().toISOString(),
    mtimeMs: previous.mtimeMs,
    size: previous.size,
    hash: previous.hash,
  });
  await prune(dir, index);
  await saveIndex(dir, index);
  return id;
}

export async function listRevisions(relativePath: string): Promise<RevisionMeta[]> {
  const dir = versionDirFor(relativePath);
  if (!(await pathExists(dir))) return [];
  const index = await loadIndex(dir, normalizeRelative(relativePath));
  return [...index.revisions].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

export function validateBaselineName(value: unknown): string {
  if (typeof value !== "string") throw httpFail(400, "name must be a string", "invalid");
  const name = value.trim();
  if (!name) throw httpFail(400, "name is required", "invalid");
  if (name.length > NAME_MAX) throw httpFail(400, `name must be ${NAME_MAX} characters or fewer`, "invalid");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw httpFail(400, "name cannot contain control characters", "invalid");
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw httpFail(400, `"${name}" is reserved. Pick another baseline name.`, "invalid");
  }
  return name;
}

export function validateBaselineNote(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw httpFail(400, "note must be a string", "invalid");
  const note = value.trim();
  if (!note) return null;
  if (note.length > NOTE_MAX) throw httpFail(400, `note must be ${NOTE_MAX} characters or fewer`, "invalid");
  if (/[\u0000-\u001f\u007f]/.test(note)) throw httpFail(400, "note cannot contain control characters", "invalid");
  return note;
}

export async function readRevision(
  relativePath: string,
  id: string,
): Promise<RevisionMeta & { content: string }> {
  assertSafeId(id);
  const dir = versionDirFor(relativePath);
  const index = await loadIndex(dir, normalizeRelative(relativePath));
  const meta = index.revisions.find((revision) => revision.id === id);
  if (!meta) {
    throw httpFail(404, "Revision not found", "not_found");
  }
  try {
    const content = await fs.readFile(path.join(dir, `${id}.mmd`), "utf8");
    return { ...meta, content };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Revision not found", "not_found");
    throw err;
  }
}

async function matchingVersionDirs(
  relativePath: string,
  isDir: boolean,
): Promise<{ key: string; itemPath: string; dir: string }[]> {
  const root = getVersionsRoot();
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const from = normalizeRelative(relativePath);
  const matches: { key: string; itemPath: string; dir: string }[] = [];
  for (const key of names) {
    const itemPath = decodeStorageKey(key);
    if (!itemPath) continue;
    const hit = itemPath === from || (isDir && itemPath.startsWith(`${from}/`));
    if (!hit) continue;
    matches.push({ key, itemPath, dir: path.join(root, key) });
  }
  return matches;
}

async function writeMovedIndex(dir: string, nextPath: string): Promise<void> {
  const index = await loadIndex(dir, nextPath);
  index.path = nextPath;
  await saveIndex(dir, index);
}

async function moveVersionDir(fromDir: string, nextPath: string): Promise<void> {
  const dest = versionDirFor(nextPath);
  if (path.resolve(fromDir) === path.resolve(dest)) {
    await writeMovedIndex(dest, nextPath);
    return;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (await pathExists(dest)) {
    const incoming = await loadIndex(fromDir, nextPath);
    const existing = await loadIndex(dest, nextPath);
    for (const revision of incoming.revisions) {
      const source = path.join(fromDir, `${revision.id}.mmd`);
      if (await pathExists(source)) {
        await fs.rename(source, path.join(dest, `${revision.id}.mmd`));
      }
      if (!existing.revisions.some((item) => item.id === revision.id)) {
        existing.revisions.push(revision);
      }
    }
    existing.path = nextPath;
    await prune(dest, existing);
    await saveIndex(dest, existing);
    await fs.rm(fromDir, { recursive: true, force: true });
    return;
  }
  await fs.rename(fromDir, dest);
  await writeMovedIndex(dest, nextPath);
}

export async function relocateHistory(
  fromPath: string,
  toPath: string,
  isDir: boolean,
): Promise<void> {
  const matches = await matchingVersionDirs(fromPath, isDir);
  for (const match of matches) {
    const nextPath = rewriteMovedPath(match.itemPath, fromPath, toPath, isDir);
    await moveVersionDir(match.dir, nextPath);
  }
}

export async function archiveHistory(
  fromPath: string,
  isDir: boolean,
  destDir: string,
): Promise<void> {
  const matches = await matchingVersionDirs(fromPath, isDir);
  if (matches.length === 0) return;
  await fs.mkdir(destDir, { recursive: true });
  for (const match of matches) {
    const target = path.join(destDir, match.key);
    if (await pathExists(target)) continue;
    await fs.rename(match.dir, target);
  }
}

export async function unarchiveHistory(
  archiveDir: string,
  originalPath: string,
  restoredPath: string,
  isDir: boolean,
): Promise<void> {
  let names: string[] = [];
  try {
    names = await fs.readdir(archiveDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  for (const key of names) {
    const itemPath = decodeStorageKey(key);
    if (!itemPath) continue;
    const source = path.join(archiveDir, key);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const nextPath = rewriteMovedPath(itemPath, originalPath, restoredPath, isDir);
    await moveVersionDir(source, nextPath);
  }
}

function namedCount(index: RevisionIndex): number {
  return index.revisions.filter((revision) => isNamedRevision(revision)).length;
}

function assertBaselineRoom(index: RevisionIndex): void {
  const cap = baselineCap();
  const used = namedCount(index);
  if (used >= cap) {
    const noun = cap === 1 ? "named baseline" : "named baselines";
    throw httpFail(
      409,
      `This diagram already has ${cap} ${noun}. That is the limit. Remove a baseline before adding another.`,
      "baseline_limit",
      { baselineCap: cap, baselineCount: used },
    );
  }
}

function assertUniqueName(index: RevisionIndex, name: string, exceptId?: string): void {
  const clash = index.revisions.find(
    (revision) => isNamedRevision(revision) && revision.name === name && revision.id !== exceptId,
  );
  if (clash) {
    throw httpFail(409, `A baseline named "${name}" already exists on this diagram.`, "baseline_exists", {
      id: clash.id,
    });
  }
}

function applyNote(meta: RevisionMeta, note: string | null, provided: boolean): void {
  if (!provided) return;
  if (note == null) delete meta.note;
  else meta.note = note;
}

/**
 * Store the current saved bytes as a named baseline. This writes a revision
 * even when the file has not changed since the last save. The live `.mmd`
 * file is not modified.
 */
export async function captureBaseline(
  relativePath: string,
  current: { content: string; mtimeMs: number; size: number; hash: string },
  nameInput: unknown,
  noteInput: unknown,
  noteProvided: boolean,
): Promise<PublicRevision> {
  const name = validateBaselineName(nameInput);
  const note = noteProvided ? validateBaselineNote(noteInput) : null;
  const normalized = normalizeRelative(relativePath);
  const dir = versionDirFor(normalized);
  await fs.mkdir(dir, { recursive: true });
  const index = await loadIndex(dir, normalized);
  assertBaselineRoom(index);
  assertUniqueName(index, name);
  const id = createId();
  await atomicWriteText(path.join(dir, `${id}.mmd`), current.content);
  const meta: RevisionMeta = {
    id,
    createdAt: new Date().toISOString(),
    mtimeMs: current.mtimeMs,
    size: current.size,
    hash: current.hash,
    name,
    namedAt: new Date().toISOString(),
  };
  if (note) meta.note = note;
  index.path = normalized;
  index.revisions.push(meta);
  await prune(dir, index);
  await saveIndex(dir, index);
  return publicRevision(meta);
}

/** Give an existing revision a name, or rename it. Does not copy the bytes. */
export async function nameRevision(
  relativePath: string,
  id: string,
  nameInput: unknown,
  noteInput: unknown,
  noteProvided: boolean,
): Promise<PublicRevision> {
  assertSafeId(id);
  const name = validateBaselineName(nameInput);
  const note = noteProvided ? validateBaselineNote(noteInput) : null;
  const normalized = normalizeRelative(relativePath);
  const dir = versionDirFor(normalized);
  const index = await loadIndex(dir, normalized);
  const meta = index.revisions.find((revision) => revision.id === id);
  if (!meta) throw httpFail(404, "Revision not found", "not_found");
  if (!isNamedRevision(meta)) assertBaselineRoom(index);
  assertUniqueName(index, name, id);
  meta.name = name;
  meta.namedAt = meta.namedAt ?? new Date().toISOString();
  applyNote(meta, note, noteProvided);
  index.path = normalized;
  await saveIndex(dir, index);
  return publicRevision(meta);
}

export async function updateBaseline(
  relativePath: string,
  id: string,
  patch: { name?: unknown; note?: unknown },
  fields: { name: boolean; note: boolean },
): Promise<PublicRevision> {
  assertSafeId(id);
  if (!fields.name && !fields.note) throw httpFail(400, "name or note is required", "invalid");
  const normalized = normalizeRelative(relativePath);
  const dir = versionDirFor(normalized);
  const index = await loadIndex(dir, normalized);
  const meta = index.revisions.find((revision) => revision.id === id);
  if (!meta) throw httpFail(404, "Revision not found", "not_found");
  if (!isNamedRevision(meta) && !fields.name) {
    throw httpFail(404, "That revision is not a baseline", "not_found");
  }
  if (fields.name) {
    const name = validateBaselineName(patch.name);
    if (!isNamedRevision(meta)) assertBaselineRoom(index);
    assertUniqueName(index, name, id);
    meta.name = name;
    meta.namedAt = meta.namedAt ?? new Date().toISOString();
  }
  if (fields.note) applyNote(meta, validateBaselineNote(patch.note), true);
  index.path = normalized;
  await saveIndex(dir, index);
  return publicRevision(meta);
}

/**
 * Remove the baseline name. The revision stays, then unnamed pruning runs,
 * so an older revision can be dropped once it is no longer exempt.
 */
export async function clearBaseline(
  relativePath: string,
  id: string,
): Promise<{ revision: PublicRevision | null; pruned: boolean }> {
  assertSafeId(id);
  const normalized = normalizeRelative(relativePath);
  const dir = versionDirFor(normalized);
  const index = await loadIndex(dir, normalized);
  const meta = index.revisions.find((revision) => revision.id === id);
  if (!meta) throw httpFail(404, "Revision not found", "not_found");
  if (!isNamedRevision(meta)) throw httpFail(404, "That revision is not a baseline", "not_found");
  delete meta.name;
  delete meta.note;
  delete meta.namedAt;
  await prune(dir, index);
  await saveIndex(dir, index);
  const kept = index.revisions.find((revision) => revision.id === id);
  return { revision: kept ? publicRevision(kept) : null, pruned: !kept };
}
