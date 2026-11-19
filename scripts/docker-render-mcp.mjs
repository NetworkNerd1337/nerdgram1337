/**
 * Called over stdin inside the image (`node --input-type=module`, cwd
 * /app/server) so the MCP client resolves from that image's node_modules.
 * Renders Welcome.mmd as SVG and PNG through nerdgram_render.
 */
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const token = process.env.NERDGRAM_TOKEN || "";
const base = process.env.NERDGRAM_URL || "http://127.0.0.1:8787";
const platform = process.env.SMOKE_PLATFORM || "";
if (!token.startsWith("ng_")) {
  console.error("NERDGRAM_TOKEN is required");
  process.exit(1);
}

function textOf(result) {
  return (result.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("\n");
}

const client = new Client({ name: "render-smoke", version: "1" });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
await client.connect(transport);
try {
  const svg = await client.callTool({
    name: "nerdgram_render",
    arguments: { path: "Welcome.mmd", format: "svg" },
  });
  const svgText = textOf(svg);
  if (svg.isError || !svgText.includes("<svg")) {
    console.error(svgText || "mcp svg failed");
    process.exit(1);
  }
  console.log(`render smoke ${platform}: mcp svg ok`);

  const png = await client.callTool({
    name: "nerdgram_render",
    arguments: { path: "Welcome.mmd", format: "png" },
  });
  const pngText = textOf(png);
  if (png.isError || !pngText.includes("PNG written to ")) {
    console.error(pngText || "mcp png failed");
    process.exit(1);
  }
  const filePath = pngText.replace("PNG written to ", "").trim();
  const bytes = readFileSync(filePath);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    console.error("mcp png is not a png");
    process.exit(1);
  }
  console.log(`render smoke ${platform}: mcp png ok`);
} finally {
  await client.close();
}
