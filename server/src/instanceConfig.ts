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

/** Docker, and a home directory on /tmp, must not put the instance id on the library. */
export function identityStaysOffVolume(): boolean {
  if (process.env.NERDGRAM_INSTALL === "docker") return true;
  const home = os.homedir();
  return home === "/tmp" || home.startsWith("/tmp/");
}

/** Container-local identity. A tmpfs on /tmp keeps this off the data volume. */
export function containerInstanceFilePath(): string {
  return path.join("/tmp", ".nerdgram", "instance.json");
}

export function instanceFilePath(): string {
  const override = process.env.NERDGRAM_INSTANCE_FILE?.trim();
  if (override) return path.resolve(override);
  if (identityStaysOffVolume()) return containerInstanceFilePath();
  return homeInstanceFilePath();
}

function legacyDataInstancePath(): string | null {
  const root = process.env.NERDGRAM_DATA_DIR?.trim();
  if (!root) return null;
  return path.join(path.resolve(root), ".meta", "instance.json");
}

/**
 * A fresh instance lock with this id belongs to a live copy. Adopting that
 * id would make two machines look like one install. Same window as the
 * instance heartbeat (45 seconds).
 */
function sharedLockHoldsId(instanceId: string): boolean {
  const root = process.env.NERDGRAM_DATA_DIR?.trim();
  if (!root || !instanceId) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(path.resolve(root), ".meta", "instance-lock.json"), "utf8")) as {
      instanceId?: unknown;
      hostname?: unknown;
      pid?: unknown;
      heartbeatAt?: unknown;
    };
    if (parsed.instanceId !== instanceId) return false;
    const age = Date.now() - Date.parse(String(parsed.heartbeatAt ?? ""));
    if (!Number.isFinite(age) || age < 0 || age >= 45_000) return false;
    if (parsed.hostname === os.hostname() && parsed.pid === process.pid) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy an older identity into the local file once. The library copy is left
 * as it was, including its hostname. A live lock that already uses that id
 * keeps it; this process takes a new id and the saved name, Host, and folder.
 */
function adoptLegacyInstance(target: string): void {
  try {
    if (fs.existsSync(target)) return;
    const sources = [legacyDataInstancePath(), homeInstanceFilePath()].filter((item): item is string => Boolean(item));
    for (const source of sources) {
      if (path.resolve(source) === path.resolve(target)) continue;
      if (!fs.existsSync(source)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(source, "utf8")) as unknown;
      } catch {
        continue;
      }
      const file = normalizeInstance(parsed);
      if (!file?.instanceId) continue;
      const fromLibrary = legacyDataInstancePath() != null && path.resolve(source) === path.resolve(legacyDataInstancePath()!);
      if (fromLibrary && sharedLockHoldsId(file.instanceId)) file.instanceId = randomUUID();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      return;
    }
  } catch {
    // A missing legacy file must not stop startup. A new id is created in memory.
  }
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

type InstanceStartupNote = { file: string; message: string };

const warnedInstancePaths = new Set<string>();
let instanceNoteSink: ((note: InstanceStartupNote) => void) | null = null;

/** dataHealth records the note. instanceConfig does not import it. */
export function onInstanceStartupNote(sink: (note: InstanceStartupNote) => void): void {
  instanceNoteSink = sink;
}

export function resetInstanceStartupForTests(): void {
  warnedInstancePaths.clear();
  startupApplied = false;
  identityCache = null;
  identityCachePath = "";
}

function errnoOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === "string" && code ? code : "error";
}

function instanceReadWarning(fileName: string, reason: string): string {
  return `NerdGram checked ${fileName}, one of its own settings/history files (not your diagrams), and could not read it (${reason}). Your diagrams were not changed. NerdGram is using a fresh copy of that file. This folder may be in iCloud Drive, Dropbox, OneDrive, or another cloud-synced folder, and the file may not be downloaded yet. Move the data folder to a local folder or an SMB or NFS share, then start NerdGram again.`;
}

function noteUnreadableInstance(target: string, reason: string): void {
  const fileName = path.basename(target);
  const message = instanceReadWarning(fileName, reason);
  if (!warnedInstancePaths.has(target)) {
    warnedInstancePaths.add(target);
    console.warn(message);
  }
  instanceNoteSink?.({ file: fileName, message });
}

/** Keep the bad bytes when the rename works. A failed rewrite still leaves memory defaults. */
function recoverUnreadableInstance(target: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    fs.renameSync(target, `${target}.unreadable-${stamp}`);
    return;
  } catch {
    // The cloud file may refuse the rename. Try a fresh copy only when this path is not a directory.
  }
  let directory = false;
  try {
    directory = fs.statSync(target).isDirectory();
  } catch {
    directory = false;
  }
  if (directory) return;
  try {
    fs.writeFileSync(target, "{}\n", { mode: 0o600 });
  } catch {
    // In-memory defaults. Diagrams are not touched.
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Current files use instanceId, instanceName, and listenHost. Older files used
 * id, name, and host. Both are accepted. A non-object is not a usable file.
 */
function normalizeInstance(parsed: unknown): InstanceFile | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const file: InstanceFile = { instanceId: stringField(record.instanceId) || stringField(record.id) };
  const instanceName = stringField(record.instanceName) || stringField(record.name);
  const hostname = stringField(record.hostname);
  const dataDir = stringField(record.NERDGRAM_DATA_DIR);
  const listenHost = stringField(record.listenHost) || stringField(record.host);
  if (instanceName) file.instanceName = instanceName;
  if (hostname) file.hostname = hostname;
  if (dataDir) file.NERDGRAM_DATA_DIR = dataDir;
  if (listenHost) file.listenHost = listenHost;
  return file;
}

export function readInstanceFileSync(): InstanceFile | null {
  const target = instanceFilePath();
  adoptLegacyInstance(target);
  let raw: string;
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      noteUnreadableInstance(target, "EISDIR");
      recoverUnreadableInstance(target);
      return null;
    }
    raw = fs.readFileSync(target, "utf8");
  } catch (err) {
    if (errnoOf(err) === "ENOENT") return null;
    noteUnreadableInstance(target, errnoOf(err));
    recoverUnreadableInstance(target);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    noteUnreadableInstance(target, "invalid JSON");
    recoverUnreadableInstance(target);
    return null;
  }
  const normalized = normalizeInstance(parsed);
  if (!normalized) {
    noteUnreadableInstance(target, "wrong shape");
    recoverUnreadableInstance(target);
    return null;
  }
  return normalized;
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

/**
 * Another live install already holds the library. Do not rewrite its snapshot.
 * This process's own lock, a stale lock, and a missing lock do not count.
 */
function snapshotOwnedByOther(ourId: string): boolean {
  const root = process.env.NERDGRAM_DATA_DIR?.trim();
  if (!root || !ourId) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(path.resolve(root), ".meta", "instance-lock.json"), "utf8")) as {
      instanceId?: unknown;
      hostname?: unknown;
      pid?: unknown;
      heartbeatAt?: unknown;
    };
    const age = Date.now() - Date.parse(String(parsed.heartbeatAt ?? ""));
    if (!Number.isFinite(age) || age < 0 || age >= 45_000) return false;
    if (parsed.hostname === os.hostname() && parsed.pid === process.pid) return false;
    if (parsed.instanceId === ourId && parsed.hostname === os.hostname()) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Docker keeps a copy under the data folder so recreating the only container
 * keeps the name, Host, and id. The process itself reads the container-local
 * file. A second live install does not overwrite that copy.
 */
function writeInstanceSnapshot(file: InstanceFile, force: boolean): void {
  if (!identityStaysOffVolume()) return;
  if (process.env.NERDGRAM_INSTANCE_FILE?.trim()) return;
  const legacy = legacyDataInstancePath();
  if (!legacy || path.resolve(legacy) === path.resolve(instanceFilePath())) return;
  const exists = fs.existsSync(legacy);
  if (!force && exists) return;
  if (exists && snapshotOwnedByOther(file.instanceId)) return;
  try {
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // A read-only library still leaves this process with its local file.
  }
}

async function writeInstanceFile(file: InstanceFile, options?: { snapshot?: boolean }): Promise<void> {
  const target = instanceFilePath();
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  const body = `${JSON.stringify(file, null, 2)}\n`;
  await fs.promises.writeFile(tmp, body, { mode: 0o600 });
  await fs.promises.rename(tmp, target);
  writeInstanceSnapshot(file, options?.snapshot === true);
}

export async function getInstanceIdentity(): Promise<InstanceIdentity> {
  const filePath = instanceFilePath();
  adoptLegacyInstance(filePath);
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
  try {
    await writeInstanceFile(next);
  } catch (err) {
    noteUnreadableInstance(filePath, errnoOf(err));
  }
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

/** A second process adopted the same id from a shared file. The local file gets a new id. */
export async function regenerateInstanceId(): Promise<InstanceIdentity> {
  const identity = await getInstanceIdentity();
  const file = readInstanceFileSync() ?? { instanceId: identity.instanceId };
  file.instanceId = randomUUID();
  file.hostname = identity.hostname;
  if (identity.configuredName) file.instanceName = identity.configuredName;
  await writeInstanceFile(file);
  clearInstanceIdentityCache();
  return getInstanceIdentity();
}

export async function saveInstanceName(name: string): Promise<InstanceIdentity> {
  const identity = await getInstanceIdentity();
  const file = readInstanceFileSync() ?? { instanceId: identity.instanceId };
  file.instanceId = identity.instanceId;
  file.hostname = identity.hostname;
  if (name) file.instanceName = name;
  else delete file.instanceName;
  await writeInstanceFile(file, { snapshot: true });
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
  await writeInstanceFile(file, { snapshot: true });
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
  await writeInstanceFile(file, { snapshot: true });
}
