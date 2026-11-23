import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataRoot, getDataRoot, getMetaPath, META_DIR_NAME } from "./paths.js";
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

export type DataHealthReport = {
  status: DataStatus;
  issues: DataIssue[];
  syncFolder: boolean;
  instanceConflict: null;
  freeBytes: number | null;
  quarantined: number;
  writable: boolean;
  tempsRemoved: number;
  dataDir: string;
};

const issues: DataIssue[] = [];
let syncFolder = false;
let freeBytes: number | null = null;
let writable = true;
let quarantined = 0;
let tempsRemoved = 0;
let prepared: Promise<void> | null = null;
const quarantinedPaths = new Set<string>();

export function resetDataHealthForTests(): void {
  issues.length = 0;
  syncFolder = false;
  freeBytes = null;
  writable = true;
  quarantined = 0;
  tempsRemoved = 0;
  prepared = null;
  quarantinedPaths.clear();
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

export function dataHealthReport(): DataHealthReport {
  return {
    status: statusOf(issues, writable),
    issues: issues.map((issue) => ({ ...issue })),
    syncFolder,
    instanceConflict: null,
    freeBytes,
    quarantined,
    writable,
    tempsRemoved,
    dataDir: getDataRoot(),
  };
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

async function auditFile(file: string, name: string): Promise<void> {
  await safeReadState({
    file,
    name,
    fallback: null,
    parse: (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null),
  });
}

async function auditTree(dir: string, name: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (errnoOf(err) === "ENOENT") return;
    recordDataIssue({
      code: "state-dir",
      severity: "warn",
      file: name,
      message: `Could not read ${name} (${errnoOf(err) || "error"}).`,
    });
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await auditTree(full, `${name}/${entry.name}`);
      continue;
    }
    if (!entry.name.endsWith(".json") || entry.name.endsWith(".bak")) continue;
    await auditFile(full, `${name}/${entry.name}`);
  }
}

async function auditStateFiles(): Promise<void> {
  const meta = getMetaPath();
  const singles: [string, string][] = [
    ["updates.json", "updates.json"],
    ["api-tokens.json", "api-tokens.json"],
    ["style-presets.json", "style-presets.json"],
    ["github-sync.json", "github-sync.json"],
  ];
  for (const [file, name] of singles) {
    await auditFile(path.join(meta, file), name);
  }
  await safeReadState({
    file: path.join(meta, "favorites.json"),
    name: "favorites.json",
    fallback: null,
    parse: (value) => (Array.isArray(value) || (value && typeof value === "object") ? value : null),
  });
  await auditFile(path.join(meta, "replace", "operations.json"), "replace/operations.json");
  await auditTree(path.join(meta, "versions"), "versions");
  await auditTree(path.join(meta, "trash"), "trash");
  await auditTree(path.join(meta, "locks"), "locks");
}

/** Check the data folder once. Later quarantines update the same report. */
export function ensureDataPrepared(): Promise<void> {
  if (!prepared) {
    prepared = prepareDataFolder().catch((err) => {
      prepared = null;
      recordDataIssue({
        code: "prepare",
        severity: "degraded",
        message: err instanceof Error ? err.message : "The data folder could not be checked.",
      });
    });
  }
  return prepared;
}

async function prepareDataFolder(): Promise<void> {
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
  await auditStateFiles();
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
