import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataRoot, META_DIR_NAME, REPO_ROOT } from "./paths.js";

/**
 * Every `.mmd` file under `diagrams/`, including subfolders.
 * A new sample is seeded with the others. It is not a separate allow-list.
 */
export async function bundledSampleFiles(root = path.join(REPO_ROOT, "diagrams")): Promise<string[]> {
  return walkMmd(root, "");
}

async function walkMmd(dir: string, prefix: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkMmd(path.join(dir, entry.name), relative)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mmd")) {
      files.push(relative);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Copy the sample diagrams into an empty data directory.
 * A directory that already has a diagram, a folder, or saved app state is left
 * alone, so a later start does not put the samples back over diagrams the user
 * deleted. `.meta` from the startup probe does not count: probe temp files,
 * `instance-lock.json`, `backups`, and `quarantine`. A later start still
 * skips a folder that holds real app state such as `updates.json`.
 * Returns true when it copied the samples.
 */
export async function seedEmptyDataDir(): Promise<boolean> {
  const data = ensureDataRoot();
  const samples = path.join(REPO_ROOT, "diagrams");
  if (path.resolve(data) === path.resolve(samples)) return false;

  let entries: string[];
  try {
    entries = await fs.readdir(data);
  } catch (err) {
    throw permissionError(data, err);
  }
  const others = entries.filter((name) => name !== META_DIR_NAME);
  if (others.length > 0) return false;
  if (entries.includes(META_DIR_NAME) && (await metaHasSavedState(path.join(data, META_DIR_NAME)))) return false;

  let copied = 0;
  for (const relative of await bundledSampleFiles(samples)) {
    const from = path.join(samples, relative);
    try {
      await fs.access(from);
    } catch {
      continue;
    }
    const to = path.join(data, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.copyFile(from, to);
    } catch (err) {
      throw permissionError(data, err);
    }
    copied += 1;
  }
  return copied > 0;
}

const BOOT_META_FILES = new Set(["instance-lock.json", "instance-lock.json.bak"]);
const BOOT_META_DIRS = new Set(["backups", "quarantine"]);

/** Probe temps and files this process writes before the samples are copied. */
function isBootMetaName(name: string): boolean {
  if (BOOT_META_FILES.has(name) || BOOT_META_DIRS.has(name)) return true;
  if (name.startsWith(".ng-") && name.endsWith(".tmp")) return true;
  if (/^\..+\.\d+\.[a-f0-9]+\.tmp$/i.test(name)) return true;
  return false;
}

/** True when `.meta` holds something besides boot files. */
async function metaHasSavedState(meta: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await fs.readdir(meta);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
  return entries.some((name) => !isBootMetaName(name));
}

function permissionError(data: string, err: unknown): unknown {
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== "EACCES" && code !== "EPERM") return err;
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "the process user";
  return new Error(
    `Cannot write ${data} as uid ${uid}. A named volume is writable when the image creates /data as uid 1001. ` +
      `On a bind mount, chown that directory to 1001:1001 (user nerdgram in the image).`,
  );
}
