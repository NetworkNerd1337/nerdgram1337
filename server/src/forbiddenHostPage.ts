import type { Request } from "express";
import { parseHostHeader } from "./security.js";

const DOCS_INSTALL =
  "https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs/install.md#publish-on-a-lan";
const DOCS_TROUBLESHOOTING =
  "https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs/troubleshooting.md#the-browser-says-nerdgram-blocked-this-address";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * Browser page navigations ask for HTML. `/api` and MCP stay JSON even when
 * a client sends `Accept: text/html`.
 */
export function wantsForbiddenHostPage(req: Pick<Request, "method" | "path" | "headers">): boolean {
  if (req.method.toUpperCase() !== "GET") return false;
  const path = req.path || "/";
  if (path === "/api" || path.startsWith("/api/") || path === "/mcp" || path.startsWith("/mcp/")) {
    return false;
  }
  const accept = req.headers.accept;
  const raw = Array.isArray(accept) ? accept.join(",") : accept ?? "";
  return raw
    .toLowerCase()
    .split(",")
    .some((part) => part.split(";")[0]?.trim() === "text/html");
}

export type ForbiddenHostCopy = {
  /** Host header as the browser sent it, already safe to show. */
  display: string;
  name: string | null;
  port: number;
  origin: string | null;
};

export function forbiddenHostCopy(hostHeader: string, fallbackPort: number): ForbiddenHostCopy {
  const display = hostHeader.trim() || "(empty Host header)";
  const parsed = parseHostHeader(hostHeader);
  const parsedPort = parsed?.port != null && /^\d+$/.test(parsed.port) ? Number(parsed.port) : null;
  const port = parsedPort ?? fallbackPort;
  if (!parsed) return { display, name: null, port, origin: null };
  const name = parsed.hostname;
  const host = name.includes(":") ? `[${name}]` : name;
  return { display, name, port, origin: `http://${host}:${port}` };
}

function code(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

function dockerFix(copy: ForbiddenHostCopy): string {
  if (!copy.name || !copy.origin) {
    return `<p>The container cannot see the host's network addresses. Set <code>NERDGRAM_ALLOWED_HOSTS</code> to the address in the browser, and <code>NERDGRAM_CORS_ORIGINS</code> to <code>http://</code> that address and port, in <code>compose.yaml</code> or <code>.env</code>. Then run <code>docker compose up -d</code>.</p>`;
  }
  const lines = [
    `NERDGRAM_ALLOWED_HOSTS: "${copy.name}"`,
    `NERDGRAM_CORS_ORIGINS: "${copy.origin}"`,
  ].join("\n");
  return `<p>The container cannot see the host's network addresses, so this address has to be listed. In <code>compose.yaml</code> or <code>.env</code>, set:</p>
<pre>${escapeHtml(lines)}</pre>
<p>Then run <code>docker compose up -d</code>.</p>
<p><code>NERDGRAM_CORS_ORIGINS</code> is required for saves from ${code(copy.origin)}. A name added only in <code>NERDGRAM_ALLOWED_HOSTS</code> is not also an allowed origin, even when the browser origin is that same address.</p>`;
}

function nodeFix(copy: ForbiddenHostCopy): string {
  const settings = `http://127.0.0.1:${copy.port}/settings#host`;
  if (!copy.name || !copy.origin) {
    return `<p>Open NerdGram on this machine at ${code(settings)}, save the address as Host, and restart. For a DNS name, set <code>NERDGRAM_ALLOWED_HOSTS</code> to that name.</p>`;
  }
  const looksLikeIp = copy.name.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(copy.name);
  if (looksLikeIp) {
    return `<p>On this machine, open ${code(settings)}, save ${code(copy.name)} as Host, and restart. That also allows ${code(copy.origin)} for saves, so <code>NERDGRAM_CORS_ORIGINS</code> is not required when the browser origin is that address. For a DNS name, set <code>NERDGRAM_ALLOWED_HOSTS</code> to the name and <code>NERDGRAM_CORS_ORIGINS</code> to <code>http://&lt;name&gt;:${copy.port}</code>.</p>`;
  }
  const lines = [
    `NERDGRAM_ALLOWED_HOSTS=${copy.name}`,
    `NERDGRAM_CORS_ORIGINS=${copy.origin}`,
  ].join("\n");
  return `<p>This is a DNS name. Set it in the environment, then restart:</p>
<pre>${escapeHtml(lines)}</pre>
<p>Saving an IP as Host in Settings (${code(settings)}) also allows that IP as an origin. A DNS name does not, so <code>NERDGRAM_CORS_ORIGINS</code> is required for saves from ${code(copy.origin)}.</p>`;
}

export function renderForbiddenHostPage(input: {
  hostHeader: string;
  port: number;
  docker: boolean;
}): string {
  const copy = forbiddenHostCopy(input.hostHeader, input.port);
  const fix = input.docker ? dockerFix(copy) : nodeFix(copy);
  const install = input.docker ? "Docker" : "Node";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>NerdGram blocked this address</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f3f6f4;
    --card: #ffffff;
    --ink: #1c2420;
    --soft: #5a675f;
    --line: #d5ddd7;
    --accent: #2f6f8f;
    --code: #e8eeea;
    --warn: #f8f1dc;
    --warn-ink: #6b5316;
    --warn-line: #e4d3a4;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f141a;
      --card: #151b23;
      --ink: #e8eef5;
      --soft: #91a0b4;
      --line: #314257;
      --accent: #8eb6ff;
      --code: #1a2330;
      --warn: #3a2c22;
      --warn-ink: #f8e6d8;
      --warn-line: #e8a87c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    color: var(--ink);
    background:
      radial-gradient(900px 420px at 8% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 55%),
      var(--bg);
    font: 17px/1.5 Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif;
  }
  main {
    max-width: 42rem;
    margin: 0 auto;
    padding: 3.5rem 1.25rem 4rem;
  }
  .brand {
    margin: 0 0 1.25rem;
    letter-spacing: 0.04em;
    font-size: 0.95rem;
    color: var(--accent);
  }
  h1 {
    margin: 0 0 0.75rem;
    font-size: 2rem;
    font-weight: 560;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  p { margin: 0 0 1rem; }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 1.25rem 1.35rem 0.35rem;
    box-shadow: 0 10px 30px rgba(28, 36, 32, 0.08);
  }
  code, pre {
    font-family: ui-monospace, "Cascadia Code", "Segoe UI Mono", Menlo, Consolas, monospace;
    font-size: 0.86rem;
  }
  code {
    background: var(--code);
    padding: 0.08em 0.35em;
    border-radius: 6px;
  }
  pre {
    margin: 0 0 1rem;
    padding: 0.85rem 1rem;
    overflow: auto;
    background: var(--code);
    border-radius: 10px;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .note {
    background: var(--warn);
    color: var(--warn-ink);
    border: 1px solid var(--warn-line);
    border-radius: 12px;
    padding: 0.85rem 1rem;
  }
  a { color: var(--accent); }
  .links { color: var(--soft); font-size: 0.95rem; }
</style>
</head>
<body>
<main>
  <p class="brand">NerdGram1337</p>
  <h1>NerdGram blocked this address</h1>
  <div class="card">
    <p>The browser used ${code(copy.display)}.</p>
    <p>This ${install} install refused that <code>Host</code> header.</p>
    ${fix}
  </div>
  <p class="note">Opening NerdGram on a network lets anyone who can reach the port use it. There is no login.</p>
  <p class="links"><a href="${DOCS_INSTALL}">Docker LAN settings</a> · <a href="${DOCS_TROUBLESHOOTING}">Troubleshooting</a></p>
</main>
</body>
</html>
`;
}
