import type { NextFunction, Request, Response } from "express";

const NAME_TOO_LONG = "That name is too long. Each folder or file name has to be 255 bytes or fewer.";

export function httpError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err && typeof err === "object") {
    const errno = "code" in err ? String((err as { code: unknown }).code) : "";
    const explicit =
      "status" in err && typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : undefined;
    const message = err instanceof Error ? err.message : "Unknown error";
    const details =
      "details" in err &&
      (err as { details?: unknown }).details &&
      typeof (err as { details?: unknown }).details === "object"
        ? (err as { details: Record<string, unknown> }).details
        : undefined;
    const appCode =
      typeof (err as { code?: unknown }).code === "string" &&
      !/^[A-Z0-9]+$/.test(String((err as { code?: unknown }).code))
        ? String((err as { code?: unknown }).code)
        : undefined;
    const nameTooLong = errno === "ENAMETOOLONG" || message.includes("ENAMETOOLONG");

    let status = explicit ?? 500;
    let errorMessage = message;
    if (nameTooLong) {
      status = explicit ?? 400;
      errorMessage = NAME_TOO_LONG;
    } else if (explicit === undefined) {
      if (errno === "ENOENT" || message.includes("ENOENT")) {
        status = 404;
        errorMessage = "Not found";
      } else if (errno === "EACCES" || errno === "EPERM" || errno === "EROFS" || errno === "ENOSPC") {
        status = 503;
        errorMessage =
          errno === "ENOSPC"
            ? "The data folder is out of disk space."
            : errno === "EROFS"
              ? "The data folder is mounted read-only."
              : "The data folder is not writable. On a Docker bind mount, chown that directory to 1001:1001.";
      } else if (message.includes("escapes") || message.includes("Invalid")) {
        status = 400;
      }
    }

    const body: Record<string, unknown> = { error: errorMessage };
    if (appCode) body.code = appCode;
    else if (nameTooLong) body.code = "invalid";
    else if (status === 503 && (errno === "EACCES" || errno === "EPERM" || errno === "EROFS" || errno === "ENOSPC")) {
      body.code = "not_writable";
    }
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        if (key !== "error" && key !== "status" && key !== "code") body[key] = value;
      }
    }
    return { status, body };
  }
  return { status: 500, body: { error: "Unknown error" } };
}

export function sendError(res: Response, err: unknown): void {
  const { status, body } = httpError(err);
  res.status(status).json(body);
}

export type BodyParseFailure = { status: number; error: string; code: string };

/** Malformed JSON is 400. A body over the parser limit is 413. Anything else is not a body error. */
export function classifyBodyError(err: unknown): BodyParseFailure | null {
  if (!err || typeof err !== "object") return null;
  const type = "type" in err ? String((err as { type: unknown }).type) : "";
  const status = "status" in err && typeof (err as { status: unknown }).status === "number"
    ? (err as { status: number }).status
    : undefined;
  if (type === "entity.too.large" || (status === 413 && type.startsWith("entity."))) {
    return { status: 413, error: "Request body is too large.", code: "too_large" };
  }
  if (type === "entity.parse.failed") {
    return { status: 400, error: "Request body is not valid JSON.", code: "invalid" };
  }
  return null;
}

/**
 * Last-resort JSON errors. Body-parser failures become `{error, code}` and
 * one log line. Other failures use the same shape and never include a stack
 * or an absolute path from the filesystem.
 */
export function apiErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const parsed = classifyBodyError(err);
  if (parsed) {
    console.error(`${parsed.status} ${req.method} ${req.path} ${parsed.error}`);
    res.status(parsed.status).json({ error: parsed.error, code: parsed.code });
    return;
  }
  const { status, body } = httpError(err);
  const message = typeof body.error === "string" ? body.error : "Request failed";
  console.error(`${status} ${req.method} ${req.path} ${message}`);
  res.status(status).json(body);
}
