import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getInstanceIdentity } from "./instanceConfig.js";
import { getMetaPath } from "./paths.js";
import { atomicWriteText, isProcessAlive } from "./storage.js";

const HEARTBEAT_MS = 30_000;
const FRESH_MS = 45_000;

export type InstanceConflict = {
  instanceId: string;
  hostname: string;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
};

export type InstanceLockSnapshot = InstanceConflict & { port: number | null };

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

async function readLock(): Promise<InstanceLockFile | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Partial<InstanceLockFile>;
    if (typeof record.instanceId !== "string" || typeof record.hostname !== "string") return null;
    if (typeof record.pid !== "number" || typeof record.startedAt !== "string" || typeof record.heartbeatAt !== "string") {
      return null;
    }
    const port = typeof record.port === "number" && Number.isInteger(record.port) && record.port >= 1 && record.port <= 65535 ? record.port : null;
    return {
      instanceId: record.instanceId,
      hostname: record.hostname,
      pid: record.pid,
      startedAt: record.startedAt,
      heartbeatAt: record.heartbeatAt,
      port,
    };
  } catch {
    return null;
  }
}

/** Read the lock without creating it, refreshing it, or taking it. */
export async function readInstanceLockFile(): Promise<InstanceLockSnapshot | null> {
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

function conflictOf(lock: InstanceLockSnapshot): InstanceConflict {
  return {
    instanceId: lock.instanceId,
    hostname: lock.hostname,
    pid: lock.pid,
    startedAt: lock.startedAt,
    heartbeatAt: lock.heartbeatAt,
  };
}

function foreignFresh(lock: InstanceLockFile, now: number): boolean {
  const age = now - Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(age) || age < 0 || age >= FRESH_MS) return false;
  if (lock.hostname === os.hostname() && lock.pid === process.pid) return false;
  if (lock.hostname === os.hostname() && !isProcessAlive(lock.pid)) return false;
  return true;
}

async function writeLock(identityId: string): Promise<void> {
  const now = new Date().toISOString();
  if (!startedAt) startedAt = now;
  const body: InstanceLockFile = {
    instanceId: identityId,
    hostname: os.hostname(),
    pid: process.pid,
    startedAt,
    heartbeatAt: now,
    port: listenPort,
  };
  await atomicWriteText(lockPath(), `${JSON.stringify(body, null, 2)}\n`);
  holding = true;
  paused = false;
  conflict = null;
}

async function resumeWriters(): Promise<void> {
  const { bootBackgroundTasks } = await import("./boot.js");
  await bootBackgroundTasks();
}

/** Take the lock, or warn when another live instance already holds it. */
export async function claimInstanceLock(): Promise<void> {
  const identity = await getInstanceIdentity();
  const existing = await readLock();
  const now = Date.now();
  if (existing && foreignFresh(existing, now)) {
    holding = false;
    paused = true;
    conflict = conflictOf(existing);
    if (strictMode()) throw new StrictInstanceConflict();
    armTimer();
    return;
  }
  await writeLock(identity.instanceId);
  armTimer();
}

async function tick(): Promise<void> {
  const existing = await readLock();
  const now = Date.now();
  if (existing && foreignFresh(existing, now)) {
    const wasHolding = holding;
    holding = false;
    paused = true;
    conflict = conflictOf(existing);
    if (wasHolding) return;
    return;
  }
  const wasPaused = paused;
  const identity = await getInstanceIdentity();
  await writeLock(identity.instanceId);
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
  if (existing && existing.pid === process.pid && existing.hostname === os.hostname()) {
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
  await writeLock(identity.instanceId);
}
