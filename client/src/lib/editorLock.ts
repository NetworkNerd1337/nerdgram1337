import { api, type LockConflict } from "../api";

const RELEASE_URL = "/api/lock/release";

export const OTHER_WINDOW_NOTE =
  "This diagram is open in another window on this computer. You can view it, but changes are not saved.";

export const STILL_HELD_NOTE =
  "The other window is still editing this diagram. Take over works once that lock stops refreshing.";

export type RemoteLockAlert = {
  diagramName: string;
  instanceName: string;
  hostname: string | null;
  since: string;
};

export function formatOpenSince(iso: string | null | undefined): string {
  if (!iso) return "an unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Same-computer locks keep the existing banner sentence. Another instance
 * gets the holder, the hostname when it differs from the instance name, and
 * the time the diagram was opened.
 */
export function remoteLockAlert(
  diagramName: string,
  lock: LockConflict | null | undefined,
): RemoteLockAlert | null {
  if (!lock || lock.sameInstance !== false) return null;
  const instanceName = lock.instanceName?.trim() || lock.hostname?.trim() || "another instance";
  const hostname = lock.hostname?.trim() || null;
  return {
    diagramName,
    instanceName,
    hostname: hostname && hostname !== instanceName ? hostname : null,
    since: formatOpenSince(lock.acquiredAt),
  };
}

export function remoteLockSentence(alert: RemoteLockAlert): string {
  const host = alert.hostname ? ` (${alert.hostname})` : "";
  return `${alert.diagramName} is open on ${alert.instanceName}${host} since ${alert.since}. Try again when it's closed.`;
}

export function stillHeldNote(lock: LockConflict | null | undefined): string {
  if (!lock || lock.sameInstance !== false) return STILL_HELD_NOTE;
  const name = lock.instanceName?.trim() || lock.hostname?.trim();
  if (!name) return STILL_HELD_NOTE;
  return `${name} is still editing this diagram. Take over works once that lock stops refreshing.`;
}

/** JSON body queued with sendBeacon. The mutation guard requires application/json. */
export function lockReleaseBeaconBody(path: string, token: string): Blob {
  return new Blob([JSON.stringify({ path, token })], { type: "application/json" });
}

type ReleaseTransport = {
  sendBeacon?: (url: string, data: Blob) => boolean;
  keepaliveRelease?: (path: string, token: string) => void;
};

/**
 * Release an editor lock without depending on a fetch the browser can abort
 * during navigation (`net::ERR_ABORTED`). sendBeacon is queued for delivery.
 * A keepalive fetch is the fallback when beacon is unavailable or refuses.
 */
export function releaseEditorLock(path: string, token: string, transport?: ReleaseTransport): boolean {
  const body = lockReleaseBeaconBody(path, token);
  const send =
    transport?.sendBeacon ??
    (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? (url: string, data: Blob) => navigator.sendBeacon(url, data)
      : undefined);
  if (send?.(RELEASE_URL, body)) return true;
  if (transport?.keepaliveRelease) {
    transport.keepaliveRelease(path, token);
    return false;
  }
  void api.releaseLock(path, token, { keepalive: true }).catch(() => undefined);
  return false;
}
