import { errnoFrom, isKnownReadErrno, unreadableMessage } from "../../../server/src/readError.ts";
import { ApiError } from "../api";

/**
 * Plain sentence for a failed diagram read.
 * A lock (423) is not a read failure, so the caller keeps the lock banner.
 * Null means this error is not a failed read.
 */
export function readFailureMessage(filePath: string, err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code === "locked" || err.status === 423) return null;
  if (err.code === "unreadable") return err.message;
  const errno = err.errno || errnoFrom(err);
  if (isKnownReadErrno(errno)) return unreadableMessage(filePath, errno);
  if (err.code === "not_found" || err.status === 404) return unreadableMessage(filePath, "ENOENT");
  if (/^E[A-Z0-9]+:/.test(err.message)) return unreadableMessage(filePath, errno);
  return null;
}
