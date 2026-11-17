import fs from "node:fs/promises";
import { tokenPath, writePrivateFile, removePrivateFile } from "./layout.js";
import { rememberSecret } from "./redact.js";

export type TokenSource = "env" | "file";

export type TokenExtras = {
  refreshToken?: string | null;
  /** Seconds until the access token expires, from the moment it is stored. */
  expiresIn?: number | null;
  /** Seconds until the refresh token expires, from the moment it is stored. */
  refreshExpiresIn?: number | null;
  /** True when this token was issued by GitHub's device flow. */
  deviceFlow?: boolean;
};

export type StoredAuth = {
  accessToken: string | null;
  refreshToken: string | null;
  /** Epoch milliseconds, or null when the access token does not expire. */
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  deviceFlow: boolean;
  source: TokenSource | null;
};

const EMPTY_AUTH: StoredAuth = {
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  refreshExpiresAt: null,
  deviceFlow: false,
  source: null,
};

/**
 * The access token is never returned to the client. An environment variable
 * wins and is not copied to disk. Otherwise the token is a mode-0600 file
 * under `.meta`, which the mirror excludes. A legacy file is the token alone.
 * A JSON file in the same path also holds the refresh token and expiry times.
 * Those values are never written to `github-sync.json`.
 */
export async function readToken(): Promise<{ token: string | null; source: TokenSource | null }> {
  const auth = await readStoredAuth();
  return { token: auth.accessToken, source: auth.source };
}

export async function readStoredAuth(): Promise<StoredAuth> {
  const fromEnv = process.env.NERDGRAM_GITHUB_TOKEN?.trim();
  if (fromEnv) {
    rememberSecret(fromEnv);
    return {
      accessToken: fromEnv,
      refreshToken: null,
      expiresAt: null,
      refreshExpiresAt: null,
      deviceFlow: false,
      source: "env",
    };
  }
  let text = "";
  try {
    text = (await fs.readFile(tokenPath(), "utf8")).trim();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...EMPTY_AUTH };
    throw err;
  }
  if (!text) return { ...EMPTY_AUTH };
  if (text.startsWith("{")) return parseTokenRecord(text);
  rememberSecret(text);
  return {
    accessToken: text,
    refreshToken: null,
    expiresAt: null,
    refreshExpiresAt: null,
    deviceFlow: false,
    source: "file",
  };
}

export async function writeToken(token: string, extras?: TokenExtras): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Refusing to store an empty token");
  rememberSecret(trimmed);
  if (process.env.NERDGRAM_GITHUB_TOKEN?.trim()) {
    // The environment variable is the source of truth and is not duplicated on disk.
    return;
  }
  const refresh = extras?.refreshToken?.trim() || "";
  if (refresh) rememberSecret(refresh);
  const expiresIn = finiteOrNull(extras?.expiresIn);
  const refreshExpiresIn = finiteOrNull(extras?.refreshExpiresIn);
  if (!refresh && expiresIn == null && refreshExpiresIn == null) {
    await writePrivateFile(tokenPath(), `${trimmed}\n`);
    return;
  }
  const now = Date.now();
  const record = {
    accessToken: trimmed,
    refreshToken: refresh || null,
    expiresAt: expiresIn == null ? null : now + expiresIn * 1000,
    refreshExpiresAt: refreshExpiresIn == null ? null : now + refreshExpiresIn * 1000,
    deviceFlow: extras?.deviceFlow === true,
  };
  await writePrivateFile(tokenPath(), `${JSON.stringify(record)}\n`);
}

export async function deleteStoredToken(): Promise<void> {
  await removePrivateFile(tokenPath());
}

function parseTokenRecord(text: string): StoredAuth {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    console.error("GitHub sync: token_file The saved GitHub token file could not be read.");
    return { ...EMPTY_AUTH };
  }
  if (!parsed || typeof parsed !== "object") return { ...EMPTY_AUTH };
  const record = parsed as Record<string, unknown>;
  const accessToken = stringField(record, "accessToken");
  const refreshToken = stringField(record, "refreshToken");
  if (accessToken) rememberSecret(accessToken);
  if (refreshToken) rememberSecret(refreshToken);
  return {
    accessToken,
    refreshToken,
    expiresAt: epochField(record, "expiresAt"),
    refreshExpiresAt: epochField(record, "refreshExpiresAt"),
    deviceFlow: record.deviceFlow === true,
    source: accessToken ? "file" : null,
  };
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function epochField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
