import type { Request } from "express";
import { isLoopbackBindHost, normalizeOrigin, parseHostHeader } from "../security.js";

/**
 * DNS-rebinding check for `/mcp`. Loopback names only: localhost, 127.0.0.1,
 * any other 127.x.x.x address, and ::1. A missing Origin is allowed. A
 * present Origin has to be loopback too, on any port.
 */
export function mcpLoopbackRejection(req: Request): "host" | "origin" | null {
  const hostHeader = headerOne(req.headers.host);
  if (!hostHeader) return "host";
  const parsed = parseHostHeader(hostHeader);
  if (!parsed || !isLoopbackBindHost(parsed.hostname)) return "host";

  const originHeader = req.headers.origin;
  if (Array.isArray(originHeader)) return "origin";
  if (originHeader == null || originHeader === "") return null;
  const normalized = normalizeOrigin(originHeader);
  if (!normalized) return "origin";
  let hostname: string;
  try {
    hostname = new URL(normalized).hostname;
  } catch {
    return "origin";
  }
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  if (!isLoopbackBindHost(hostname)) return "origin";
  return null;
}

function headerOne(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}
