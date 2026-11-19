import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MCP_TOOL_CATALOG, READ_TOOL_NAMES, WRITE_TOOL_NAMES } from "../src/mcp/server.js";
import { closeRenderer } from "../src/renderDiagram.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "flowchart LR\n  A[Core] --> B[Edge]\n";

function app(extra: Parameters<typeof createApp>[0] = {}) {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    ...extra,
  });
}

async function issueToken(server: ReturnType<typeof app>, scope: "read" | "read-write") {
  const created = await request(server)
    .post("/api/tokens")
    .set("Host", HOST)
    .set("Content-Type", "application/json")
    .send({ name: scope, scope });
  expect(created.status).toBe(201);
  return created.body.token as string;
}

async function listen(server: ReturnType<typeof app>): Promise<{ port: number; close: () => Promise<void> }> {
  const httpServer = http.createServer(server);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  };
}

function textOf(result: { content?: { type: string; text?: string }[] }): string {
  const block = result.content?.find((item) => item.type === "text");
  return block?.text ?? "";
}

function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...extra };
}

describe("MCP server", () => {
  let dir = "";
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await closeRenderer();
  });

  it("returns 401 without a token or with a bad one", async () => {
    const server = app();
    const missing = await request(server)
      .post("/mcp")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe("unauthorized");

    const bad = await request(server)
      .post("/mcp")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer ng_not_a_token")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(bad.status).toBe(401);
  });

  it("rejects a Host or Origin that is not loopback", async () => {
    const server = app({
      allowedHosts: ["10.1.2.3"],
      allowedOrigins: ["http://10.9.9.9:8787"],
    });
    const token = await issueToken(server, "read-write");

    const host = await request(server)
      .post("/mcp")
      .set("Host", "10.1.2.3:8787")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${token}`)
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(host.status).toBe(403);
    expect(host.body.error).toBe("Forbidden host");

    const api = await request(server).get("/api/v1/openapi.json").set("Host", "10.1.2.3:8787");
    expect(api.status).toBe(200);

    const origin = await request(server)
      .post("/mcp")
      .set("Host", HOST)
      .set("Origin", "http://10.9.9.9:8787")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${token}`)
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(origin.status).toBe(403);
    expect(origin.body.error).toBe("Forbidden origin");

    const written = await request(server)
      .post("/api/v1/diagrams")
      .set("Host", HOST)
      .set("Origin", "http://10.9.9.9:8787")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${token}`)
      .send({ path: "Origin.mmd", content: SOURCE });
    expect(written.status).toBe(201);
  });

  it("lists tools by token scope and refuses a write from a read token", async () => {
    const server = app();
    const read = await issueToken(server, "read");
    const write = await issueToken(server, "read-write");
    const running = await listen(server);
    const readClient = new Client({ name: "read-scope", version: "1.0.0" });
    const writeClient = new Client({ name: "write-scope", version: "1.0.0" });
    try {
      await readClient.connect(httpTransport(running.port, read));
      await writeClient.connect(httpTransport(running.port, write));
      const readTools = (await readClient.listTools()).tools;
      const writeTools = (await writeClient.listTools()).tools;
      expect(readTools.map((tool) => tool.name).sort()).toEqual([...READ_TOOL_NAMES].sort());
      expect(writeTools.map((tool) => tool.name).sort()).toEqual(
        [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort(),
      );
      expect(readTools.some((tool) => tool.name === "nerdgram_trash")).toBe(false);
      for (const tool of writeTools) {
        const spec = MCP_TOOL_CATALOG.find((item) => item.name === tool.name);
        expect(spec, tool.name).toBeTruthy();
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(spec?.annotations.readOnlyHint);
        expect(tool.annotations?.destructiveHint, tool.name).toBe(spec?.annotations.destructiveHint);
      }
      const refused = await readClient.callTool({ name: "nerdgram_trash", arguments: { path: "Missing.mmd" } });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toMatch(/not found/i);
      const stillMissing = await request(server)
        .get("/api/v1/diagrams/content")
        .query({ path: "Missing.mmd" })
        .set("Host", HOST)
        .set("Authorization", `Bearer ${write}`);
      expect(stillMissing.status).toBe(404);
    } finally {
      await readClient.close().catch(() => undefined);
      await writeClient.close().catch(() => undefined);
      await running.close();
    }
  });

  it("round-trips initialize, tools, create, get, lint, svg, a stale put, and trash", async () => {
    const server = app();
    const token = await issueToken(server, "read-write");
    const running = await listen(server);
    const client = new Client({ name: "round-trip", version: "1.0.0" });
    try {
      await client.connect(httpTransport(running.port, token));
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(MCP_TOOL_CATALOG.length);

      const listed = await client.callTool({ name: "nerdgram_list", arguments: {} });
      expect(listed.isError).not.toBe(true);
      expect(textOf(listed)).toContain("folders");

      const created = await client.callTool({
        name: "nerdgram_create",
        arguments: { path: "Mcp.mmd", content: SOURCE },
      });
      expect(created.isError).not.toBe(true);

      const got = await client.callTool({ name: "nerdgram_get", arguments: { path: "Mcp.mmd" } });
      expect(got.isError).not.toBe(true);
      const file = JSON.parse(textOf(got)) as { content: string; hash: string };
      expect(file.content).toContain("Core");
      expect(file.hash).toEqual(expect.any(String));

      const lint = await client.callTool({ name: "nerdgram_lint", arguments: { path: "Mcp.mmd" } });
      expect(lint.isError).not.toBe(true);
      expect(textOf(lint)).toContain("diagnostics");

      const svg = await client.callTool({
        name: "nerdgram_render",
        arguments: { path: "Mcp.mmd", format: "svg" },
      });
      expect(svg.isError).not.toBe(true);
      expect(textOf(svg)).toContain("<svg");
      expect(textOf(svg)).not.toMatch(/"blob"/);

      const conflict = await client.callTool({
        name: "nerdgram_put",
        arguments: { path: "Mcp.mmd", content: "flowchart LR\n  A --> C\n", expectedHash: "stale-hash" },
      });
      expect(conflict.isError).toBe(true);
      expect(textOf(conflict)).toContain("conflict");
      const unchanged = await fs.readFile(path.join(dir, "Mcp.mmd"), "utf8");
      expect(unchanged).toBe(SOURCE);

      const trashed = await client.callTool({ name: "nerdgram_trash", arguments: { path: "Mcp.mmd" } });
      expect(trashed.isError).not.toBe(true);
      expect(textOf(trashed)).toContain("trashed");
      await expect(fs.access(path.join(dir, "Mcp.mmd"))).rejects.toThrow();
    } finally {
      await client.close().catch(() => undefined);
      await running.close();
    }
  }, 60_000);

  it("returns a PNG path and not a base64 blob", async () => {
    const server = app();
    const token = await issueToken(server, "read");
    const running = await listen(server);
    const client = new Client({ name: "png", version: "1.0.0" });
    try {
      await client.connect(httpTransport(running.port, token));
      const created = await request(server)
        .post("/api/v1/diagrams")
        .set("Host", HOST)
        .set("Content-Type", "application/json")
        .set("Authorization", `Bearer ${await issueToken(server, "read-write")}`)
        .send({ path: "Picture.mmd", content: SOURCE });
      expect(created.status).toBe(201);
      const rendered = await client.callTool({
        name: "nerdgram_render",
        arguments: { path: "Picture.mmd", format: "png" },
      });
      expect(rendered.isError, textOf(rendered)).not.toBe(true);
      const text = textOf(rendered);
      expect(text).toContain("PNG written to ");
      const filePath = text.replace("PNG written to ", "").trim();
      const bytes = await fs.readFile(filePath);
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(text.includes(bytes.toString("base64"))).toBe(false);
      const link = rendered.content?.find((item) => item.type === "resource_link");
      expect(link && "uri" in link ? link.uri : "").toMatch(/^file:/);
      expect(rendered.content?.some((item) => item.type === "image")).toBe(false);
    } finally {
      await client.close().catch(() => undefined);
      await running.close();
    }
  }, 60_000);

  it("round-trips nerdgram mcp over stdio", async () => {
    const server = app();
    const token = await issueToken(server, "read-write");
    const running = await listen(server);
    const client = new Client({ name: "stdio", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/cli.ts", "mcp"],
      cwd: serverRoot,
      env: childEnv({
        NERDGRAM_URL: `http://127.0.0.1:${running.port}`,
        NERDGRAM_TOKEN: token,
      }),
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
        [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort(),
      );
      const created = await client.callTool({
        name: "nerdgram_create",
        arguments: { path: "Stdio.mmd", content: SOURCE },
      });
      expect(created.isError).not.toBe(true);
      const got = await client.callTool({ name: "nerdgram_get", arguments: { path: "Stdio.mmd" } });
      expect(textOf(got)).toContain("Core");
      const onDisk = await fs.readFile(path.join(dir, "Stdio.mmd"), "utf8");
      expect(onDisk).toBe(SOURCE);
    } finally {
      await client.close().catch(() => undefined);
      await running.close();
    }
  }, 30_000);

  it("exits when nerdgram mcp has no token", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "mcp"], {
      cwd: serverRoot,
      env: childEnv({ NERDGRAM_TOKEN: "", NERDGRAM_URL: "http://127.0.0.1:9" }),
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const code = await new Promise<number>((resolve) => {
      child.on("close", (status) => resolve(status ?? 1));
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/NERDGRAM_TOKEN/);
  });
});

function httpTransport(port: number, token: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
}
