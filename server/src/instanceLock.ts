import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { currentBootId } from "./bootId.js";
import { getInstanceIdentity, regenerateInstanceId } from "./instanceConfig.js";
import { getMetaPath } from "./paths.js";
import { atomicWriteText, isProcessAlive, writeTextInPlace } from "./storage.js";

const HEARTBEAT_MS = 30_000;
export const INSTANCE_LOCK_FRESH_MS = 45_000;
const FRESH_MS = INSTANCE_LOCK_FRESH_MS;

export type InstanceConflict = {
  instanceId: string;
  hostname: string;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  /** True when the other process is using this install's instance id. */
  sameInstall: boolean;
};

export type InstanceLockSnapshot = Omit<InstanceConflict, "sameInstall"> & {
  port: number | null;
  /** Absent on heartbeats written before boot ids. */
  bootId?: string;
};

type InstanceLockFile = InstanceLockSnapshot;

export class StrictInstanceConflict extends Error {
  constructor() {
    super(
      "NerdGram checked the data folder and found two copies of NerdGram using it. NERDGRAM_STRICT_INSTANCE is set, so NerdGram refused to start. Stop the other NerdGram, then start this one again.",
    );
    this.name = "StrictInstanceConflict";
  }
}

let holding = false;
let paused = false;
let conflict: InstanceConflict | null = null;
let startedAt = "";
let listenPort: number | null = null;
let timer: NodeJS.Timeout | null = null;

export function resetInstanceLockForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  holding = false;
  paused = false;
  conflict = null;
  startedAt = "";
  listenPort = null;
}

export function backgroundWritersPaused(): boolean {
  return paused;
}

export function currentInstanceConflict(): InstanceConflict | null {
  return conflict ? { ...conflict } : null;
}

function lockPath(): string {
  return path.join(getMetaPath(), "instance-lock.json");
}

function strictMode(): boolean {
  const raw = process.env.NERDGRAM_STRICT_INSTANCE?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

const LOCK_READ_ATTEMPTS = 4;
const LOCK_READ_DELAY_MS = 20;

function parseLock(parsed: unknown): InstanceLockFile | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Partial<InstanceLockFile>;
  if (typeof record.instanceId !== "string" || typeof record.hostname !== "string") return null;
  if (typeof record.pid !== "number" || typeof record.startedAt !== "string" || typeof record.heartbeatAt !== "string") {
    return null;
  }
  const port = typeof record.port === "number" && Number.isInteger(record.port) && record.port >= 1 && record.port <= 65535 ? record.port : null;
  const bootId = typeof record.bootId === "string" && record.bootId.trim() ? record.bootId.trim() : undefined;
  return {
    instanceId: record.instanceId,
    hostname: record.hostname,
    pid: record.pid,
    startedAt: record.startedAt,
    heartbeatAt: record.heartbeatAt,
    port,
    ...(bootId ? { bootId } : {}),
  };
}

/** Missing is null. A torn read is retried, then "unreadable" so the lock stays held. */
async function readLock(): Promise<InstanceLockFile | null | "unreadable"> {
  const file = lockPath();
  for (let attempt = 0; attempt < LOCK_READ_ATTEMPTS; attempt += 1) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const record = raw.trim() ? parseLock(JSON.parse(raw) as unknown) : null;
      if (!record) throw new Error("empty lock");
      return record;
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

/** Read the lock without creating it, refreshing it, or taking it. */
export async function readInstanceLockFile(): Promise<InstanceLockSnapshot | null | "unreadable"> {
  return readLock();
}

export type LockHolderKind = "local-server" | "other-host" | "stale";

/** A fresh lock on this machine is the running server. A fresh lock on another host is a second server. */
export function lockHolderKind(lock: InstanceLockSnapshot, now = Date.now()): LockHolderKind {
  const age = now - Date.parse(lock.heartbeatAt);
  const fresh = Number.isFinite(age) && age >= 0 && age < FRESH_MS;
  if (!fresh) return "stale";
  if (lock.hostname === os.hostname()) {
    if (lock.pid === process.pid || isProcessAlive(lock.pid)) return "local-server";
    return "stale";
  }
  return "other-host";
}

export function heartbeatAgeSeconds(lock: InstanceLockSnapshot, now = Date.now()): number {
  const age = now - Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(age) || age < 0) return 0;
  return Math.round(age / 1000);
}

function conflictOf(lock: InstanceLockSnapshot, sameInstall: boolean): InstanceConflict {
  return {
    instanceId: lock.instanceId,
    hostname: lock.hostname,
    pid: lock.pid,
    startedAt: lock.startedAt,
    heartbeatAt: lock.heartbeatAt,
    sameInstall,
  };
}

function unreadableConflict(): InstanceConflict {
  const now = new Date().toISOString();
  return {
    instanceId: "",
    hostname: "unreadable lock",
    pid: 0,
    startedAt: now,
    heartbeatAt: now,
    sameInstall: false,
  };
}

function foreignFresh(lock: InstanceLockFile, now: number, instanceId: string): boolean {
  const age = now - Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(age) || age < 0 || age >= FRESH_MS) return false;
  if (lock.hostname === os.hostname() && lock.pid === process.pid) return false;
  // A dead pid is this install's crashed process only. Another install on this
  // computer keeps a fresh heartbeat until it ages out.
  if (lock.hostname === os.hostname() && lock.instanceId === instanceId && !isProcessAlive(lock.pid)) return false;
  return true;
}

function lockBody(identityId: string): InstanceLockFile {
  const now = new Date().toISOString();
  if (!startedAt) startedAt = now;
  return {
    instanceId: identityId,
    hostname: os.hostname(),
    pid: process.pid,
    startedAt,
    heartbeatAt: now,
    port: listenPort,
    bootId: currentBootId(),
  };
}

/** One read of the instance heartbeat. Missing is null. A torn file is unreadable, not "no lock". */
export function readInstanceBootSync(): { bootId?: string; heartbeatAt: string } | null | "unreadable" {
  try {
    const raw = readFileSync(lockPath(), "utf8");
    if (!raw.trim()) return "unreadable";
    const parsed = parseLock(JSON.parse(raw) as unknown);
    if (!parsed) return "unreadable";
    return { bootId: parsed.bootId, heartbeatAt: parsed.heartbeatAt };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "unreadable";
  }
}

function ownedByUs(lock: InstanceLockFile | null | "unreadable", identityId: string): lock is InstanceLockFile {
  return (
    lock !== null &&
    lock !== "unreadable" &&
    lock.instanceId === identityId &&
    lock.pid === process.pid &&
    lock.hostname === os.hostname()
  );
}

/**
 * Acquire replaces the file. A heartbeat refreshes it in place. The write
 * counts only when a following read still names this process.
 */
async function writeLock(identityId: string, mode: "replace" | "refresh"): Promise<boolean> {
  const text = `${JSON.stringify(lockBody(identityId), null, 2)}\n`;
  if (mode === "refresh") await writeTextInPlace(lockPath(), text);
  else await atomicWriteText(lockPath(), text);
  const confirmed = await readLock();
  if (!ownedByUs(confirmed, identityId)) {
    holding = false;
    return false;
  }
  holding = true;
  paused = false;
  conflict = null;
  return true;
}

function holdFailed(existing: InstanceLockFile | "unreadable", sameInstall: boolean): void {
  holding = false;
  paused = true;
  conflict = existing === "unreadable" ? unreadableConflict() : conflictOf(existing, sameInstall);
}

async function resumeWriters(): Promise<void> {
  const { bootBackgroundTasks } = await import("./boot.js");
  await bootBackgroundTasks();
}

/** Take the lock, or warn when another live instance already holds it. */
export async function claimInstanceLock(): Promise<void> {
  let identity = await getInstanceIdentity();
  const existing = await readLock();
  const now = Date.now();
  if (existing === "unreadable" || (existing && foreignFresh(existing, now, identity.instanceId))) {
    const sharedId = existing !== "unreadable" && existing.instanceId === identity.instanceId;
    if (sharedId) identity = await regenerateInstanceId();
    holdFailed(existing, sharedId);
    if (strictMode()) throw new StrictInstanceConflict();
    armTimer();
    return;
  }
  const wrote = await writeLock(identity.instanceId, "replace");
  if (!wrote) {
    const after = await readLock();
    const sharedId = after !== null && after !== "unreadable" && after.instanceId === identity.instanceId;
    if (sharedId) identity = await regenerateInstanceId();
    holdFailed(after ?? "unreadable", sharedId);
    if (strictMode()) throw new StrictInstanceConflict();
  }
  armTimer();
}

async function tick(): Promise<void> {
  const existing = await readLock();
  const now = Date.now();
  const identityForFresh = await getInstanceIdentity();
  if (existing === "unreadable" || (existing && foreignFresh(existing, now, identityForFresh.instanceId))) {
    const identity = identityForFresh;
    const sharedId = existing !== "unreadable" && existing.instanceId === identity.instanceId;
    if (sharedId) await regenerateInstanceId();
    holdFailed(existing, sharedId);
    return;
  }
  const wasPaused = paused;
  const identity = await getInstanceIdentity();
  const mode = ownedByUs(existing, identity.instanceId) ? "refresh" : "replace";
  const wrote = await writeLock(identity.instanceId, mode);
  if (!wrote) {
    const after = await readLock();
    const sharedId = after !== null && after !== "unreadable" && after.instanceId === identity.instanceId;
    if (sharedId) await regenerateInstanceId();
    holdFailed(after ?? "unreadable", sharedId);
    return;
  }
  if (wasPaused) await resumeWriters();
}

function armTimer(): void {
  if (timer || process.env.VITEST) return;
  timer = setInterval(() => {
    void tick().catch(() => undefined);
  }, HEARTBEAT_MS);
  timer.unref?.();
}

/** Drop the lock on a clean exit so the next start is not treated as a second instance. */
export async function releaseInstanceLock(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  if (!holding) {
    paused = false;
    conflict = null;
    return;
  }
  holding = false;
  paused = false;
  conflict = null;
  const existing = await readLock();
  if (existing && existing !== "unreadable" && existing.pid === process.pid && existing.hostname === os.hostname()) {
    await fs.rm(lockPath(), { force: true });
  }
}

/** Tests call this instead of waiting for the interval. */
export async function refreshInstanceLockForTests(): Promise<void> {
  await tick();
}

/** Record the port the server is listening on. Doctor uses it, and does not call this. */
export async function rememberInstanceLockPort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return;
  listenPort = port;
  if (!holding) return;
  const identity = await getInstanceIdentity();
  await writeLock(identity.instanceId, "refresh");
}
