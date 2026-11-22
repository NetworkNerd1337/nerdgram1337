const SESSION_KEY = "nerdgram-editor-session";

export type StoredLock = {
  token: string;
  sessionId: string;
};

function lockStorageKey(path: string): string {
  return `nerdgram-lock:${path}`;
}

function randomSessionId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function editorSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = randomSessionId();
  sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

export function readStoredLock(path: string): StoredLock | null {
  const raw = sessionStorage.getItem(lockStorageKey(path));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredLock>;
    if (!parsed.token || !parsed.sessionId) return null;
    return { token: parsed.token, sessionId: parsed.sessionId };
  } catch {
    return null;
  }
}

export function writeStoredLock(path: string, lock: StoredLock): void {
  sessionStorage.setItem(lockStorageKey(path), JSON.stringify(lock));
}

export function clearStoredLock(path: string): void {
  sessionStorage.removeItem(lockStorageKey(path));
}

const handoffs = new Set<string>();

function handoffKey(path: string, token: string): string {
  return `${path}\0${token}`;
}

/**
 * The editor renamed `from` to `to` and kept this tab's lock. The stored token
 * moves with the path. A delayed release of the old path must not clear it.
 */
export function handoffStoredLock(
  from: string,
  to: string,
  token: string | null,
  sessionId: string,
): void {
  const stored = readStoredLock(from);
  const lock = stored ?? (token ? { token, sessionId } : null);
  if (!lock) return;
  writeStoredLock(to, lock);
  clearStoredLock(from);
  handoffs.add(handoffKey(from, lock.token));
}

/** True once, when this path and token were just handed to a renamed file. */
export function consumeLockHandoff(path: string, token: string): boolean {
  const key = handoffKey(path, token);
  if (!handoffs.has(key)) return false;
  handoffs.delete(key);
  return true;
}

const epochs = new Map<string, number>();
const releaseTimers = new Map<string, number>();

export function nextEditorEpoch(path: string): number {
  const next = (epochs.get(path) ?? 0) + 1;
  epochs.set(path, next);
  return next;
}

export function editorEpochIsCurrent(path: string, epoch: number): boolean {
  return epochs.get(path) === epoch;
}

export function cancelScheduledLockRelease(path: string): void {
  const timer = releaseTimers.get(path);
  if (timer == null) return;
  window.clearTimeout(timer);
  releaseTimers.delete(path);
}

/** Delay release so React's development remount does not drop the lock. */
export function scheduleLockRelease(path: string, release: () => void): void {
  cancelScheduledLockRelease(path);
  const timer = window.setTimeout(() => {
    releaseTimers.delete(path);
    release();
  }, 400);
  releaseTimers.set(path, timer);
}
