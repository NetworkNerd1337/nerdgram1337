import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { injectAppearanceBoot } from "./src/lib/appearanceBoot.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** The mermaid package this client install will bundle. Empty when it cannot be read. */
function bundledMermaidVersion(): string {
  try {
    const pkg = require("mermaid/package.json") as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version.trim() : "";
  } catch {
    return "";
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "appearance-boot",
      transformIndexHtml(html) {
        return injectAppearanceBoot(html);
      },
    },
  ],
  server: {
    fs: {
      // The shared front matter parser lives in server/src and is imported by the client.
      allow: [repoRoot],
    },
    // Loopback only. Vite's default is already localhost; set it so a future
    // default cannot listen on every interface.
    host: "localhost",
    port: 5173,
    proxy: {
      "/api": {
        // The API binds 127.0.0.1 by default. Do not use `localhost` here:
        // on some systems that name resolves to ::1 first.
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  define: {
    __NERDGRAM_MERMAID_VERSION__: JSON.stringify(bundledMermaidVersion()),
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    fileParallelism: false,
  },
});
