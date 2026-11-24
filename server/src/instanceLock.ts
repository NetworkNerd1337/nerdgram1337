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

type InstanceLockFile = InstanceConflict;

export class StrictInstanceConflict extends Error {
  constructor() {
    super(
      "Two instances share this data folder. NERDGRAM_STRICT_INSTANCE is set, so NerdGram refused to start.",
    );
    this.name = "StrictInstanceConflict";
  }
}

let holding = false;
let paused = false;
let conflict: InstanceConflict | null = null;
let startedAt = "";
let timer: NodeJS.Timeout | null = null;

export function resetInstanceLockForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  holding = false;
  paused = false;
  conflict = null;
  startedAt = "";
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
    return {
      instanceId: record.instanceId,
      hostname: record.hostname,
      pid: record.pid,
      startedAt: record.startedAt,
      heartbeatAt: record.heartbeatAt,
    };
  } catch {
    return null;
  }
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
    conflict = existing;
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
    conflict = existing;
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
