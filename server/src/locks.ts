import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordDataIssue } from "./dataHealth.js";
import { getInstanceIdentity, type InstanceIdentity } from "./instanceConfig.js";
import {
  LOCK_HEARTBEAT_MS,
  LOCK_STALE_MS,
  assertSafeId,
  atomicWriteJson,
  createId,
  decodeStorageKey,
  getLocksRoot,
  safeStorageKey,
  httpFail,
  isProcessAlive,
  normalizeRelative,
  pathExists,
  readJsonFile,
  writeJsonInPlace,
} from "./storage.js";

export type LockRecord = {
  path: string;
  token: string;
  sessionId: string;
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
  /** Absent on locks written before instance ids. */
  instanceId?: string;
  instanceName?: string;
  hostname?: string;
  /** This process boot. A later boot of the same install does not keep the lock. */
  bootId?: string;
};

/** One id per process. A container restart is a new boot, even when the instance id is kept. */
const processBootId = randomUUID();

export function currentBootId(): string {
  return processBootId;
}

type LockFile = LockRecord & { stale: boolean };

const SAME_INSTANCE_MESSAGE = "This diagram is open in another window.";

/**
 * Lock filenames stay under 255 bytes. A short path keeps the reversible
 * `p_` key. A longer path is `h_` plus a sha256 of the path, and the record
 * still stores the path.
 */
export function lockStorageKey(relativePath: string): string {
  return safeStorageKey(relativePath, ".json");
}

function lockFile(relativePath: string): string {
  return path.join(getLocksRoot(), `${lockStorageKey(relativePath)}.json`);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isLockRecord(value: unknown): value is LockRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LockRecord>;
  return (
    typeof record.path === "string" &&
    typeof record.token === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.pid === "number" &&
    typeof record.acquiredAt === "string" &&
    typeof record.heartbeatAt === "string"
  );
}

function normalizeLock(record: LockRecord): LockRecord {
  const instanceId = optionalText(record.instanceId);
  const instanceName = optionalText(record.instanceName);
  const hostname = optionalText(record.hostname);
  const bootId = optionalText(record.bootId);
  return {
    path: record.path,
    token: record.token,
    sessionId: record.sessionId,
    pid: record.pid,
    acquiredAt: record.acquiredAt,
    heartbeatAt: record.heartbeatAt,
    ...(instanceId ? { instanceId } : {}),
    ...(instanceName ? { instanceName } : {}),
    ...(hostname ? { hostname } : {}),
    ...(bootId ? { bootId } : {}),
  };
}

/**
 * A fresh heartbeat is held. A pid is a liveness signal only for this
 * install on this computer. A lock stamped with an earlier boot of this same
 * install is stale immediately, which is a Docker restart that kept the
 * instance id. Another install is still judged by heartbeat age alone.
 */
export function lockIsStale(record: LockRecord, now = Date.now(), instanceId?: string): boolean {
  const heartbeat = Date.parse(record.heartbeatAt);
  if (!Number.isFinite(heartbeat) || now - heartbeat > LOCK_STALE_MS) return true;
  const sameInstance = Boolean(instanceId) && record.instanceId === instanceId;
  const boot = optionalText(record.bootId);
  if (sameInstance && boot && boot !== currentBootId()) return true;
  const host = optionalText(record.hostname);
  if (host && host !== os.hostname()) return false;
  const legacy = !optionalText(record.instanceId);
  if ((sameInstance || legacy) && record.pid !== process.pid && !isProcessAlive(record.pid)) return true;
  return false;
}

function sameInstance(record: LockRecord, identity: InstanceIdentity): boolean {
  return !optionalText(record.instanceId) || record.instanceId === identity.instanceId;
}

function diagramLabel(relativePath: string): string {
  const base = relativePath.split("/").pop() || relativePath;
  return base.replace(/\.mmd$/i, "") || base;
}

export function formatLockSince(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

export function lockedMessage(record: LockRecord, identity: InstanceIdentity): string {
  if (sameInstance(record, identity)) return SAME_INSTANCE_MESSAGE;
  const name = record.instanceName || record.hostname || "another instance";
  const host =
    record.hostname && record.instanceName && record.hostname !== record.instanceName
      ? ` (${record.hostname})`
      : "";
  return `${diagramLabel(record.path)} is open on ${name}${host} since ${formatLockSince(record.acquiredAt)}. Try again when it's closed.`;
}

const LOCK_READ_ATTEMPTS = 4;
const LOCK_READ_DELAY_MS = 20;

function unreadableLock(relativePath: string): LockRecord {
  const now = new Date().toISOString();
  return {
    path: relativePath,
    token: "unreadable",
    sessionId: "unreadable",
    pid: 0,
    acquiredAt: now,
    heartbeatAt: now,
    instanceId: "unreadable-lock",
    instanceName: "an unreadable lock",
  };
}

/** Missing is null. A torn or empty file is retried, then treated as held. */
async function readLockRecord(file: string): Promise<LockRecord | null | "unreadable"> {
  for (let attempt = 0; attempt < LOCK_READ_ATTEMPTS; attempt += 1) {
    try {
      const raw = await fs.readFile(file, "utf8");
      if (!raw.trim()) throw new Error("empty lock");
      const parsed = JSON.parse(raw) as unknown;
      if (!isLockRecord(parsed)) throw new Error("lock shape");
      return normalizeLock(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (attempt < LOCK_READ_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_READ_DELAY_MS));
        continue;
      }
      return "unreadable";
    }
  }
  return "unreadable";
}

function noteUnreadableLock(name: string): void {
  recordDataIssue({
    code: "lock-unreadable",
    severity: "warn",
    file: name,
    message: `NerdGram checked ${name}, one of its own lock files (not your diagrams), and could not read it after retrying. NerdGram is treating that lock as held so it is not taken over. Stop every NerdGram, then delete that lock file if no editor has the diagram open.`,
  });
}

async function readLock(relativePath: string): Promise<LockFile | null> {
  const file = lockFile(relativePath);
  const parsed = await readLockRecord(file);
  if (parsed === "unreadable") {
    noteUnreadableLock(`locks/${path.basename(file)}`);
    const record = unreadableLock(relativePath);
    return { ...record, stale: false };
  }
  if (!parsed) return null;
  const identity = await getInstanceIdentity();
  return { ...parsed, stale: lockIsStale(parsed, Date.now(), identity.instanceId) };
}

function holderDetails(record: LockRecord, identity: InstanceIdentity) {
  return {
    acquiredAt: record.acquiredAt,
    heartbeatAt: record.heartbeatAt,
    staleAfterMs: LOCK_STALE_MS,
    instanceId: record.instanceId ?? null,
    instanceName: record.instanceName ?? null,
    hostname: record.hostname ?? null,
    sameInstance: sameInstance(record, identity),
  };
}

async function lockedError(record: LockRecord): Promise<Error> {
  const identity = await getInstanceIdentity();
  if (record.token === "unreadable") {
    return httpFail(423, "The lock file could not be read. NerdGram is treating it as held.", "locked", {
      lock: holderDetails(record, identity),
    });
  }
  return httpFail(423, lockedMessage(record, identity), "locked", {
    lock: holderDetails(record, identity),
  });
}

function stampIdentity(record: LockRecord, identity: InstanceIdentity): LockRecord {
  return {
    ...record,
    instanceId: identity.instanceId,
    instanceName: identity.instanceName,
    hostname: identity.hostname,
    bootId: currentBootId(),
  };
}

function publicLock(record: LockRecord) {
  return {
    path: record.path,
    token: record.token,
    sessionId: record.sessionId,
    heartbeatAt: record.heartbeatAt,
    acquiredAt: record.acquiredAt,
    heartbeatEveryMs: LOCK_HEARTBEAT_MS,
    staleAfterMs: LOCK_STALE_MS,
  };
}

export async function acquireLock(
  relativePath: string,
  sessionId: string,
): Promise<ReturnType<typeof publicLock>> {
  const normalized = normalizeRelative(relativePath);
  if (!sessionId || sessionId.length > 80) {
    throw httpFail(400, "sessionId is required", "invalid");
  }
  assertSafeId(sessionId);
  await fs.mkdir(getLocksRoot(), { recursive: true });
  const file = lockFile(normalized);
  const identity = await getInstanceIdentity();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await readLock(normalized);
    if (existing && !existing.stale) {
      // Same tab (same session id, same server process) can take its token back
      // after a refresh. A different tab has a different session id.
      if (
        existing.sessionId === sessionId &&
        existing.pid === process.pid &&
        sameInstance(existing, identity)
      ) {
        const refreshed = stampIdentity(
          {
            path: existing.path,
            token: existing.token,
            sessionId: existing.sessionId,
            pid: existing.pid,
            acquiredAt: existing.acquiredAt,
            heartbeatAt: new Date().toISOString(),
          },
          identity,
        );
        await atomicWriteJson(file, refreshed);
        const confirmed = await readLock(normalized);
        if (confirmed?.token === refreshed.token) return publicLock(refreshed);
        continue;
      }
      throw await lockedError(existing);
    }

    const now = new Date().toISOString();
    const record = stampIdentity(
      {
        path: normalized,
        token: createId(),
        sessionId,
        pid: process.pid,
        acquiredAt: now,
        heartbeatAt: now,
      },
      identity,
    );
    await atomicWriteJson(file, record);
    const confirmed = await readLock(normalized);
    if (confirmed?.token === record.token) return publicLock(record);
  }

  throw httpFail(409, "Could not acquire the editor lock", "lock_busy");
}

export async function heartbeatLock(
  relativePath: string,
  token: string,
): Promise<ReturnType<typeof publicLock>> {
  const existing = await readLock(relativePath);
  if (!existing || existing.stale || existing.token !== token) {
    throw httpFail(423, "The editor lock is no longer held by this window.", "locked");
  }
  const identity = await getInstanceIdentity();
  const next = stampIdentity(
    {
      path: existing.path,
      token: existing.token,
      sessionId: existing.sessionId,
      pid: existing.pid,
      acquiredAt: existing.acquiredAt,
      heartbeatAt: new Date().toISOString(),
    },
    identity,
  );
  await writeJsonInPlace(lockFile(normalizeRelative(relativePath)), next);
  const confirmed = await readLock(relativePath);
  if (!confirmed || confirmed.token !== token) {
    throw httpFail(423, "The editor lock is no longer held by this window.", "locked");
  }
  return publicLock(next);
}

/**
 * Replace a missing or stale lock after the reader confirms. A lock that is
 * still being refreshed by another window is left alone.
 */
export async function takeoverLock(
  relativePath: string,
  sessionId: string,
): Promise<ReturnType<typeof publicLock>> {
  const normalized = normalizeRelative(relativePath);
  const existing = await readLock(normalized);
  const identity = await getInstanceIdentity();
  if (
    existing &&
    !existing.stale &&
    !(existing.sessionId === sessionId && existing.pid === process.pid && sameInstance(existing, identity))
  ) {
    throw await lockedError(existing);
  }
  return acquireLock(relativePath, sessionId);
}

export async function releaseLock(relativePath: string, token: string): Promise<void> {
  const existing = await readLock(relativePath);
  if (!existing) return;
  if (existing.token !== token) {
    throw await lockedError(existing);
  }
  await fs.rm(lockFile(normalizeRelative(relativePath)), { force: true });
}

/**
 * A live lock blocks every other writer. A missing or stale lock does not,
 * so dashboard creates and local scripts keep working until an editor is open.
 */
export async function assertWriteAllowed(
  relativePath: string,
  token: string | null | undefined,
): Promise<void> {
  const existing = await readLock(relativePath);
  if (!existing || existing.stale) return;
  if (token && existing.token === token) return;
  throw await lockedError(existing);
}

async function eachLock(): Promise<LockFile[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(getLocksRoot());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const locks: LockFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const decoded = decodeStorageKey(name.slice(0, -".json".length));
    const parsed = await readLockRecord(path.join(getLocksRoot(), name));
    if (parsed === "unreadable") {
      noteUnreadableLock(`locks/${name}`);
      const itemPath = decoded;
      if (!itemPath) {
        locks.push({ ...unreadableLock(name), stale: false });
        continue;
      }
      locks.push({ ...unreadableLock(itemPath), stale: false });
      continue;
    }
    if (!parsed) continue;
    const itemPath = decoded ?? parsed.path;
    if (!itemPath) continue;
    const record = normalizeLock({ ...parsed, path: itemPath });
    const identity = await getInstanceIdentity();
    locks.push({ ...record, stale: lockIsStale(record, Date.now(), identity.instanceId) });
  }
  return locks;
}

function covers(lockPath: string, relativePath: string, isDir: boolean): boolean {
  const target = normalizeRelative(relativePath);
  return lockPath === target || (isDir && lockPath.startsWith(`${target}/`));
}

/** The editor that already holds the lock. Dashboard renames send neither field. */
export type LockHolder = {
  token?: string | null;
  sessionId?: string | null;
};

function heldBy(lock: LockFile, holder: LockHolder | null | undefined, identity: InstanceIdentity): boolean {
  if (!holder) return false;
  if (holder.token && lock.token === holder.token) return true;
  return Boolean(
    holder.sessionId &&
      lock.sessionId === holder.sessionId &&
      lock.pid === process.pid &&
      sameInstance(lock, identity),
  );
}

export async function assertUnlocked(
  relativePath: string,
  isDir: boolean,
  holder?: LockHolder | null,
): Promise<void> {
  const identity = holder?.token || holder?.sessionId ? await getInstanceIdentity() : null;
  for (const lock of await eachLock()) {
    if (lock.stale || !covers(lock.path, relativePath, isDir)) continue;
    if (identity && heldBy(lock, holder, identity)) continue;
    throw await lockedError(lock);
  }
}

export async function discardLocks(relativePath: string, isDir: boolean): Promise<void> {
  for (const lock of await eachLock()) {
    if (!covers(lock.path, relativePath, isDir)) continue;
    await fs.rm(lockFile(lock.path), { force: true });
  }
}

export async function relocateLocks(
  fromPath: string,
  toPath: string,
  isDir: boolean,
): Promise<void> {
  const locks = await eachLock();
  for (const lock of locks) {
    if (!covers(lock.path, fromPath, isDir)) continue;
    const from = normalizeRelative(fromPath);
    const nextPath =
      lock.path === from ? normalizeRelative(toPath) : `${normalizeRelative(toPath)}${lock.path.slice(from.length)}`;
    const next: LockRecord = {
      path: nextPath,
      token: lock.token,
      sessionId: lock.sessionId,
      pid: lock.pid,
      acquiredAt: lock.acquiredAt,
      heartbeatAt: lock.heartbeatAt,
      ...(lock.instanceId ? { instanceId: lock.instanceId } : {}),
      ...(lock.instanceName ? { instanceName: lock.instanceName } : {}),
      ...(lock.hostname ? { hostname: lock.hostname } : {}),
      ...(lock.bootId ? { bootId: lock.bootId } : {}),
    };
    await fs.rm(lockFile(lock.path), { force: true });
    if (!(await pathExists(lockFile(nextPath)))) {
      await atomicWriteJson(lockFile(nextPath), next);
    }
  }
}

/** Startup audit. Uses the same lock parser as a lock read. */
export async function auditLockState(): Promise<void> {
  await eachLock();
}
