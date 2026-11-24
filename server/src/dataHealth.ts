import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { claimInstanceLock, currentInstanceConflict, resetInstanceLockForTests, StrictInstanceConflict, type InstanceConflict } from "./instanceLock.js";
import { ensureDataRoot, getDataRoot, getMetaPath, META_DIR_NAME } from "./paths.js";
import {
  backupStateFile,
  contractFor,
  migrateToCurrent,
  clearNewerSchema,
  noteNewerSchema,
  resetSchemaForTests,
  schemaVersionOf,
} from "./stateSchema.js";
import { httpFail, isProcessAlive } from "./storage.js";
import { getVersionInfo } from "./updates/versionInfo.js";

const WARN_FREE_BYTES = 200 * 1024 * 1024;
const DEGRADED_FREE_BYTES = 20 * 1024 * 1024;
const TEMP_MAX_AGE_MS = 10 * 60 * 1000;

export type DataStatus = "ok" | "warn" | "degraded";

export type DataIssue = {
  code: string;
  severity: "warn" | "degraded";
  message: string;
  file?: string;
};

export type { InstanceConflict };

export type QuarantineSet = {
  id: string;
  path: string;
  file: string;
  reason: string;
};

export type NameClash = {
  kind: "case" | "conflict-copy";
  paths: string[];
};

export type UpgradeBlocker = {
  code: "not-writable" | "low-space" | "instance-conflict" | "newer-schema";
  message: string;
};

export type DataHealthReport = {
  status: DataStatus;
  issues: DataIssue[];
  syncFolder: boolean;
  instanceConflict: InstanceConflict | null;
  freeBytes: number | null;
  quarantined: number;
  writable: boolean;
  tempsRemoved: number;
  dataDir: string;
  quarantineSets: QuarantineSet[];
  clashes: NameClash[];
  caseInsensitive: boolean;
  blockers: UpgradeBlocker[];
};

const issues: DataIssue[] = [];
let syncFolder = false;
let freeBytes: number | null = null;
let writable = true;
let quarantined = 0;
let tempsRemoved = 0;
let prepared: Promise<void> | null = null;
let quarantineSets: QuarantineSet[] = [];
let clashes: NameClash[] = [];
let caseInsensitive = false;
const quarantinedPaths = new Set<string>();
const QUARANTINE_KEEP = 10;

export function resetDataHealthForTests(): void {
  issues.length = 0;
  syncFolder = false;
  freeBytes = null;
  writable = true;
  quarantined = 0;
  tempsRemoved = 0;
  prepared = null;
  quarantineSets = [];
  clashes = [];
  caseInsensitive = false;
  quarantinedPaths.clear();
  resetInstanceLockForTests();
  resetSchemaForTests();
}

/** Refuse a save when the startup check already found the data folder cannot be written. */
export function assertDataWritable(): void {
  const report = dataHealthReport();
  if (report.writable) return;
  const hint =
    report.issues.find((issue) => issue.message.includes("1001:1001"))?.message ??
    report.issues.find((issue) => issue.severity === "degraded")?.message ??
    "The data folder is not writable.";
  throw httpFail(503, hint, "not_writable");
}

export function upgradeBlockers(report: Pick<DataHealthReport, "writable" | "issues" | "instanceConflict">): UpgradeBlocker[] {
  const blockers: UpgradeBlocker[] = [];
  if (!report.writable) {
    blockers.push({
      code: "not-writable",
      message: "The data folder is not writable. An upgrade cannot save its state.",
    });
  }
  if (report.issues.some((issue) => issue.code === "low-space")) {
    blockers.push({
      code: "low-space",
      message: "Free space is low. Free space before you upgrade.",
    });
  }
  if (report.instanceConflict) {
    blockers.push({
      code: "instance-conflict",
      message: "Two instances share this data folder. Stop the other one before you upgrade.",
    });
  }
  if (report.issues.some((issue) => issue.code === "newer-schema")) {
    blockers.push({
      code: "newer-schema",
      message: "A state file was written by a newer NerdGram. Upgrade to that version, or restore an older copy. The file will not be overwritten.",
    });
  }
  return blockers;
}

export function dataHealthReport(): DataHealthReport {
  const report: DataHealthReport = {
    status: statusOf(issues, writable),
    issues: issues.map((issue) => ({ ...issue })),
    syncFolder,
    instanceConflict: currentInstanceConflict(),
    freeBytes,
    quarantined,
    writable,
    tempsRemoved,
    dataDir: getDataRoot(),
    quarantineSets: quarantineSets.map((set) => ({ ...set })),
    clashes: clashes.map((clash) => ({ ...clash, paths: [...clash.paths] })),
    caseInsensitive,
    blockers: [],
  };
  report.blockers = upgradeBlockers(report);
  return report;
}

function statusOf(list: readonly DataIssue[], canWrite: boolean): DataStatus {
  if (!canWrite || list.some((issue) => issue.severity === "degraded")) return "degraded";
  if (list.length > 0) return "warn";
  return "ok";
}

export function recordDataIssue(issue: DataIssue): void {
  const key = `${issue.code}:${issue.file ?? ""}:${issue.message}`;
  if (issues.some((item) => `${item.code}:${item.file ?? ""}:${item.message}` === key)) return;
  issues.push(issue);
}

function errnoOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : "";
}

function preflightMessage(code: string): string | null {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "the process user";
  if (code === "EROFS") {
    return "The data folder is mounted read-only. NerdGram can open, but it cannot save. Remount the folder so this computer can write it.";
  }
  if (code === "EACCES" || code === "EPERM") {
    return `This process cannot write the data folder as uid ${uid}. On a Docker bind mount, chown that directory to 1001:1001 (user nerdgram in the image).`;
  }
  if (code === "ENOSPC") {
    return "The data folder is out of disk space. Free space, then start NerdGram again.";
  }
  return null;
}

async function probeWrite(meta: string): Promise<void> {
  const probe = path.join(meta, `.ng-probe-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(probe, "w");
    await handle.writeFile("ok");
    await handle.sync();
    await handle.close();
    handle = null;
    const readBack = await fs.readFile(probe, "utf8");
    if (readBack !== "ok") throw Object.assign(new Error("probe mismatch"), { code: "EIO" });
    await fs.rm(probe, { force: true });
    writable = true;
  } catch (err) {
    await handle?.close().catch(() => undefined);
    await fs.rm(probe, { force: true }).catch(() => undefined);
    writable = false;
    const code = errnoOf(err);
    recordDataIssue({
      code: code || "not-writable",
      severity: "degraded",
      message: preflightMessage(code) ?? `The data folder could not be written${code ? ` (${code})` : ""}.`,
    });
  }
}

async function readFreeBytes(dir: string): Promise<void> {
  try {
    const stats = await fs.statfs(dir);
    freeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    freeBytes = null;
    return;
  }
  const issue = classifyFreeBytes(freeBytes);
  if (!issue) return;
  if (issue.severity === "degraded") writable = false;
  recordDataIssue(issue);
}

export function classifyFreeBytes(bytes: number): DataIssue | null {
  if (bytes < DEGRADED_FREE_BYTES) {
    return {
      code: "low-space",
      severity: "degraded",
      message: "Less than 20 MB is free in the data folder. NerdGram is staying read-only until there is room to save.",
    };
  }
  if (bytes < WARN_FREE_BYTES) {
    return {
      code: "low-space",
      severity: "warn",
      message: "Less than 200 MB is free in the data folder. Free space before the folder fills up.",
    };
  }
  return null;
}

const SYNC_MARKERS = ["Mobile Documents", "CloudStorage", "Dropbox", "OneDrive", "Google Drive", "Syncthing"];

export function syncReasonForPath(dir: string): string | null {
  const normalized = dir.replaceAll("\\", "/");
  for (const marker of SYNC_MARKERS) {
    if (normalized.includes(marker)) return marker;
  }
  return null;
}

async function detectSyncFolder(dir: string): Promise<void> {
  const reasons: string[] = [];
  const fromPath = syncReasonForPath(dir);
  if (fromPath) reasons.push(fromPath);
  try {
    const mountinfo = await fs.readFile("/proc/self/mountinfo", "utf8");
    const resolved = path.resolve(dir);
    for (const line of mountinfo.split("\n")) {
      if (!line.includes(resolved) && !SYNC_MARKERS.some((marker) => line.includes(marker))) continue;
      const marker = SYNC_MARKERS.find((item) => line.includes(item));
      if (marker && !reasons.includes(marker)) reasons.push(marker);
    }
  } catch {
    // The host has no mount table. Path markers and file names still apply.
  }
  const names = await walkNames(dir);
  if (names.some((name) => name.endsWith(".icloud") || name.includes(".icloud"))) reasons.push("iCloud placeholder");
  if (names.some((name) => isConflictCopyName(name))) reasons.push("conflict copy");
  syncFolder = reasons.length > 0;
  if (!syncFolder) return;
  recordDataIssue({
    code: "sync-folder",
    severity: "warn",
    message: `This data folder looks synced or shared (${reasons.join(", ")}). Use a local folder or a Docker volume for one machine, and GitHub sync to share diagrams. See the install docs.`,
  });
}

export function isConflictCopyName(name: string): boolean {
  if (name.includes("(conflicted copy)") || name.includes("-conflict-")) return true;
  return / \d+\.[^.]+$/.test(name);
}

async function walkNames(dir: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      found.push(entry.name);
      if (entry.isDirectory() && entry.name !== "quarantine" && !entry.isSymbolicLink()) {
        pending.push(path.join(current, entry.name));
      }
    }
  }
  return found;
}

const TEMP_PATTERNS = [
  /^\.ng-(\d+)-[a-f0-9]+\.tmp$/i,
  /^\..+\.(\d+)\.[a-f0-9]+\.tmp$/i,
  /^.+\.(\d+)\.tmp$/i,
];

export function tempPid(name: string): number | null {
  if (name.endsWith(".mmd")) return null;
  for (const pattern of TEMP_PATTERNS) {
    const match = pattern.exec(name);
    if (!match?.[1]) continue;
    const pid = Number(match[1]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

export async function cleanupOrphanTemps(root = getDataRoot(), now = Date.now()): Promise<number> {
  let removed = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push(full);
        continue;
      }
      if (entry.name.endsWith(".mmd")) continue;
      const pid = tempPid(entry.name);
      if (pid == null) continue;
      let age = TEMP_MAX_AGE_MS + 1;
      try {
        const stat = await fs.lstat(full);
        age = now - stat.mtimeMs;
      } catch {
        continue;
      }
      if (age < TEMP_MAX_AGE_MS) continue;
      const ours = pid === process.pid && isProcessAlive(pid);
      if (ours) continue;
      if (pid !== process.pid || !isProcessAlive(pid)) {
        await fs.rm(full, { force: true }).catch(() => undefined);
        removed += 1;
      }
    }
  }
  tempsRemoved += removed;
  return removed;
}

export type SafeReadOptions<T> = {
  file: string;
  name: string;
  fallback: T;
  parse: (value: unknown, raw: string) => T | null;
  restore?: unknown;
};

/**
 * Read one app-state file. A missing file uses the fallback. A bad file is
 * copied under `.meta/quarantine` and the fallback is restored. The bytes of
 * the file are not put in the report.
 */
export async function safeReadState<T>(options: SafeReadOptions<T>): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(options.file, "utf8");
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT") return copyFallback(options.fallback);
    await quarantineState(options.file, options.name, `unreadable${code ? ` (${code})` : ""}`, code, null);
    await restoreFallback(options);
    return copyFallback(options.fallback);
  }
  if (raw.trim() === "") {
    await quarantineState(options.file, options.name, "empty", "", raw);
    await restoreFallback(options);
    return copyFallback(options.fallback);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    await quarantineState(options.file, options.name, "invalid JSON", "", raw);
    await restoreFallback(options);
    return copyFallback(options.fallback);
  }
  const contract = contractFor(options.name);
  const version = contract ? schemaVersionOf(parsed) : null;
  if (contract && version != null && version > contract.current) {
    noteNewerSchema(options.file);
    recordDataIssue({
      code: "newer-schema",
      severity: "warn",
      file: options.name,
      message: `${options.name} was written by a newer NerdGram (schemaVersion ${version}). It was left unchanged. Upgrade NerdGram, or restore an older copy. NerdGram is using its defaults until then.`,
    });
    return copyFallback(options.fallback);
  }
  if (contract && version != null && version < contract.current) {
    const migrated = migrateToCurrent(contract, parsed, version);
    const migratedRaw = JSON.stringify(migrated);
    const migratedValue = options.parse(migrated, migratedRaw);
    if (migratedValue != null) {
      if (writable) {
        try {
          await backupStateFile(options.file, version);
          const { atomicWriteJson } = await import("./storage.js");
          await atomicWriteJson(options.file, migrated);
        } catch (err) {
          recordDataIssue({
            code: "migrate-failed",
            severity: "degraded",
            file: options.name,
            message: `${options.name} could not be migrated (${errnoOf(err) || "error"}). The file was left unchanged.`,
          });
          return copyFallback(options.fallback);
        }
      }
      return migratedValue;
    }
  }
  const value = options.parse(parsed, raw);
  if (value == null) {
    await quarantineState(options.file, options.name, "wrong shape", "", raw);
    await restoreFallback(options);
    return copyFallback(options.fallback);
  }
  return value;
}

function copyFallback<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  return structuredClone(value);
}

async function restoreFallback(options: SafeReadOptions<unknown>): Promise<void> {
  if (options.restore === undefined || !writable) return;
  try {
    const { atomicWriteJson } = await import("./storage.js");
    await atomicWriteJson(options.file, options.restore);
    quarantinedPaths.delete(options.file);
  } catch {
    recordDataIssue({
      code: "restore-failed",
      severity: "degraded",
      file: options.name,
      message: `NerdGram could not replace ${options.name} with its defaults. The data folder may be read-only.`,
    });
  }
}

async function quarantineState(file: string, name: string, reason: string, errno: string, raw: string | null): Promise<void> {
  if (quarantinedPaths.has(file)) return;
  quarantinedPaths.add(file);
  const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const dir = path.join(getMetaPath(), "quarantine", stamp);
  let size: number | null = null;
  let sha256: string | null = null;
  try {
    await fs.mkdir(dir, { recursive: true });
    if (raw != null) {
      const bytes = Buffer.from(raw);
      size = bytes.length;
      sha256 = createHash("sha256").update(bytes).digest("hex");
      await fs.writeFile(path.join(dir, path.basename(file)), bytes);
    } else {
      try {
        await fs.copyFile(file, path.join(dir, path.basename(file)));
        const bytes = await fs.readFile(path.join(dir, path.basename(file)));
        size = bytes.length;
        sha256 = createHash("sha256").update(bytes).digest("hex");
      } catch {
        size = null;
        sha256 = null;
      }
    }
    const report = {
      reason,
      errno: errno || null,
      size,
      sha256,
      appVersion: getVersionInfo().version,
      file: name,
    };
    await fs.writeFile(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    quarantined += 1;
    await pruneQuarantine();
    await refreshQuarantineSets();
  } catch (err) {
    recordDataIssue({
      code: "quarantine-failed",
      severity: "degraded",
      file: name,
      message: `NerdGram could not copy ${name} aside (${errnoOf(err) || "error"}).`,
    });
  }
  recordDataIssue({
    code: "quarantine",
    severity: writable ? "warn" : "degraded",
    file: name,
    message: `${name} could not be read (${reason}). NerdGram is using its defaults. The previous file is under .meta/quarantine when it could be copied.`,
  });
  console.warn(`${name} could not be read (${reason}). Using defaults.`);
}

const SKIP_STAT = new Set(["ENOENT", "EIO", "ETIMEDOUT", "EACCES", "EPERM", "ELOOP", "ENOTDIR", "EBUSY"]);

export function skippedStatCode(code: string | undefined): boolean {
  return Boolean(code && SKIP_STAT.has(code));
}

export function noteTreeSkip(relativePath: string, code: string): void {
  recordDataIssue({
    code: "tree-skip",
    severity: "warn",
    file: relativePath || "(data folder)",
    message: `Skipped ${relativePath || "an entry"} while reading the data folder${code ? ` (${code})` : ""}.`,
  });
}

/**
 * Same readers the API uses. A loose "any object" check used to leave a
 * wrong-shape favorites.json in place until the first GET. Doctor and boot
 * now quarantine it the same way.
 */
async function auditStateFiles(): Promise<void> {
  const updates = await import("./updates/state.js");
  await updates.loadUpdateFile();
  const tokens = await import("./tokens.js");
  await tokens.listTokens();
  const presets = await import("./stylePresets.js");
  await presets.listStylePresets();
  const sync = await import("./sync/configStore.js");
  await sync.loadConfig();
  const favorites = await import("./favorites.js");
  await favorites.getBookmarks();
  const replace = await import("./replace.js");
  await replace.auditReplaceState();
  const history = await import("./history.js");
  await history.auditHistoryState();
  const trash = await import("./trash.js");
  await trash.auditTrashState();
  const locks = await import("./locks.js");
  await locks.auditLockState();
}

/** Check the data folder once. Later quarantines update the same report. */
export async function repairDataFolder(options?: { claimLock?: boolean }): Promise<DataHealthReport> {
  prepared = null;
  issues.length = 0;
  quarantined = 0;
  tempsRemoved = 0;
  clashes = [];
  syncFolder = false;
  await ensureDataPrepared(options?.claimLock === false ? { claimLock: false } : undefined);
  return dataHealthReport();
}

function watchPrepare(claimLock: boolean): Promise<void> {
  return prepareDataFolder(claimLock).catch((err) => {
    if (claimLock) prepared = null;
    if (err instanceof StrictInstanceConflict) throw err;
    recordDataIssue({
      code: "prepare",
      severity: "degraded",
      message: err instanceof Error ? err.message : "The data folder could not be checked.",
    });
  });
}

export function ensureDataPrepared(options?: { claimLock?: boolean }): Promise<void> {
  if (options?.claimLock === false) return watchPrepare(false);
  if (!prepared) prepared = watchPrepare(true);
  return prepared;
}

async function pruneQuarantine(): Promise<void> {
  const root = path.join(getMetaPath(), "quarantine");
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch {
    return;
  }
  const dirs: string[] = [];
  for (const name of names) {
    try {
      if ((await fs.stat(path.join(root, name))).isDirectory()) dirs.push(name);
    } catch {
      continue;
    }
  }
  dirs.sort();
  const extra = dirs.slice(0, Math.max(0, dirs.length - QUARANTINE_KEEP));
  for (const name of extra) {
    await fs.rm(path.join(root, name), { recursive: true, force: true });
  }
}

async function refreshQuarantineSets(): Promise<void> {
  const root = path.join(getMetaPath(), "quarantine");
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch {
    quarantineSets = [];
    return;
  }
  const sets: QuarantineSet[] = [];
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (!(await fs.stat(dir)).isDirectory()) continue;
      const report = JSON.parse(await fs.readFile(path.join(dir, "report.json"), "utf8")) as { file?: unknown; reason?: unknown };
      sets.push({
        id: name,
        path: dir,
        file: typeof report.file === "string" ? report.file : "",
        reason: typeof report.reason === "string" ? report.reason : "",
      });
    } catch {
      continue;
    }
  }
  sets.sort((a, b) => (a.id < b.id ? 1 : -1));
  quarantineSets = sets.slice(0, QUARANTINE_KEEP);
}

async function detectNameClashes(root: string): Promise<void> {
  clashes = [];
  caseInsensitive = false;
  if (writable) caseInsensitive = await probeCaseFold(root);
  if (caseInsensitive) {
    recordDataIssue({
      code: "case-fold",
      severity: "warn",
      message: "This disk treats uppercase and lowercase names as the same file. A rename that only changes case can replace a diagram. NerdGram will not do that rename.",
    });
  }
  const diagrams = await listDiagrams(root);
  const byFold = new Map<string, string[]>();
  for (const rel of diagrams) {
    const key = rel.toLocaleLowerCase();
    const group = byFold.get(key) ?? [];
    group.push(rel);
    byFold.set(key, group);
  }
  for (const group of byFold.values()) {
    const unique = [...new Set(group)];
    if (unique.length < 2) continue;
    clashes.push({ kind: "case", paths: unique });
    recordDataIssue({
      code: "case-collision",
      severity: "warn",
      file: unique[0],
      message: `These diagrams differ only by case: ${unique.join(" and ")}. Both are kept. Neither is deleted.`,
    });
  }
  const present = new Set(diagrams);
  for (const rel of diagrams) {
    if (!isConflictCopyName(path.basename(rel))) continue;
    const originalName = conflictOriginalName(path.basename(rel));
    const original = originalName ? path.join(path.dirname(rel), originalName) : "";
    const paths = original && present.has(original) ? [original, rel] : [rel];
    if (clashes.some((clash) => clash.kind === "conflict-copy" && clash.paths.join() === paths.join())) continue;
    clashes.push({ kind: "conflict-copy", paths });
    recordDataIssue({
      code: "conflict-copy",
      severity: "warn",
      file: rel,
      message: `A sync conflict copy is next to the diagram (${paths.join(" and ")}). Compare them and keep both until you decide. NerdGram does not delete either file.`,
    });
  }
}

function conflictOriginalName(name: string): string | null {
  const conflicted = /^(.*)\s+\(conflicted copy[^)]*\)(\.[^.]+)$/.exec(name);
  if (conflicted?.[1] && conflicted[2]) return `${conflicted[1].trim()}${conflicted[2]}`;
  const numbered = /^(.*) \d+(\.[^.]+)$/.exec(name);
  if (numbered?.[1] && numbered[2]) return `${numbered[1]}${numbered[2]}`;
  return null;
}

async function listDiagrams(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === META_DIR_NAME || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push(full);
        continue;
      }
      if (!entry.name.endsWith(".mmd")) continue;
      found.push(path.relative(root, full));
    }
  }
  return found;
}

async function probeCaseFold(root: string): Promise<boolean> {
  const lower = path.join(root, `.ng-case-${process.pid}`);
  const upper = path.join(root, `.ng-CASE-${process.pid}`);
  try {
    await fs.writeFile(lower, "a");
    await fs.writeFile(upper, "b");
    return (await fs.readFile(lower, "utf8")) === "b";
  } catch {
    return false;
  } finally {
    await fs.rm(lower, { force: true });
    await fs.rm(upper, { force: true });
  }
}

async function prepareDataFolder(claimLock = true): Promise<void> {
  const root = ensureDataRoot();
  let dirStat;
  try {
    dirStat = await fs.stat(root);
  } catch (err) {
    writable = false;
    recordDataIssue({
      code: errnoOf(err) || "missing",
      severity: "degraded",
      message: "The data folder is missing or cannot be opened.",
    });
    return;
  }
  if (!dirStat.isDirectory()) {
    writable = false;
    recordDataIssue({
      code: "not-directory",
      severity: "degraded",
      message: "The data folder is not a directory.",
    });
    return;
  }
  const meta = path.join(root, META_DIR_NAME);
  await fs.mkdir(meta, { recursive: true }).catch((err) => {
    writable = false;
    const code = errnoOf(err);
    recordDataIssue({
      code: code || "meta",
      severity: "degraded",
      message: preflightMessage(code) ?? "NerdGram could not create the .meta folder.",
    });
  });
  if (writable) await probeWrite(meta);
  await readFreeBytes(root);
  await detectSyncFolder(root);
  if (writable) await cleanupOrphanTemps(root);
  await detectNameClashes(root);
  await auditStateFiles();
  await refreshQuarantineSets();
  if (writable && claimLock) {
    await claimInstanceLock();
    const conflict = currentInstanceConflict();
    if (conflict) {
      recordDataIssue({
        code: "instance-conflict",
        severity: "warn",
        message: `Two instances share this data folder. The other one is ${conflict.hostname} pid ${conflict.pid}, heartbeat ${conflict.heartbeatAt}. Background sync, the update checker, and diagram sightings are paused.`,
      });
    }
  }
}

/** Stamp written by quarantine: millisecond time, then 6 hex characters. */
const QUARANTINE_ID = /^[0-9]{13}-[a-f0-9]{6}$/;
/** Backup folder: schema version, then millisecond time. */
const BACKUP_ID = /^[0-9]+-[0-9]{13}$/;

function rejectRestore(message = "That quarantine set was not found."): never {
  throw httpFail(400, message, "invalid");
}

/**
 * A directory name taken from a listing, never from the request string.
 * The request value is only compared to names that are already on disk.
 * The same check covers quarantine sets and backup folders.
 */
async function listedChild(root: string, id: string, pattern: RegExp): Promise<string> {
  if (typeof id !== "string" || !pattern.test(id)) rejectRestore();
  let rootReal: string;
  try {
    rootReal = await fs.realpath(root);
  } catch {
    rejectRestore();
  }
  const rootStat = await fs.lstat(rootReal);
  if (!rootStat.isDirectory()) rejectRestore();
  const entries = await fs.readdir(rootReal, { withFileTypes: true });
  const entry = entries.find((item) => item.name === id && pattern.test(item.name));
  if (!entry || entry.isSymbolicLink() || !entry.isDirectory()) rejectRestore();
  const dir = path.resolve(rootReal, entry.name);
  const rel = path.relative(rootReal, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(`..${path.sep}`)) rejectRestore();
  let dirReal: string;
  try {
    dirReal = await fs.realpath(dir);
  } catch {
    rejectRestore();
  }
  const realRel = path.relative(rootReal, dirReal);
  if (!realRel || realRel.startsWith("..") || path.isAbsolute(realRel) || realRel.includes(`..${path.sep}`)) {
    rejectRestore();
  }
  const linked = await fs.lstat(dir);
  if (linked.isSymbolicLink()) rejectRestore();
  return dirReal;
}

export async function quarantineDirForId(id: string): Promise<string> {
  return listedChild(path.join(getMetaPath(), "quarantine"), id, QUARANTINE_ID);
}

export async function backupDirForId(id: string): Promise<string> {
  return listedChild(path.join(getMetaPath(), "backups"), id, BACKUP_ID);
}

function safeStateRelative(rel: string): string | null {
  if (typeof rel !== "string" || !rel || rel.length > 240) return null;
  if (rel.includes("\0") || rel.includes("\\") || rel.includes("%") || path.isAbsolute(rel)) return null;
  if (rel.endsWith(".mmd") || rel.endsWith(".mmd.bak")) return null;
  const parts = rel.split("/");
  if (parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === "." || part === "..")) return null;
  return parts.join("/");
}

export async function restoreQuarantineSet(id: string): Promise<QuarantineSet> {
  const dir = await quarantineDirForId(id);
  let report: { file?: unknown; reason?: unknown };
  try {
    report = JSON.parse(await fs.readFile(path.join(dir, "report.json"), "utf8")) as { file?: unknown; reason?: unknown };
  } catch {
    rejectRestore();
  }
  const rel = safeStateRelative(typeof report.file === "string" ? report.file : "");
  if (!rel) rejectRestore("That quarantine set does not name a state file.");
  const names = await fs.readdir(dir, { withFileTypes: true });
  const payload = names.find((item) => item.name !== "report.json" && item.isFile() && !item.isSymbolicLink());
  if (!payload || payload.name !== path.basename(rel) || !/^[A-Za-z0-9._-]+$/.test(payload.name)) {
    rejectRestore("That quarantine set has no file to restore.");
  }
  const metaReal = await fs.realpath(getMetaPath());
  const dest = path.resolve(metaReal, rel);
  const destRel = path.relative(metaReal, dest);
  if (!destRel || destRel.startsWith("..") || path.isAbsolute(destRel)) {
    rejectRestore("That quarantine set does not name a state file.");
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const parentReal = await fs.realpath(path.dirname(dest));
  const parentRel = path.relative(metaReal, parentReal);
  if (parentRel.startsWith("..") || path.isAbsolute(parentRel)) {
    rejectRestore("That quarantine set does not name a state file.");
  }
  clearNewerSchema(dest);
  await fs.copyFile(path.join(dir, payload.name), dest);
  return { id: path.basename(dir), path: dir, file: rel, reason: typeof report.reason === "string" ? report.reason : "" };
}

export async function logStartupSummary(): Promise<void> {
  const report = dataHealthReport();
  const summary = {
    dataDir: report.dataDir,
    writable: report.writable,
    freeBytes: report.freeBytes,
    syncFolder: report.syncFolder,
    status: report.status,
    quarantined: report.quarantined,
    tempsRemoved: report.tempsRemoved,
    instanceConflict: report.instanceConflict != null,
    issues: report.issues.map((issue) => ({ code: issue.code, file: issue.file ?? null, message: issue.message })),
  };
  if (process.env.NERDGRAM_LOG_FORMAT === "json") {
    console.log(JSON.stringify({ event: "data-folder", ...summary }));
    return;
  }
  const free = report.freeBytes == null ? "unknown" : `${Math.round(report.freeBytes / (1024 * 1024))} MB`;
  console.log(
    `Data folder check: ${report.status}. Writable: ${report.writable ? "yes" : "no"}. Free space: ${free}. Sync folder: ${report.syncFolder ? "yes" : "no"}. Quarantined: ${report.quarantined}. Temp files removed: ${report.tempsRemoved}.`,
  );
  for (const issue of report.issues) console.warn(`Data folder: ${issue.message}`);
}
