import fs from "node:fs/promises";
import path from "node:path";
import {
  externalDataDir,
  readStartupDataDir,
  saveStartupDataDir,
} from "./instanceConfig.js";
import { defaultDataRoot, getDataRoot } from "./paths.js";
import { httpFail } from "./storage.js";
import { loadConfig } from "./sync/configStore.js";
import { detectInstallKind } from "./updates/installKind.js";

export type DataDirSource = "env" | "docker" | "saved" | "default";

export type DataDirStatus = {
  /** Value in the text box. */
  saved: string;
  /** Folder this process is reading and writing. */
  running: string;
  /** True when the startup config stores NERDGRAM_DATA_DIR. */
  persisted: boolean;
  source: DataDirSource;
  /** External NERDGRAM_DATA_DIR, when the process was started with one. */
  envValue: string | null;
  /**
   * Where an external value comes from. `shell` covers a shell or a service
   * file. `docker` is the image environment and the volume mount.
   */
  envSource: "shell" | "docker" | null;
  envManaged: boolean;
  docker: boolean;
  /** GitHub sync is on, so this field is not the shared-folder setup. */
  githubSync: boolean;
  readOnly: boolean;
  /** True while the saved folder differs from the folder this process started with. */
  restartNotice: boolean;
  /** Install default when nothing is set. */
  defaultPath: string;
};

const PATH_MAX = 4096;

function sameFolder(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  try {
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}

export function dataDirRestartNotice(input: {
  readOnly: boolean;
  persisted: string | null;
  running: string;
}): boolean {
  if (input.readOnly || !input.persisted) return false;
  return !sameFolder(input.persisted, input.running);
}

async function probeWritable(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.nerdgram-write-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(probe, "");
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    await fs.rm(probe, { force: true }).catch(() => undefined);
    return false;
  }
}

/**
 * The path must exist and be a writable directory, or its parent must exist
 * so the folder can be created. The saved value is absolute. It is stored
 * as NERDGRAM_DATA_DIR.
 */
export async function validateDataDir(value: unknown): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (typeof value !== "string") return { ok: false, error: "Diagram folder must be a path." };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Diagram folder is required." };
  if (trimmed.length > PATH_MAX) return { ok: false, error: "Diagram folder is too long." };
  if (trimmed.includes("\0") || /[\u0000-\u001f]/.test(trimmed)) {
    return { ok: false, error: "Diagram folder cannot include control characters." };
  }
  const resolved = path.resolve(trimmed);
  let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") return { ok: false, error: "That folder could not be opened." };
  }
  if (stat) {
    if (!stat.isDirectory()) return { ok: false, error: "That path is a file. Choose a folder." };
    if (!(await probeWritable(resolved))) return { ok: false, error: "That folder is not writable." };
    return { ok: true, path: resolved };
  }
  const parent = path.dirname(resolved);
  if (parent === resolved) return { ok: false, error: "That folder cannot be created." };
  let parentStat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    parentStat = await fs.stat(parent);
  } catch {
    return {
      ok: false,
      error: "That folder cannot be created. The parent directory has to exist and be writable.",
    };
  }
  if (!parentStat.isDirectory() || !(await probeWritable(parent))) {
    return {
      ok: false,
      error: "That folder cannot be created. The parent directory has to exist and be writable.",
    };
  }
  return { ok: true, path: resolved };
}

export async function describeDataDir(): Promise<DataDirStatus> {
  const docker = detectInstallKind() === "docker";
  const external = externalDataDir();
  const envManaged = Boolean(external?.trim());
  const githubSync = (await loadConfig()).enabled;
  const running = getDataRoot();
  const persistedValue = readStartupDataDir();
  const readOnly = docker || envManaged || githubSync;
  const envValue = envManaged && external ? path.resolve(external) : null;
  let source: DataDirSource = "default";
  let saved = defaultDataRoot();
  if (envManaged && envValue) {
    source = docker ? "docker" : "env";
    saved = envValue;
  } else if (docker || githubSync) {
    source = docker ? "docker" : persistedValue ? "saved" : "default";
    saved = running;
  } else if (persistedValue) {
    source = "saved";
    saved = path.resolve(persistedValue);
  }
  return {
    saved,
    running,
    persisted: Boolean(persistedValue),
    source,
    envValue,
    envSource: envManaged ? (docker ? "docker" : "shell") : docker ? "docker" : null,
    envManaged,
    docker,
    githubSync,
    readOnly,
    restartNotice: dataDirRestartNotice({
      readOnly,
      persisted: persistedValue,
      running,
    }),
    defaultPath: defaultDataRoot(),
  };
}

export async function saveDataDir(value: unknown): Promise<DataDirStatus> {
  const current = await describeDataDir();
  if (current.docker) {
    throw httpFail(
      409,
      "The Diagram folder is read-only in Docker. Change the volume mount. The image sets NERDGRAM_DATA_DIR.",
      "read_only",
    );
  }
  if (current.envManaged) {
    throw httpFail(
      409,
      "NERDGRAM_DATA_DIR is set in the environment. That value is the source of truth until the variable is unset.",
      "read_only",
    );
  }
  if (current.githubSync) {
    throw httpFail(
      409,
      "The Diagram folder setting is disabled while GitHub sync is on. Each instance keeps its own copy.",
      "read_only",
    );
  }
  const parsed = await validateDataDir(value);
  if (!parsed.ok) throw httpFail(400, parsed.error, "invalid");
  await fs.mkdir(parsed.path, { recursive: true });
  await saveStartupDataDir(parsed.path);
  return describeDataDir();
}
