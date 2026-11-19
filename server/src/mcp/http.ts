import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { createRateLimiter } from "../renderDiagram.js";
import { sendError } from "../httpError.js";
import { authenticateToken, bearerValue, type AuthenticatedToken } from "../tokens.js";
import { createLocalBackend } from "./localBackend.js";
import { mcpLoopbackRejection } from "./guard.js";
import { createNerdgramMcpServer } from "./server.js";

type Session = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  tokenId: string;
};

export type MountMcpOptions = {
  renderLimiter: ReturnType<typeof createRateLimiter>;
};

/**
 * Streamable HTTP at `/mcp`. Legacy SSE is not mounted. NetClaw's `http`
 * transport is streamable HTTP and falls back from `server/discover` to the
 * initialize handshake, which this SDK speaks.
 */
export function mountMcp(app: Express, options: MountMcpOptions): void {
  const sessions = new Map<string, Session>();

  app.all("/mcp", (req, res) => {
    handleMcp(req, res, sessions, options).catch((err: unknown) => {
      if (!res.headersSent) sendError(res, err);
    });
  });
}

async function handleMcp(
  req: Request,
  res: Response,
  sessions: Map<string, Session>,
  options: MountMcpOptions,
): Promise<void> {
  const loopback = mcpLoopbackRejection(req);
  if (loopback === "host") {
    res.status(403).json({ error: "Forbidden host" });
    return;
  }
  if (loopback === "origin") {
    res.status(403).json({ error: "Forbidden origin" });
    return;
  }

  const presented = bearerValue(req.header("authorization"));
  if (!presented) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }
  const token = await authenticateToken(presented);
  if (!token) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }

  const sessionHeader = req.headers["mcp-session-id"];
  if (Array.isArray(sessionHeader)) {
    res.status(400).json({ error: "MCP session required", code: "invalid" });
    return;
  }
  if (sessionHeader) {
    const session = sessions.get(sessionHeader);
    if (!session || session.tokenId !== token.id) {
      res.status(session ? 401 : 404).json(
        session
          ? { error: "Unauthorized", code: "unauthorized" }
          : { error: "Session not found", code: "not_found" },
      );
      return;
    }
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.method === "POST" && isInitialize(req.body)) {
    await openSession(req, res, sessions, options, token);
    return;
  }

  res.status(400).json({ error: "MCP session required", code: "invalid" });
}

async function openSession(
  req: Request,
  res: Response,
  sessions: Map<string, Session>,
  options: MountMcpOptions,
  token: AuthenticatedToken,
): Promise<void> {
  let registered = false;
  let record: Session | undefined;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      if (!record) return;
      registered = true;
      sessions.set(sessionId, record);
    },
    onsessionclosed: (sessionId) => {
      const current = sessions.get(sessionId);
      sessions.delete(sessionId);
      void current?.server.close().catch(() => undefined);
    },
  });
  const server = createNerdgramMcpServer({
    scope: token.scope,
    backend: createLocalBackend({ tokenId: token.id, limiter: options.renderLimiter }),
  });
  record = { transport, server, tokenId: token.id };
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body);
  } finally {
    if (!registered) await server.close().catch(() => undefined);
  }
}

function isInitialize(body: unknown): boolean {
  return !!body && typeof body === "object" && !Array.isArray(body) && (body as { method?: unknown }).method === "initialize";
}
