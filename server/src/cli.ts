#!/usr/bin/env node
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderFormat } from "./renderDiagram.js";

/**
 * `nerdgram` talks to a local NerdGram server, except `render` and `lint`
 * of a file that is already on disk, `convert` of a saved export, and
 * `export <target>` of a network document. Those run in this process.
 *
 * NERDGRAM_URL defaults to http://127.0.0.1:8787. NERDGRAM_TOKEN is the
 * automation token from Settings. Flags win over the environment.
 */

type Io = {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  env: NodeJS.ProcessEnv;
  /** When set, `convert` reads this instead of stdin. */
  stdin?: string;
};

type Parsed = {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
};

const BOOL_FLAGS = new Set([
  "json",
  "server",
  "strict",
  "help",
  "h",
  "no-update-links",
  "dry-run",
  "yes",
  "replace",
  "match-case",
  "whole-word",
  "regex",
  "front-matter",
  "no-recursive",
  "apply",
  "copy-data",
  "share-data",
  "with-data",
  "keep-data",
  "include-down",
  "create-only",
  "version",
]);

const HELP = `nerdgram — automation client for NerdGram1337

Usage
  nerdgram render <file|path> -o out.svg|png
  nerdgram list [folder]
  nerdgram search <query>
  nerdgram get <path> [-o file]
  nerdgram put <path> <file>
  nerdgram export <target> <diagram|network.json> [-o file]
  nerdgram export <folder> -o dir/
  nerdgram lint [path|file] [--strict]
  nerdgram rename <from> <to>
  nerdgram move <from> [folder]
  nerdgram duplicate <path> (--copy-data | --share-data)
  nerdgram delete <path> (--with-data | --keep-data)
  nerdgram repair-links [--dry-run] [--apply]
  nerdgram generate --path Diagram.mmd --data data.csv
  nerdgram generate --path Diagram.mmd --data neighbors.lldp --format lldp --local-device edge-sw
  nerdgram generate --path Campus-L3.mmd --data campus.network.json --format network --view l3
  nerdgram generate --path Campus-L2.mmd --data campus.network.json --format network --view l2 --group-by site
  nerdgram convert <source> [file] [-o out.network.json]
  nerdgram refresh <path> [--data data.csv]
  nerdgram diff <path> --from <id|name|current> [--to <id|name|current>] [--format md|json|svg]
  nerdgram baseline <path> --name "…" [--note "…"] [--id <revision>]
  nerdgram replace <find> <replace> [--folder path] [--regex] [--whole-word] [--match-case] [--front-matter] [--no-recursive] [--dry-run] [--yes]
  nerdgram replace --undo <id>
  nerdgram mcp

A local .mmd file is rendered and linted in this process. convert reads a
saved export and writes canonical network JSON in this process. export of a
registered target reads network JSON in this process. export of a folder
talks to the server. Anything else uses
NERDGRAM_URL (default http://127.0.0.1:8787) and NERDGRAM_TOKEN.
--url and --token override those. --server forces render to use a workspace
path on the API, not a file on this computer. Exit status is 1 on errors.

Flags
  --help          Print this help and exit.
  --version       Print the nerdgram version and exit.
  --url <url>     Server URL. Overrides NERDGRAM_URL.
  --token <token> Automation token. Overrides NERDGRAM_TOKEN.
  --json          Print one JSON object and nothing else. Success is
                  {"ok":true, ...} with that command's fields (path, hits,
                  diagnostics, folders, files, and the rest of the payload).
                  Failure is {"ok":false,"error","status"} on stdout.
  --include-down  Network data. Draw shutdown and down interfaces. Off by default.
  --create-only   Create the diagram and return 409 when the path exists.
                  Without this flag, generate creates the diagram or updates
                  the generated block and the data file beside it.
  --vlan <1-4094> Layer 2 network view. Keep links that carry this VLAN id.
  --group-by <value>
                  cdp and lldp: platform or capability.
                  network with --view l3: vrf.
                  network with --view l2: site, role, or platform.
  --hosts <value> Routing tables. ports places each host. port-counts and
                  vlan-counts draw a count per port or per VLAN.
  --view <l3|l2>  generate --format network only. l3 is subnets. l2 is VLANs,
                  trunks, and LAGs. refresh rejects --view. The view is stored
                  in the diagram.
Rename and move also move a CSV, JSON, network JSON, CDP, LLDP, or routing-table file that
sits next to the diagram and update nerdgram.source. duplicate --copy-data
gives the copy its own data file. duplicate --share-data keeps both diagrams
on the original file.
delete --with-data moves that file to the trash with the diagram.
delete --keep-data leaves it in the workspace. When a data file is present and
the flag is omitted, duplicate and delete stop and list the file.
repair-links previews click repairs after a rename or move made outside the
app. --dry-run is the default and writes nothing. --apply saves the previewed
rewrites. If the data file moved with that diagram, the same confirmation
updates nerdgram.source. An ambiguous match is listed and left unchanged.
diff compares two revisions, or a revision and the current diagram. --to
defaults to current. --from accepts a revision id, a baseline name, or
current. --format md prints a Markdown summary, json prints the diff, and
svg writes the read-only visual diff. svg needs -o file.svg. The diagram
file is not modified.
baseline saves the current diagram as a named baseline. --id names an
existing revision instead. Names are kept when the 20-revision limit drops
older saves.
template save <diagram> copies that diagram into <data>/.templates as a
User created template. It does not change the diagram. --name sets the
template name. --replace overwrites a user template with the same id.
template rm <id> deletes a user template. Built-in templates are refused.
These two write the data directory on this computer. They do not call the API.
replace prints a preview. --yes applies it and saves each diagram, so the
previous text is a revision. --dry-run is the default. --folder limits the
scope. --no-recursive stays in that folder. The diagram body is searched
unless --front-matter is set. Hidden files, .meta, trash, and templates are
not changed. --undo restores that replace and skips a file edited since.
mcp speaks MCP on stdin and stdout and proxies tool calls to /api/v1.
NERDGRAM_URL defaults to http://127.0.0.1:8787. NERDGRAM_TOKEN is required.
--url and --token override those. Do not pass --json. stdout is the protocol.
`;

type RenderModule = typeof import("./renderDiagram.js");

let renderModule: Promise<RenderModule> | null = null;

function loadRender(): Promise<RenderModule> {
  renderModule ??= import("./renderDiagram.js");
  return renderModule;
}

async function loadLint(): Promise<typeof import("./mermaidSyntax.js")> {
  return import("./mermaidSyntax.js");
}

async function mcpCommand(parsed: Parsed, io: Io): Promise<void> {
  const { base, token } = configOf(parsed.flags, io.env);
  const { runMcpStdio } = await import("./mcp/stdio.js");
  await runMcpStdio({ base, token: requireToken(token) });
}

export async function templateCommand(parsed: Parsed, io: Io): Promise<void> {
  const sub = parsed.positionals[0] ?? "";
  const target = parsed.positionals[1] ?? "";
  const templates = await import("./templates.js");
  try {
    if (sub === "save") {
      if (!target) throw new CliError("Usage: nerdgram template save <diagram> [--name name] [--replace]");
      const created = await templates.createUserTemplate({
        path: target,
        name: flagString(parsed.flags, "name"),
        replace: parsed.flags.get("replace") === true,
      });
      writeOut(
        io,
        isJson(parsed.flags),
        { id: created.id, origin: created.origin, title: created.title, category: created.category },
        `Saved template ${created.id}`,
      );
      return;
    }
    if (sub === "rm" || sub === "delete") {
      if (!target) throw new CliError("Usage: nerdgram template rm <id>");
      await templates.deleteUserTemplate(target);
      writeOut(io, isJson(parsed.flags), { id: target }, `Deleted template ${target}`);
      return;
    }
    throw new CliError("Usage: nerdgram template save <diagram> | nerdgram template rm <id>");
  } catch (err) {
    if (err instanceof CliError) throw err;
    const status = err && typeof err === "object" && "status" in err && typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(message, status);
  }
}

async function shutdownCli(): Promise<void> {
  if (!renderModule) return;
  const { closeRenderer } = await renderModule;
  await closeRenderer();
}

class CliError extends Error {
  readonly status: number | undefined;
  readonly details: Record<string, unknown> | undefined;
  constructor(message: string, status?: number, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** HTTP status when the failure has one, otherwise a stable non-null marker. */
function failureStatus(err: unknown): number | "error" {
  if (err instanceof CliError && typeof err.status === "number") return err.status;
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return "error";
}

type RowIssue = { row?: unknown; message?: unknown; path?: unknown };

/** Lines for the row and field errors a generate or refresh response includes. */
export function formatRowIssues(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  const lines: string[] = [];
  for (const item of errors) {
    if (!item || typeof item !== "object") continue;
    const issue = item as RowIssue;
    if (typeof issue.message !== "string" || !issue.message.trim()) continue;
    const message = issue.message.trim();
    const field = typeof issue.path === "string" ? issue.path.trim() : "";
    if (field && !message.includes(field)) {
      lines.push(`${field}: ${message}`);
      continue;
    }
    const row = typeof issue.row === "number" ? issue.row : 0;
    if (row > 0 && !message.toLowerCase().includes(`row ${row}`)) {
      lines.push(`row ${row}: ${message}`);
      continue;
    }
    lines.push(message);
  }
  return lines;
}

function parseArgs(argv: string[]): Parsed {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const rawName = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const name = rawName === "o" ? "output" : rawName;
      if (BOOL_FLAGS.has(rawName) && eq === -1) {
        flags.set(name, true);
        continue;
      }
      const value = eq === -1 ? argv[index + 1] : arg.slice(eq + 1);
      if (eq === -1) index += 1;
      if (value == null || value.startsWith("-")) throw new CliError(`Missing value for --${rawName}`);
      flags.set(name, BOOL_FLAGS.has(rawName) ? value !== "false" : value);
      continue;
    }
    if (arg === "-h") {
      flags.set("help", true);
      continue;
    }
    if (arg === "-o") {
      const value = argv[index + 1];
      index += 1;
      if (value == null || value.startsWith("-")) throw new CliError("Missing value for -o");
      flags.set("output", value);
      continue;
    }
    if (!command) command = arg;
    else positionals.push(arg);
  }
  return { command, positionals, flags };
}

function flagString(flags: Parsed["flags"], name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function isJson(flags: Parsed["flags"]): boolean {
  return flags.get("json") === true;
}

function writeOut(io: Io, json: boolean, payload: Record<string, unknown>, human: string): void {
  if (json) io.stdout(`${JSON.stringify({ ok: true, ...payload })}\n`);
  else io.stdout(human.endsWith("\n") ? human : `${human}\n`);
}

function configOf(flags: Parsed["flags"], env: NodeJS.ProcessEnv): { base: string; token: string } {
  const base = (flagString(flags, "url") ?? env.NERDGRAM_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  const token = flagString(flags, "token") ?? env.NERDGRAM_TOKEN ?? "";
  return { base, token };
}

function requireToken(token: string): string {
  if (!token.trim()) throw new CliError("Set NERDGRAM_TOKEN or pass --token.");
  return token.trim();
}

async function callApi(
  base: string,
  token: string,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; bytes: Buffer; contentType: string }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || method !== "GET") headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${base}${apiPath}`, {
      method,
      headers,
      body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Could not reach ${base}. ${message}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  let json: unknown = undefined;
  if (contentType.includes("json") || (!contentType.includes("image/") && bytes.length > 0 && bytes[0] === 0x7b)) {
    try {
      json = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      json = undefined;
    }
  }
  if (!response.ok) {
    const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const summary = typeof record.error === "string" ? record.error : `Request failed (${response.status})`;
    const rows = formatRowIssues(record.errors);
    const message = rows.length > 0 ? `${summary}\n${rows.join("\n")}` : summary;
    throw new CliError(message, response.status, record);
  }
  return { status: response.status, json, bytes, contentType };
}

function formatOf(output: string): RenderFormat {
  const lower = output.toLowerCase();
  if (lower.endsWith(".svg")) return "svg";
  if (lower.endsWith(".png")) return "png";
  throw new CliError("The output file must end in .svg or .png.");
}

async function pathExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function renderCommand(parsed: Parsed, io: Io): Promise<void> {
  const target = parsed.positionals[0];
  const output = flagString(parsed.flags, "output");
  if (!target) throw new CliError("render needs a file or a workspace path.");
  if (!output) throw new CliError("render needs -o out.svg or -o out.png.");
  const format = formatOf(output);
  const server = parsed.flags.get("server") === true;
  if (server && (await pathExists(target))) {
    throw new CliError(
      `${target} is a file on this computer. Drop --server to render it here. --server renders a workspace path such as Sites/Campus.mmd on the NerdGram server.`,
    );
  }
  const local = !server && (await pathExists(target));
  let bytes: Buffer;
  if (local) {
    const source = await fs.readFile(target, "utf8");
    const { renderDiagram } = await loadRender();
    const rendered = await renderDiagram({ source, format });
    bytes = rendered.body;
  } else {
    const { base, token } = configOf(parsed.flags, io.env);
    let result: Awaited<ReturnType<typeof callApi>>;
    try {
      result = await callApi(base, requireToken(token), "POST", "/api/v1/render", { path: target, format });
    } catch (err) {
      if (err instanceof CliError && err.status === 404) {
        throw new CliError(
          `No diagram named ${target} is in the workspace. --server uses a workspace path such as Sites/Campus.mmd. To render a file on this computer, drop --server.`,
          404,
        );
      }
      throw err;
    }
    bytes = result.bytes;
  }
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await fs.writeFile(output, bytes);
  writeOut(io, isJson(parsed.flags), { output, format, bytes: bytes.length, offline: local }, `Wrote ${output}`);
}

async function listCommand(parsed: Parsed, io: Io): Promise<void> {
  const { base, token } = configOf(parsed.flags, io.env);
  const folder = parsed.positionals[0] ?? "";
  const result = await callApi(base, requireToken(token), "GET", `/api/v1/diagrams?path=${encodeURIComponent(folder)}`);
  const body = result.json as { path?: string; folders?: { path: string }[]; files?: { path: string }[] };
  const lines = [
    ...(body.folders ?? []).map((item) => `${item.path}/`),
    ...(body.files ?? []).map((item) => item.path),
  ];
  writeOut(io, isJson(parsed.flags), { path: body.path ?? folder, folders: body.folders ?? [], files: body.files ?? [] }, lines.join("\n") || "(empty)");
}

async function searchCommand(parsed: Parsed, io: Io): Promise<void> {
  const query = parsed.positionals.join(" ").trim();
  if (!query) throw new CliError("search needs a query.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "GET", `/api/v1/search?q=${encodeURIComponent(query)}`);
  const body = result.json as { hits?: { path: string; line: number | null; snippet: string }[] };
  const lines = (body.hits ?? []).map((hit) => `${hit.path}:${hit.line ?? 1}: ${hit.snippet}`);
  writeOut(io, isJson(parsed.flags), { query, hits: body.hits ?? [] }, lines.join("\n") || "(no matches)");
}

async function getCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  if (!itemPath) throw new CliError("get needs a workspace path.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "GET", `/api/v1/diagrams/content?path=${encodeURIComponent(itemPath)}`);
  const body = result.json as { path: string; content: string; hash: string; mtimeMs: number };
  const output = flagString(parsed.flags, "output");
  if (output) {
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, body.content, "utf8");
  }
  writeOut(
    io,
    isJson(parsed.flags),
    { path: body.path, hash: body.hash, mtimeMs: body.mtimeMs, content: body.content, output: output ?? null },
    output ? `Wrote ${output}` : body.content,
  );
}

async function putCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  const file = parsed.positionals[1];
  if (!itemPath || !file) throw new CliError("put needs a workspace path and a local file.");
  const content = await fs.readFile(file, "utf8");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "PUT", "/api/v1/diagrams", { path: itemPath, content, force: true });
  const body = result.json as { path: string; hash?: string };
  writeOut(io, isJson(parsed.flags), { path: body.path, hash: body.hash ?? null }, `Wrote ${body.path}`);
}

async function exportCommand(parsed: Parsed, io: Io): Promise<void> {
  const exporters = await import("./exporters/index.js");
  const first = parsed.positionals[0] ?? "";
  const installed = await exporters.installedExporters();
  const ids = installed.map((item) => item.id).join(", ") || "(none)";
  const usage = [
    "Usage:",
    "  nerdgram export <target> <diagram|network.json> [-o file]",
    "  nerdgram export <folder> -o dir/",
    `Installed exporters: ${ids}`,
  ].join("\n");
  if (parsed.positionals.length === 0) throw new CliError(usage);
  const known = installed.find((item) => item.id === first.trim().toLowerCase());
  if (known) {
    await designExportCommand(parsed, io, known.id);
    return;
  }
  if (parsed.positionals.length > 1) throw new CliError(`Unknown exporter "${first}".\n${usage}`);
  const folder = first;
  const output = flagString(parsed.flags, "output");
  if (!output) throw new CliError("export needs -o directory.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "GET", `/api/v1/export?path=${encodeURIComponent(folder)}`);
  const body = result.json as { files?: { path: string; content: string }[] };
  const root = path.resolve(output);
  await fs.mkdir(root, { recursive: true });
  let count = 0;
  for (const file of body.files ?? []) {
    const destination = path.resolve(root, file.path);
    const relative = path.relative(root, destination);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new CliError(`Refusing to write ${file.path}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content, "utf8");
    count += 1;
  }
  writeOut(io, isJson(parsed.flags), { path: folder, output, count }, `Exported ${count} diagram${count === 1 ? "" : "s"} to ${output}`);
}

async function designExportCommand(parsed: Parsed, io: Io, target: string): Promise<void> {
  const { readMappingFile, siblingNetworkPath, readNetworkFile, parseNetworkDocument, labelFromPath } = await import("./exporters/resolve.js");
  const { runExport } = await import("./exporters/run.js");
  const file = parsed.positionals[1];
  let document;
  let label = "nerdgram";
  let mapBeside: string | null = null;
  if (file && file !== "-") {
    const resolved = path.resolve(file);
    mapBeside = path.join(path.dirname(resolved), "nerdgram-export-map.yml");
    if (file.toLowerCase().endsWith(".mmd")) {
      const content = await fs.readFile(resolved, "utf8");
      const sibling = siblingNetworkPath(resolved, content);
      const candidates = path.isAbsolute(sibling.path)
        ? [sibling.path]
        : [path.resolve(path.dirname(resolved), sibling.path), path.resolve(sibling.path)];
      let text: string | null = null;
      for (const candidate of candidates) {
        try {
          text = await fs.readFile(candidate, "utf8");
          break;
        } catch {
          text = null;
        }
      }
      if (text == null) {
        throw new CliError(
          sibling.kind === "recorded"
            ? `The diagram records network JSON at ${sibling.path}, and that file is not there.`
            : "This diagram has no network JSON.",
        );
      }
      document = parseNetworkDocument(text);
      label = labelFromPath(resolved);
    } else if (file.toLowerCase().endsWith(".network.json")) {
      const loaded = await readNetworkFile(resolved);
      document = loaded.document;
      label = loaded.label;
    } else {
      throw new CliError("The design export needs a .mmd diagram or a .network.json file.");
    }
  } else if (io.stdin != null) {
    document = parseNetworkDocument(io.stdin);
    label = "nerdgram";
  } else if (process.stdin.isTTY) {
    throw new CliError("export needs a file or stdin.");
  } else {
    document = parseNetworkDocument(await readStdin());
  }
  const mapFlag = flagString(parsed.flags, "map");
  let mappingDocument: unknown = null;
  if (mapFlag) mappingDocument = await readMappingFile(mapFlag);
  else {
    for (const candidate of [mapBeside, path.resolve("nerdgram-export-map.yml")]) {
      if (!candidate) continue;
      try {
        mappingDocument = await readMappingFile(candidate);
        break;
      } catch {
        mappingDocument = null;
      }
    }
  }
  const exported = await runExport(target, document, { label, mapping: null }, mappingDocument);
  const output = flagString(parsed.flags, "output");
  const warningLines = exported.warnings.map((item) => (item.path ? `${item.path}: ${item.message}` : item.message));
  if (!isJson(parsed.flags) && warningLines.length > 0) io.stderr(`${warningLines.join("\n")}\n`);
  if (exported.files.length > 1) {
    if (!output) throw new CliError("This export writes multiple files. Pass -o directory.");
    if (output.toLowerCase().endsWith(".zip")) {
      const bytes = Buffer.from(exported.archive?.base64 ?? "", "base64");
      await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
      await fs.writeFile(output, bytes);
      writeOut(io, isJson(parsed.flags), { target, output, warnings: exported.warnings, bytes: bytes.length }, `Wrote ${output}`);
      return;
    }
    const root = path.resolve(output);
    await fs.mkdir(root, { recursive: true });
    for (const item of exported.files) {
      const destination = path.resolve(root, item.name);
      const relative = path.relative(root, destination);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new CliError(`Refusing to write ${item.name}`);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, item.text, "utf8");
    }
    writeOut(
      io,
      isJson(parsed.flags),
      { target, output, warnings: exported.warnings, bytes: exported.bytes, files: exported.files.map((item) => ({ name: item.name, bytes: Buffer.byteLength(item.text) })) },
      `Wrote ${exported.files.length} files to ${output}`,
    );
    return;
  }
  const text = exported.text.endsWith("\n") ? exported.text : `${exported.text}\n`;
  if (output) {
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, text, "utf8");
  }
  if (isJson(parsed.flags)) {
    const payload = output
      ? { target, output, warnings: exported.warnings, bytes: Buffer.byteLength(text) }
      : { target, text, warnings: exported.warnings, bytes: Buffer.byteLength(text) };
    writeOut(io, true, payload, "");
    return;
  }
  if (output) {
    io.stdout(`Wrote ${output}\n`);
    return;
  }
  io.stdout(text);
}

async function lintCommand(parsed: Parsed, io: Io): Promise<number> {
  const target = parsed.positionals[0] ?? flagString(parsed.flags, "source");
  const strict = parsed.flags.get("strict") === true;
  let diagnostics: { severity: string; line: number; message: string; ruleId: string }[];
  let label = target ?? "(workspace)";
  if (target && (flagString(parsed.flags, "source") || (await pathExists(target)))) {
    const source = await fs.readFile(target, "utf8");
    const { lintDiagramSource } = await loadLint();
    diagnostics = await lintDiagramSource(source, { sourcePath: target });
    label = target;
  } else {
    const { base, token } = configOf(parsed.flags, io.env);
    const apiPath = target ? `/api/v1/lint?path=${encodeURIComponent(target)}` : "/api/v1/lint";
    const result = await callApi(base, requireToken(token), "GET", apiPath);
    const body = result.json as {
      diagnostics?: { severity: string; line: number; message: string; ruleId: string }[];
      diagrams?: { path: string; diagnostics: { severity: string; line: number; message: string; ruleId: string }[] }[];
      unreadable?: { path: string; code: string; message: string }[];
      checked?: number;
    };
    if (body.diagrams) {
      const unreadable = body.unreadable ?? [];
      diagnostics = body.diagrams.flatMap((diagram) =>
        diagram.diagnostics.map((item) => ({ ...item, message: `${diagram.path}: ${item.message}` })),
      );
      const lines = [
        ...unreadable.map((item) => item.message),
        ...diagnostics.map((item) => `${item.ruleId}: ${item.message}`),
      ];
      writeOut(
        io,
        isJson(parsed.flags),
        { checked: body.checked ?? 0, diagrams: body.diagrams, unreadable },
        lines.join("\n") || `Checked ${body.checked ?? 0} diagrams.`,
      );
      const failed =
        unreadable.length > 0 ||
        body.diagrams.some((diagram) =>
          diagram.diagnostics.some((item) => item.severity === "error" || (strict && diagram.diagnostics.length > 0)),
        );
      return failed ? 1 : 0;
    }
    diagnostics = body.diagnostics ?? [];
  }
  const lines = diagnostics.map((item) => `${label}:${item.line}: ${item.severity}: ${item.ruleId}: ${item.message}`);
  writeOut(io, isJson(parsed.flags), { path: label, diagnostics }, lines.join("\n") || "No problems.");
  const failed = diagnostics.some((item) => item.severity === "error" || (strict && diagnostics.length > 0));
  return failed ? 1 : 0;
}

async function repairLinksCommand(parsed: Parsed, io: Io): Promise<void> {
  const apply = parsed.flags.get("apply") === true && parsed.flags.get("dry-run") !== true;
  const { base, token } = configOf(parsed.flags, io.env);
  const result = apply
    ? await callApi(base, requireToken(token), "POST", "/api/v1/link-repairs", { dryRun: false, confirm: true })
    : await callApi(base, requireToken(token), "GET", "/api/v1/link-repairs");
  const body = result.json as {
    suggestions?: { from: string; to: string | null; match: string; candidates: string[] }[];
    changes?: { path: string; links: { line: number; target: string; next: string }[] }[];
    dataFiles?: { diagram: string; from: string; to: string }[];
    applied?: boolean;
    saved?: string[];
  };
  const lines: string[] = [];
  for (const change of body.changes ?? []) {
    lines.push(change.path);
    for (const link of change.links) lines.push(`  line ${link.line}: ${link.target} -> ${link.next}`);
  }
  const ambiguous = (body.suggestions ?? []).filter((item) => item.to == null || item.match === "ambiguous");
  for (const dataFile of body.dataFiles ?? []) {
    lines.push(`${dataFile.diagram}: ${dataFile.from} -> ${dataFile.to}`);
  }
  if (ambiguous.length > 0) {
    lines.push("Ambiguous, not changed:");
    for (const item of ambiguous) lines.push(`  ${item.from} matches ${item.candidates.join(", ")}`);
  }
  if (lines.length === 0) lines.push("No link repairs.");
  else if (!apply) lines.push("Nothing was written. Run nerdgram repair-links --apply to update these files.");
  else if ((body.saved ?? []).length > 0) lines.push(`Updated ${(body.saved ?? []).join(", ")}`);
  else lines.push("No files needed a rewrite.");
  writeOut(
    io,
    isJson(parsed.flags),
    {
      applied: body.applied === true,
      saved: body.saved ?? [],
      suggestions: body.suggestions ?? [],
      changes: body.changes ?? [],
      dataFiles: body.dataFiles ?? [],
    },
    lines.join("\n"),
  );
}

async function renameCommand(parsed: Parsed, io: Io): Promise<void> {
  const from = parsed.positionals[0];
  const to = parsed.positionals[1];
  if (!from || !to) throw new CliError("rename needs the current path and the new path.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/diagrams/rename", {
    from,
    to,
    updateLinks: parsed.flags.get("no-update-links") !== true,
  });
  const body = result.json as { path?: string; dataFiles?: { to: string }[] };
  const moved = (body.dataFiles ?? []).map((item) => item.to).join(", ");
  writeOut(io, isJson(parsed.flags), body, moved ? `Renamed ${body.path}. Data file ${moved}.` : `Renamed ${body.path}`);
}

async function moveCommand(parsed: Parsed, io: Io): Promise<void> {
  const from = parsed.positionals[0];
  if (!from) throw new CliError("move needs the diagram or folder to move.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/diagrams/move", {
    from,
    toFolder: parsed.positionals[1] ?? "",
    updateLinks: parsed.flags.get("no-update-links") !== true,
  });
  const body = result.json as { path?: string; dataFiles?: { to: string }[] };
  const moved = (body.dataFiles ?? []).map((item) => item.to).join(", ");
  writeOut(io, isJson(parsed.flags), body, moved ? `Moved to ${body.path}. Data file ${moved}.` : `Moved to ${body.path}`);
}

async function duplicateCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  if (!itemPath) throw new CliError("duplicate needs a diagram or folder path.");
  const copyData = parsed.flags.get("copy-data") === true;
  const shareData = parsed.flags.get("share-data") === true;
  if (copyData && shareData) throw new CliError("Pass either --copy-data or --share-data.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/diagrams/duplicate", {
    path: itemPath,
    ...(copyData ? { copyData: true } : {}),
    ...(shareData ? { copyData: false } : {}),
  });
  const body = result.json as { path?: string; dataFiles?: { to: string }[] };
  const copied = (body.dataFiles ?? []).map((item) => item.to).join(", ");
  const human = copied
    ? `Duplicated as ${body.path}. Data file ${copied}.`
    : shareData
      ? `Duplicated as ${body.path}. It shares the original data file.`
      : `Duplicated as ${body.path}`;
  writeOut(io, isJson(parsed.flags), body, human);
}

async function deleteCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  if (!itemPath) throw new CliError("delete needs a diagram or folder path.");
  const withData = parsed.flags.get("with-data") === true;
  const keepData = parsed.flags.get("keep-data") === true;
  if (withData && keepData) throw new CliError("Pass either --with-data or --keep-data.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "DELETE", "/api/v1/diagrams", {
    path: itemPath,
    confirmLinks: true,
    ...(withData ? { deleteData: true } : {}),
    ...(keepData ? { deleteData: false } : {}),
  });
  const body = result.json as { path?: string; trashed?: boolean; message?: string };
  const kept = body.message ? ` ${body.message}` : "";
  writeOut(io, isJson(parsed.flags), body, `Moved ${body.path ?? itemPath} to the trash.${kept}`);
}

async function generateCommand(parsed: Parsed, io: Io): Promise<void> {
  const diagramPath = flagString(parsed.flags, "path") ?? parsed.positionals[0];
  const dataFile = flagString(parsed.flags, "data");
  if (!diagramPath || !dataFile) {
    throw new CliError(
      "generate needs --path Diagram.mmd and --data file.csv, file.json, file.network.json, file.cdp, file.lldp, or file.route.",
    );
  }
  const format = flagString(parsed.flags, "format");
  const view = flagString(parsed.flags, "view");
  if (format === "network" && view !== "l3" && view !== "l2") {
    throw new CliError("generate --format network needs --view l3 or --view l2.");
  }
  const vlanText = flagString(parsed.flags, "vlan");
  if (vlanText != null && !/^\d+$/.test(vlanText)) throw new CliError("vlan must be an integer from 1 to 4094.");
  const text = await fs.readFile(dataFile, "utf8");
  const createOnly = parsed.flags.get("create-only") === true;
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", createOnly ? "/api/v1/generate" : "/api/v1/generate/upsert", {
    path: diagramPath,
    text,
    format,
    shape: flagString(parsed.flags, "shape"),
    direction: flagString(parsed.flags, "direction"),
    title: flagString(parsed.flags, "title"),
    localDevice: flagString(parsed.flags, "local-device"),
    groupBy: flagString(parsed.flags, "group-by"),
    hosts: flagString(parsed.flags, "hosts"),
    view,
    ...(parsed.flags.get("include-down") === true ? { includeDown: true } : {}),
    ...(vlanText != null ? { vlan: Number(vlanText) } : {}),
  });
  const body = result.json as { path: string; dataPath?: string; created?: boolean; counts?: unknown };
  const verb = body.created === false ? "Updated" : "Created";
  writeOut(io, isJson(parsed.flags), body, `${verb} ${body.path}${body.dataPath ? ` from ${body.dataPath}` : ""}`);
}

async function diffCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  const from = flagString(parsed.flags, "from");
  if (!itemPath || !from) throw new CliError("diff needs a path and --from <id|name|current>.");
  const to = flagString(parsed.flags, "to") ?? "current";
  const format = (flagString(parsed.flags, "format") ?? (isJson(parsed.flags) ? "json" : "md")).toLowerCase();
  if (format !== "md" && format !== "json" && format !== "svg") {
    throw new CliError("format must be md, json, or svg.");
  }
  const { base, token } = configOf(parsed.flags, io.env);
  const apiPath = `/api/v1/history/diff?path=${encodeURIComponent(itemPath)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const result = await callApi(base, requireToken(token), "GET", apiPath);
  const body = result.json as {
    summary?: string[];
    markdown?: string;
    visualSource?: string | null;
    note?: string | null;
    semantic?: boolean;
  };
  if (format === "svg") {
    const output = flagString(parsed.flags, "output");
    if (!output) throw new CliError("diff --format svg needs -o file.svg.");
    if (!output.toLowerCase().endsWith(".svg")) throw new CliError("The output file must end in .svg.");
    if (!body.visualSource) {
      throw new CliError(body.note ?? "This diagram has no visual diff. Use --format md or json.");
    }
    const { renderDiagram } = await loadRender();
    const rendered = await renderDiagram({ source: body.visualSource, format: "svg" });
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, rendered.body);
    writeOut(
      io,
      isJson(parsed.flags),
      { path: itemPath, from, to, output, format, summary: body.summary ?? [] },
      `Wrote ${output}`,
    );
    return;
  }
  if (format === "json") {
    writeOut(io, true, (body as Record<string, unknown>) ?? {}, "");
    return;
  }
  const markdown = body.markdown ?? (body.summary ?? []).map((line) => `- ${line}`).join("\n");
  const output = flagString(parsed.flags, "output");
  if (output) {
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
    writeOut(io, isJson(parsed.flags), { path: itemPath, from, to, output, format, summary: body.summary ?? [] }, `Wrote ${output}`);
    return;
  }
  writeOut(io, isJson(parsed.flags), { path: itemPath, from, to, format, markdown, summary: body.summary ?? [] }, markdown);
}

async function baselineCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  const name = flagString(parsed.flags, "name");
  if (!itemPath || !name) throw new CliError('baseline needs a path and --name "…".');
  const note = flagString(parsed.flags, "note");
  const id = flagString(parsed.flags, "id");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/history/baseline", {
    path: itemPath,
    name,
    ...(id ? { id } : {}),
    ...(note != null ? { note } : {}),
  });
  const body = result.json as { id?: string; name?: string };
  writeOut(
    io,
    isJson(parsed.flags),
    body && typeof body === "object" ? (body as Record<string, unknown>) : {},
    `Saved baseline ${body.name ?? name}${body.id ? ` (${body.id})` : ""}.`,
  );
}

function cliVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../package.json"), path.resolve(here, "../../package.json")];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && /^\d+\.\d+\.\d+$/.test(parsed.version)) return parsed.version;
    } catch {
      // The next candidate is the repo root, or this is a packed install.
    }
  }
  return "0.0.0";
}

function skipLabel(reason: string): string {
  switch (reason) {
    case "locked":
      return "open in an editor";
    case "changed":
      return "changed since the preview";
    case "edited":
      return "edited since the replace";
    case "undone":
      return "already undone";
    case "hidden":
    case "meta":
    case "not-diagram":
      return "not a workspace diagram";
    default:
      return reason;
  }
}

async function replaceCommand(parsed: Parsed, io: Io): Promise<void> {
  const { base, token } = configOf(parsed.flags, io.env);
  const undo = flagString(parsed.flags, "undo");
  if (undo) {
    const result = await callApi(base, requireToken(token), "POST", "/api/v1/replace/undo", { id: undo });
    const body = result.json as {
      restored?: { path: string }[];
      skipped?: { path: string; reason: string }[];
      errors?: { path: string; message: string }[];
    };
    const restored = body.restored ?? [];
    const skipped = (body.skipped ?? []).filter((item) => item.reason !== "none");
    const lines = [`Restored ${restored.length} diagram${restored.length === 1 ? "" : "s"}.`];
    for (const item of skipped) lines.push(`Skipped ${item.path} (${skipLabel(item.reason)}).`);
    for (const item of body.errors ?? []) lines.push(`${item.path}: ${item.message}`);
    writeOut(io, isJson(parsed.flags), (body as Record<string, unknown>) ?? {}, lines.join("\n"));
    return;
  }
  if (parsed.flags.get("dry-run") === true && parsed.flags.get("yes") === true) {
    throw new CliError("Use either --dry-run or --yes.");
  }
  const find = parsed.positionals[0];
  const replace = parsed.positionals[1];
  if (find == null || replace == null) throw new CliError("replace needs the text to find and the replacement.");
  const folder = flagString(parsed.flags, "folder");
  const request = {
    find,
    replace,
    matchCase: parsed.flags.get("match-case") === true,
    wholeWord: parsed.flags.get("whole-word") === true,
    regex: parsed.flags.get("regex") === true,
    includeFrontMatter: parsed.flags.get("front-matter") === true,
    scope: {
      ...(folder ? { folder } : {}),
      ...(parsed.flags.get("no-recursive") === true ? { recursive: false } : {}),
    },
  };
  const preview = await callApi(base, requireToken(token), "POST", "/api/v1/replace/preview", request);
  const body = preview.json as {
    totals?: { replacements: number; diagrams: number; shown: number };
    message?: string | null;
    files?: {
      path: string;
      hash: string;
      matchCount: number;
      selected: boolean;
      generatedWarning: string | null;
      lint: { invalid: boolean; messages: string[] };
      matches: { line: number; before: string; after: string; warnings: string[] }[];
    }[];
  };
  const files = body.files ?? [];
  const totals = body.totals ?? { replacements: 0, diagrams: 0, shown: 0 };
  if (parsed.flags.get("yes") !== true) {
    const lines = [`${totals.replacements} replacement${totals.replacements === 1 ? "" : "s"} in ${totals.diagrams} diagram${totals.diagrams === 1 ? "" : "s"}.`];
    if (body.message) lines.push(body.message);
    for (const file of files) {
      const notes = [file.selected ? "" : "left unchecked"];
      if (file.lint.invalid) notes.push("would not parse");
      if (file.generatedWarning) notes.push(file.generatedWarning);
      const suffix = notes.filter(Boolean).join("; ");
      lines.push(`${file.path} (${file.matchCount})${suffix ? ` — ${suffix}` : ""}`);
      for (const match of file.matches) {
        const warn = match.warnings.length ? ` [${match.warnings.join(", ")}]` : "";
        lines.push(`  ${match.line}: ${match.before}  →  ${match.after}${warn}`);
      }
    }
    lines.push("Nothing was written. Pass --yes to apply.");
    writeOut(io, isJson(parsed.flags), (preview.json as Record<string, unknown>) ?? {}, lines.join("\n"));
    return;
  }
  const selected = files.filter((file) => file.selected).map((file) => ({ path: file.path, hash: file.hash }));
  const applied = await callApi(base, requireToken(token), "POST", "/api/v1/replace/apply", { ...request, files: selected });
  const result = applied.json as {
    operationId?: string | null;
    totals?: { diagrams: number; replacements: number };
    skipped?: { path: string; reason: string }[];
    errors?: { path: string; message: string }[];
  };
  const changed = result.totals ?? { diagrams: 0, replacements: 0 };
  const lines = [`Replaced ${changed.replacements} in ${changed.diagrams} diagram${changed.diagrams === 1 ? "" : "s"}.`];
  for (const item of (result.skipped ?? []).filter((entry) => entry.reason !== "none")) {
    lines.push(`Skipped ${item.path} (${skipLabel(item.reason)}).`);
  }
  for (const item of result.errors ?? []) lines.push(`${item.path}: ${item.message}`);
  const leftOut = files.filter((file) => !file.selected);
  if (leftOut.length > 0) {
    lines.push(`Left out ${leftOut.length} diagram${leftOut.length === 1 ? "" : "s"} that would not parse.`);
  }
  if (result.operationId) lines.push(`Undo with nerdgram replace --undo ${result.operationId}`);
  writeOut(io, isJson(parsed.flags), (applied.json as Record<string, unknown>) ?? {}, lines.join("\n"));
}

async function refreshCommand(parsed: Parsed, io: Io): Promise<void> {
  if (parsed.flags.has("view")) {
    throw new CliError("refresh does not take --view. The view comes from the diagram.");
  }
  const diagramPath = parsed.positionals[0] ?? flagString(parsed.flags, "path");
  if (!diagramPath) throw new CliError("refresh needs a diagram path.");
  const dataFile = flagString(parsed.flags, "data");
  const text = dataFile ? await fs.readFile(dataFile, "utf8") : undefined;
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/generate/refresh", {
    path: diagramPath,
    text,
    save: true,
    writeData: text != null,
  });
  const body = result.json as { path: string; saved?: boolean; diff?: unknown };
  writeOut(io, isJson(parsed.flags), body, `Refreshed ${body.path}`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function convertCommand(parsed: Parsed, io: Io): Promise<void> {
  const translators = await import("./translators/index.js");
  const source = parsed.positionals[0] ?? "";
  if (!source) {
    const installed = await translators.installedTranslators();
    const ids = installed.map((item) => item.id).join(", ") || "(none)";
    throw new CliError(`Usage: nerdgram convert <source> [file] [-o out.network.json]\nInstalled translators: ${ids}`);
  }
  const file = parsed.positionals[1];
  let text: string;
  if (file && file !== "-") text = await fs.readFile(file, "utf8");
  else if (io.stdin != null) text = io.stdin;
  else if (process.stdin.isTTY) throw new CliError("convert needs a file or stdin.");
  else text = await readStdin();
  translators.assertConvertInputSize(Buffer.byteLength(text));
  const converted = await translators.convertExport(source, translators.parseExport(text));
  const pretty = `${JSON.stringify(converted.document, null, 2)}\n`;
  const output = flagString(parsed.flags, "output");
  if (output) await fs.writeFile(output, pretty, "utf8");
  const warningLines = converted.warnings.map((item) => (item.path ? `${item.path}: ${item.message}` : item.message));
  if (!isJson(parsed.flags) && warningLines.length > 0) io.stderr(`${warningLines.join("\n")}\n`);
  if (isJson(parsed.flags)) {
    const payload = output
      ? { source: converted.source, output, warnings: converted.warnings, bytes: Buffer.byteLength(pretty) }
      : { source: converted.source, document: converted.document, warnings: converted.warnings };
    writeOut(io, true, payload, "");
    return;
  }
  if (output) {
    io.stdout(`Wrote ${output}\n`);
    return;
  }
  io.stdout(pretty);
}

export async function main(argv: string[], io: Partial<Io> = {}): Promise<number> {
  const streams: Io = {
    stdout: io.stdout ?? ((chunk) => process.stdout.write(chunk)),
    stderr: io.stderr ?? ((chunk) => process.stderr.write(chunk)),
    env: io.env ?? process.env,
    stdin: io.stdin,
  };
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    streams.stderr(`${message}\n`);
    return 1;
  }
  if (parsed.flags.get("version") === true) {
    streams.stdout(`nerdgram ${cliVersion()}\n`);
    return 0;
  }
  if (parsed.flags.get("help") === true || parsed.command === "help" || parsed.command === "") {
    streams.stdout(HELP);
    return parsed.command === "" && parsed.flags.get("help") !== true && parsed.positionals.length === 0 ? 0 : 0;
  }
  try {
    switch (parsed.command) {
      case "render":
        await renderCommand(parsed, streams);
        return 0;
      case "list":
        await listCommand(parsed, streams);
        return 0;
      case "search":
        await searchCommand(parsed, streams);
        return 0;
      case "get":
        await getCommand(parsed, streams);
        return 0;
      case "put":
        await putCommand(parsed, streams);
        return 0;
      case "export":
        await exportCommand(parsed, streams);
        return 0;
      case "lint":
        return await lintCommand(parsed, streams);
      case "repair-links":
        await repairLinksCommand(parsed, streams);
        return 0;
      case "rename":
        await renameCommand(parsed, streams);
        return 0;
      case "move":
        await moveCommand(parsed, streams);
        return 0;
      case "duplicate":
        await duplicateCommand(parsed, streams);
        return 0;
      case "delete":
        await deleteCommand(parsed, streams);
        return 0;
      case "generate":
        await generateCommand(parsed, streams);
        return 0;
      case "convert":
        await convertCommand(parsed, streams);
        return 0;
      case "refresh":
        await refreshCommand(parsed, streams);
        return 0;
      case "diff":
        await diffCommand(parsed, streams);
        return 0;
      case "baseline":
        await baselineCommand(parsed, streams);
        return 0;
      case "replace":
        await replaceCommand(parsed, streams);
        return 0;
      case "template":
        await templateCommand(parsed, streams);
        return 0;
      case "mcp":
        try {
          await mcpCommand(parsed, streams);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          streams.stderr(`${message}\n`);
          return 1;
        }
        return 0;
      default:
        throw new CliError(`Unknown command ${parsed.command}. Run nerdgram --help.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJson(parsed.flags)) {
      const errors = err instanceof CliError && Array.isArray(err.details?.errors) ? err.details.errors : undefined;
      streams.stdout(
        `${JSON.stringify({ ok: false, error: message, status: failureStatus(err), ...(errors ? { errors } : {}) })}\n`,
      );
    } else streams.stderr(`${message}\n`);
    return 1;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const invoked = path.resolve(entry);
  const self = fileURLToPath(import.meta.url);
  return invoked === self || invoked.endsWith(`${path.sep}cli.ts`) || invoked.endsWith(`${path.sep}cli.js`);
}

if (isDirectRun()) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await shutdownCli();
      process.exit(code);
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      await shutdownCli().catch(() => undefined);
      process.exit(1);
    });
}
