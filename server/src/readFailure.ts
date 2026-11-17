import { errnoFrom, isKnownReadErrno, unreadableMessage } from "./readError.js";
import { httpFail } from "./storage.js";

/**
 * Turn a known read errno into a 500 the API can show in plain words.
 * Other errors, including a missing file and an editor lock, are left alone.
 */
export function rethrowKnownReadError(filePath: string, err: unknown): void {
  if (err && typeof err === "object" && "status" in err) return;
  const code = errnoFrom(err);
  if (!isKnownReadErrno(code)) return;
  throw httpFail(500, unreadableMessage(filePath, code), "unreadable", { errno: code });
}
