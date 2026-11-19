import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { httpError } from "../httpError.js";

/**
 * PNG bytes are a render artifact in the temp directory. Diagram writes stay
 * on the store functions, which keep revisions, locks, and link repair.
 */
export async function writeRenderPng(bytes: Buffer): Promise<{ filePath: string; uri: string }> {
  const dir = path.join(os.tmpdir(), "nerdgram-mcp");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${randomUUID()}.png`);
  await fs.writeFile(filePath, bytes, { mode: 0o600 });
  return { filePath, uri: pathToFileURL(filePath).href };
}

export function toolJson(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Tool failure the model can read. Diagram source from a conflict is left out. */
export function toolFailure(err: unknown): CallToolResult {
  const { status, body } = httpError(err);
  const current = body.current;
  let currentHash: string | undefined;
  let currentPath: string | undefined;
  if (current && typeof current === "object") {
    const record = current as Record<string, unknown>;
    if (typeof record.hash === "string") currentHash = record.hash;
    if (typeof record.path === "string") currentPath = record.path;
  }
  const payload: Record<string, unknown> = {
    error: body.error,
    status,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
    ...(currentHash ? { currentHash } : {}),
    ...(currentPath ? { path: currentPath } : {}),
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export async function toolCall(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return toolJson(await work());
  } catch (err) {
    return toolFailure(err);
  }
}
