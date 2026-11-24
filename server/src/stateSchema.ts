import fs from "node:fs/promises";
import path from "node:path";
import { getMetaPath } from "./paths.js";

/** Current app-state schema. Legacy files have no schemaVersion and are version 0. */
export const CURRENT_SCHEMA = 1;

const BACKUP_KEEP = 3;

export type StateContract = {
  id: string;
  current: number;
  matches: (name: string) => boolean;
  /** One step, from `from` to `from + 1`. */
  migrate: (value: unknown, from: number) => unknown;
};

/** Add schemaVersion and leave the old `version` field alone. That field is the legacy format. */
function stampStep(value: unknown, from: number): unknown {
  if (from !== 0) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return { ...(value as Record<string, unknown>), schemaVersion: CURRENT_SCHEMA };
}

function contract(id: string, matches: (name: string) => boolean): StateContract {
  return { id, current: CURRENT_SCHEMA, matches, migrate: stampStep };
}

export const STATE_CONTRACTS: StateContract[] = [
  contract("updates.json", (name) => name === "updates.json"),
  contract("api-tokens.json", (name) => name === "api-tokens.json"),
  contract("style-presets.json", (name) => name === "style-presets.json"),
  contract("favorites.json", (name) => name === "favorites.json"),
  contract("github-sync.json", (name) => name === "github-sync.json"),
  contract("replace/operations.json", (name) => name === "replace/operations.json"),
  contract("versions/index.json", (name) => name === "versions/index.json" || name.endsWith("/index.json")),
  contract("trash/manifest.json", (name) => name.startsWith("trash/") && name.endsWith("/manifest.json")),
  contract("locks", (name) => name === "locks" || name.startsWith("locks/")),
];

export function contractFor(name: string): StateContract | null {
  return STATE_CONTRACTS.find((item) => item.matches(name)) ?? null;
}

/** 0 is legacy. Null means the value is not an object, so schema does not apply. */
export function schemaVersionOf(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as { schemaVersion?: unknown }).schemaVersion;
  if (raw == null) return 0;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return 0;
  return raw;
}

export function migrateToCurrent(contract: StateContract, value: unknown, from: number): unknown {
  let next = value;
  for (let version = from; version < contract.current; version += 1) {
    next = contract.migrate(next, version);
  }
  return next;
}

const newerSchemaPaths = new Set<string>();
const backupDirByVersion = new Map<number, string>();

export function resetSchemaForTests(): void {
  newerSchemaPaths.clear();
  backupDirByVersion.clear();
}

export function noteNewerSchema(file: string): void {
  newerSchemaPaths.add(path.resolve(file));
}

export function clearNewerSchema(file: string): void {
  newerSchemaPaths.delete(path.resolve(file));
}

export function isNewerSchemaPath(file: string): boolean {
  return newerSchemaPaths.has(path.resolve(file));
}

export function isManagedStatePath(absolutePath: string): boolean {
  const rel = metaRelative(absolutePath);
  if (!rel) return false;
  return contractFor(rel) != null;
}

export function stampSchemaValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const version = schemaVersionOf(value);
  if (version != null && version > CURRENT_SCHEMA) return value;
  if (version === CURRENT_SCHEMA) return value;
  return { ...(value as Record<string, unknown>), schemaVersion: CURRENT_SCHEMA };
}

function metaRelative(absolutePath: string): string | null {
  const meta = getMetaPath();
  const resolved = path.resolve(absolutePath);
  const prefix = meta.endsWith(path.sep) ? meta : `${meta}${path.sep}`;
  if (!resolved.startsWith(prefix)) return null;
  const rel = resolved.slice(prefix.length);
  if (!rel || rel.includes("..") || rel.endsWith(".mmd")) return null;
  if (rel.startsWith(`quarantine${path.sep}`) || rel.startsWith(`backups${path.sep}`)) return null;
  return rel;
}

/** Copy one state file before it is migrated. Diagrams are not copied. The last 3 backups stay. */
export async function backupStateFile(file: string, fromVersion: number): Promise<void> {
  const rel = metaRelative(file);
  if (!rel) return;
  let dir = backupDirByVersion.get(fromVersion);
  if (!dir) {
    dir = path.join(getMetaPath(), "backups", `${fromVersion}-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    backupDirByVersion.set(fromVersion, dir);
    await pruneBackups();
  }
  const dest = path.join(dir, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(file, dest);
}

async function pruneBackups(): Promise<void> {
  const root = path.join(getMetaPath(), "backups");
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch {
    return;
  }
  const dirs: string[] = [];
  for (const name of names) {
    const full = path.join(root, name);
    try {
      if ((await fs.stat(full)).isDirectory()) dirs.push(name);
    } catch {
      continue;
    }
  }
  dirs.sort();
  const extra = dirs.slice(0, Math.max(0, dirs.length - BACKUP_KEEP));
  for (const name of extra) {
    await fs.rm(path.join(root, name), { recursive: true, force: true });
  }
}
