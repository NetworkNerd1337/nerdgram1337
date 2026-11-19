import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { httpFail } from "../storage.js";
import { createHttpBackend, probeTokenScope } from "./httpBackend.js";
import { createNerdgramMcpServer } from "./server.js";

/**
 * `nerdgram mcp` is a stdio MCP server. Tool calls go to a running NerdGram
 * over `/api/v1`, using NERDGRAM_URL and NERDGRAM_TOKEN. stdout is the protocol.
 */
export async function runMcpStdio(options: { base: string; token: string }): Promise<void> {
  const base = options.base.replace(/\/+$/, "");
  const token = options.token.trim();
  if (!token) throw httpFail(401, "Set NERDGRAM_TOKEN or pass --token.", "unauthorized");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw httpFail(400, "NERDGRAM_URL is not a URL.", "invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw httpFail(400, "NERDGRAM_URL must be http or https.", "invalid");
  }

  const scope = await probeTokenScope(base, token);
  const server: McpServer = createNerdgramMcpServer({
    scope,
    backend: createHttpBackend({ base, token }),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    const previous = transport.onclose;
    transport.onclose = () => {
      void Promise.resolve(previous?.()).finally(() => resolve());
    };
  });
}
