import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Per-install settings. This file is not in the diagram folder, so two
 * instances that share one NERDGRAM_DATA_DIR keep their own ids.
 *
 * NERDGRAM_DATA_DIR in this file is the Diagram folder setting. getDataRoot()
 * still reads the environment variable. Startup copies the saved value into
 * the environment only when the process was not given one.
 *
 * listenHost is the Host setting. It stays in this file and is never copied
 * into the HOST environment variable. HOST, when set, still wins at bind time.
 * A saved 127.0.0.1 is the loopback pair, which is not the same as HOST=127.0.0.1.
 */
export type InstanceFile = {
  instanceId: string;
  instanceName?: string;
  hostname?: string;
  NERDGRAM_DATA_DIR?: string;
  /** Saved Host setting. Absent until a save or a one-time migration from the data folder. */
  listenHost?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** NERDGRAM_DATA_DIR as this process was started. A later assignment is not external. */
const processStartDataDir = process.env.NERDGRAM_DATA_DIR?.trim() || null;

let externalForTests: string | null | undefined;

export function homeInstanceFilePath(): string {
  return path.join(os.homedir(), ".nerdgram", "instance.json");
}

/** Docker and a tmpfs home lose ~/.nerdgram when the container is recreated. */
export function instanceLivesInDataDir(): boolean {
  if (process.env.NERDGRAM_INSTALL === "docker") return true;
  const home = os.homedir();
  return home === "/tmp" || home.startsWith("/tmp/");
}

export function instanceFilePath(): string {
  const override = process.env.NERDGRAM_INSTANCE_FILE?.trim();
  if (override) return path.resolve(override);
  const root = process.env.NERDGRAM_DATA_DIR?.trim();
  if (instanceLivesInDataDir() && root) return path.join(path.resolve(root), ".meta", "instance.json");
  return homeInstanceFilePath();
}

function copyHomeInstanceOnce(target: string): void {
  if (path.resolve(target) === path.resolve(homeInstanceFilePath())) return;
  if (fs.existsSync(target)) return;
  const home = homeInstanceFilePath();
  if (!fs.existsSync(home)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(home, target);
}

/** Set in the shell, a service file, or Docker. Null when this process was started without it. */
export function externalDataDir(): string | null {
  if (externalForTests !== undefined) return externalForTests;
  return processStartDataDir;
}

/** Tests simulate a process that was started with NERDGRAM_DATA_DIR. */
export function setExternalDataDirForTests(value: string | null | undefined): void {
  externalForTests = value;
}

export function readInstanceFileSync(): InstanceFile | null {
  try {
    const target = instanceFilePath();
    copyHomeInstanceOnce(target);
    const raw = fs.readFileSync(target, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as InstanceFile;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || err instanceof SyntaxError) return null;
    throw err;
  }
}

export function readStartupDataDir(): string | null {
  const value = readInstanceFileSync()?.NERDGRAM_DATA_DIR;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

let startupApplied = false;

/**
 * Copy the saved Diagram folder into NERDGRAM_DATA_DIR when the process was
 * not given that variable. A save writes the file and leaves this process's
 * environment alone, so the running folder changes on the next start.
 */
export function applyStartupDataDir(): void {
  if (startupApplied) return;
  startupApplied = true;
  if (externalDataDir()) return;
  if (process.env.NERDGRAM_DATA_DIR?.trim()) return;
  const saved = readStartupDataDir();
  if (saved) process.env.NERDGRAM_DATA_DIR = saved;
}

export function resetStartupDataDirForTests(): void {
  startupApplied = false;
}

export type InstanceIdentity = {
  instanceId: string;
  /** Shown to other instances. The hostname when no name has been saved. */
  instanceName: string;
  hostname: string;
  configuredName: string | null;
};

let identityCache: InstanceIdentity | null = null;
let identityCachePath = "";

export function clearInstanceIdentityCache(): void {
  identityCache = null;
  identityCachePath = "";
}

function machineHostname(): string {
  const name = os.hostname().trim();
  return name || "localhost";
}

function displayName(configured: string | null | undefined, hostname: string): string {
  const trimmed = configured?.trim() ?? "";
  return trimmed || hostname;
}

async function writeInstanceFile(file: InstanceFile): Promise<void> {
  const target = instanceFilePath();
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rename(tmp, target);
}

export async function getInstanceIdentity(): Promise<InstanceIdentity> {
  const filePath = instanceFilePath();
  copyHomeInstanceOnce(filePath);
  if (identityCache && identityCachePath === filePath) return identityCache;
  const hostname = machineHostname();
  const existing = readInstanceFileSync();
  let instanceId = existing?.instanceId?.trim() ?? "";
  if (!UUID_RE.test(instanceId)) instanceId = randomUUID();
  const configured = typeof existing?.instanceName === "string" ? existing.instanceName.trim() : "";
  const next: InstanceFile = {
    ...(existing ?? { instanceId }),
    instanceId,
    hostname,
  };
  if (configured) next.instanceName = configured;
  else delete next.instanceName;
  await writeInstanceFile(next);
  identityCache = {
    instanceId,
    instanceName: displayName(configured, hostname),
    hostname,
    configuredName: configured || null,
  };
  identityCachePath = filePath;
  return identityCache;
}

/** What a person can type. A saved longer name and the hostname fallback are not cut down to this. */
const NAME_MAX = 32;

export function parseInstanceName(value: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Instance name must be text." };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, name: "" };
  if (trimmed.length > NAME_MAX) {
    return { ok: false, error: `Instance name must be ${NAME_MAX} characters or fewer.` };
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, error: "Instance name cannot contain control characters." };
  }
  return { ok: true, name: trimmed };
}

export async function saveInstanceName(name: string): Promise<InstanceIdentity> {
  const identity = await getInstanceIdentity();
  const file = readInstanceFileSync() ?? { instanceId: identity.instanceId };
  file.instanceId = identity.instanceId;
  file.hostname = identity.hostname;
  if (name) file.instanceName = name;
  else delete file.instanceName;
  await writeInstanceFile(file);
  clearInstanceIdentityCache();
  return getInstanceIdentity();
}

export async function saveStartupDataDir(value: string | null): Promise<void> {
  const identity = await getInstanceIdentity();
  const file = readInstanceFileSync() ?? { instanceId: identity.instanceId };
  file.instanceId = identity.instanceId;
  file.hostname = identity.hostname;
  if (identity.configuredName) file.instanceName = identity.configuredName;
  if (value && value.trim()) file.NERDGRAM_DATA_DIR = value.trim();
  else delete file.NERDGRAM_DATA_DIR;
  await writeInstanceFile(file);
}

/**
 * The Host field in the instance file. `present` is false when the key has
 * never been written, which is the only time a legacy data-folder file is read.
 */
export function readInstanceListenHost(): { present: boolean; value: unknown } {
  const existing = readInstanceFileSync();
  if (!existing || !Object.prototype.hasOwnProperty.call(existing, "listenHost")) {
    return { present: false, value: undefined };
  }
  return { present: true, value: existing.listenHost };
}

export async function saveInstanceListenHost(host: string): Promise<void> {
  const identity = await getInstanceIdentity();
  const file = readInstanceFileSync() ?? { instanceId: identity.instanceId };
  file.instanceId = identity.instanceId;
  file.hostname = identity.hostname;
  if (identity.configuredName) file.instanceName = identity.configuredName;
  else delete file.instanceName;
  file.listenHost = host;
  await writeInstanceFile(file);
}
