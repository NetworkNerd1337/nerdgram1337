/**
 * Plain-language explanations for a diagram that could not be read.
 * A sync placeholder or a disconnected share fails the read. That is not a
 * Mermaid parse error, and it is not an editor lock.
 */

export type UnreadableDiagram = {
  path: string;
  /** Errno such as EIO. Empty when the runtime did not set one. */
  code: string;
  message: string;
};

const READ_REASONS: Record<string, string> = {
  EIO: "The file may still be syncing or the folder may be unavailable on this computer",
  EACCES: "This computer does not have permission to read the file",
  EPERM: "This computer does not have permission to read the file",
  ENOENT: "The file was removed or renamed before it could be read",
  EBUSY: "The file is busy and could not be read",
  ETIMEDOUT: "Reading the file timed out. The folder may be slow or unavailable",
};

const KNOWN_READ_ERRNOS = new Set(Object.keys(READ_REASONS));

export function isKnownReadErrno(code: string): boolean {
  return KNOWN_READ_ERRNOS.has(code);
}

/** Workspace-relative path, or just the file name when the input is absolute. */
export function fileLabel(filePath: string): string {
  const absolute = filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath);
  if (!absolute) return filePath || "diagram";
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  return name || filePath;
}

/** One log line for a library walk that is continuing without this file. */
export function unreadableWarning(filePath: string, code: string): string {
  const suffix = code ? ` (${code})` : "";
  return `Couldn't read ${fileLabel(filePath)}${suffix}.`;
}

export function warnUnreadable(items: readonly { path: string; code: string }[]): void {
  for (const item of items) console.warn(unreadableWarning(item.path, item.code));
}

/** One sentence. The errno, when there is one, sits in parentheses. Never the raw errno text alone. */
export function unreadableMessage(filePath: string, code: string): string {
  const reason = READ_REASONS[code] ?? "The file could not be read";
  const suffix = code ? ` (${code})` : "";
  return `Couldn't read \`${fileLabel(filePath)}\`. ${reason}${suffix}.`;
}

function detailsErrno(err: unknown): string {
  if (!err || typeof err !== "object" || !("details" in err)) return "";
  const details = (err as { details?: unknown }).details;
  if (!details || typeof details !== "object" || !("errno" in details)) return "";
  const errno = (details as { errno?: unknown }).errno;
  return typeof errno === "string" ? errno : "";
}

function errnoInText(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  const match = message.match(/\b(EIO|EACCES|EPERM|ENOENT|EBUSY|ETIMEDOUT)\b/);
  return match?.[1] ?? "";
}

/** Filesystem errno on a thrown error, including one already wrapped as unreadable. */
export function errnoFrom(err: unknown): string {
  const fromDetails = detailsErrno(err);
  if (/^E[A-Z0-9]+$/.test(fromDetails)) return fromDetails;
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    if (/^E[A-Z0-9]+$/.test(code)) return code;
  }
  return errnoInText(err);
}

function isMissingFile(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("code" in err && (err as { code?: unknown }).code === "not_found") return true;
  return "status" in err && (err as { status?: unknown }).status === 404;
}

/**
 * One failed read, for a workspace check that continues with the other files.
 * The sentence uses the workspace path, not a message built from a basename.
 */
export function reportUnreadable(filePath: string, err: unknown): UnreadableDiagram {
  const code = errnoFrom(err) || (isMissingFile(err) ? "ENOENT" : "");
  return { path: filePath, code, message: unreadableMessage(filePath, code) };
}
