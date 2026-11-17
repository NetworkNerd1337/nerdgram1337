import fs from "node:fs/promises";
import path from "node:path";
import { applyDiagramPatch, diagramConfigKey, parseDiagram } from "./frontMatter.js";
import { readFile, writeFile } from "./fsStore.js";
import { REPO_ROOT, ensureDataRoot, resolveSafePath, toRelativePath } from "./paths.js";
import {
  httpFail,
  normalizeRelative,
  pathExists,
  resolveAvailablePath,
} from "./storage.js";

/**
 * Diagram templates.
 *
 * Shipped templates live in `templates/` at the repo root, next to
 * `reference/`, not in the data directory. The dashboard, trash, and search
 * index do not see them. A container image copies that directory in and
 * leaves it read-only.
 *
 * User templates live in `<NERDGRAM_DATA_DIR>/.templates/<id>.mmd`. The name
 * starts with a dot, so the dashboard, trash, and search skip them the same
 * way they skip `.meta`. They survive a container rebuild because they are
 * on the data volume. GitHub sync already skips hidden paths, so these files
 * stay on this computer and are not pushed.
 *
 * Only Create as template (or `nerdgram template save`) writes a user
 * template, and the server forces its category to `User created`. Built-in
 * templates are read-only and answer 403 to every change.
 *
 * Adding a shipped template is dropping a `.mmd` file in `templates/`. The
 * file name is the id: lowercase letters, digits, and hyphens, then `.mmd`.
 * Subfolders and hidden names are ignored. The header is Mermaid front matter.
 * Title and `config.theme` are native. Description, tags, and category live
 * under `nerdgram`, which `parseDiagram` already reads.
 *
 * Creating a diagram copies the bytes through `writeFile`, which uses
 * `evaluateWrite` (no overwrite) and `resolveAvailablePath`. The target
 * folder is checked with `resolveSafePath`, so `.meta` and other dot paths
 * are refused.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;
const FILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}\.mmd$/;

/** Gallery sections, in display order. User created is always last. */
export const TEMPLATE_CATEGORIES = [
  "Network",
  "Software",
  "Internet & Cloud",
  "Security",
  "OT & Industrial",
  "Data Center",
  "Operations & Planning",
  "User created",
] as const;

export const USER_TEMPLATE_CATEGORY = "User created";

/** Shipped templates stay in this order inside their category. Later files sort by title. */
const PREFERRED_ORDER = [
  "network-topology",
  "home-lab",
  "flowchart-starter",
  "sequence-starter",
  "process-flow",
  "api-request-sequence",
  "class-model",
  "order-state",
  "database-er",
  "cicd-pipeline",
  "git-branching",
  "wan-topology",
  "internet-edge",
  "cloud-vpc",
  "hybrid-cloud",
  "site-to-site-vpn",
  "firewall-policy",
  "zero-trust-access",
  "incident-response",
  "network-segmentation",
  "purdue-model",
  "scada-communications",
  "remote-site-cellular",
  "rack-elevation",
  "spine-leaf",
  "server-storage-rack",
  "power-cooling",
  "change-window",
  "migration-plan",
  "change-request",
  "team-task-board",
  "brainstorm",
];

const TYPE_LABELS: Record<string, string> = {
  flowchart: "Flowchart",
  sequence: "Sequence",
  class: "Class",
  state: "State",
  er: "ER",
  gantt: "Gantt",
  journey: "Journey",
  pie: "Pie",
  mindmap: "Mindmap",
  timeline: "Timeline",
  gitGraph: "Git graph",
  c4: "C4",
  quadrantChart: "Quadrant",
  requirement: "Requirement",
  xyChart: "XY chart",
  block: "Block",
  sankey: "Sankey",
  packet: "Packet",
  kanban: "Kanban",
  architecture: "Architecture",
};

export type TemplateOrigin = "builtin" | "user";

export type TemplateRecord = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  theme: string | null;
  diagramType: string;
  cacheKey: string;
  malformed: boolean;
  error: string | null;
  /** Diagram text. Kept under this name so existing clients can render the card. */
  source: string;
  /** `builtin` is a shipped template. `user` comes only from Create as template. */
  origin: TemplateOrigin;
};

export type CreatedFromTemplate = {
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  templateId: string;
};

export function getTemplatesRoot(): string {
  return path.join(REPO_ROOT, "templates");
}

/** User templates. A dot directory, so the workspace tree never lists it. */
export function getUserTemplatesRoot(): string {
  return path.join(ensureDataRoot(), ".templates");
}

export function diagramTypeLabel(body: string): string {
  const key = diagramConfigKey(body);
  if (!key) return "Diagram";
  return TYPE_LABELS[key] ?? "Diagram";
}

function assertId(id: string): string {
  const trimmed = id.trim();
  if (!ID_PATTERN.test(trimmed)) {
    throw httpFail(400, "Invalid template id", "invalid");
  }
  return trimmed;
}

function safeDataPath(relativePath: string): string {
  try {
    return resolveSafePath(relativePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid path";
    throw httpFail(400, message, "invalid");
  }
}

function isHttpError(err: unknown): err is Error & { status: number } {
  return err instanceof Error && typeof (err as { status?: unknown }).status === "number";
}

function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object" || !("status" in err)) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function errorCode(err: unknown): string {
  if (!err || typeof err !== "object" || !("code" in err)) return "";
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

async function resolveTemplatesRoot(root: string): Promise<string> {
  let stat;
  try {
    stat = await fs.stat(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Template not found", "not_found");
    throw err;
  }
  if (!stat.isDirectory()) throw httpFail(404, "Template not found", "not_found");
  return fs.realpath(root);
}

/**
 * Read one template file and refuse a path that realpath resolves outside
 * `root`. The id is a single safe segment, so the lexical path cannot climb.
 */
async function readTemplateFile(root: string, id: string): Promise<string> {
  const safeId = assertId(id);
  const rootReal = await resolveTemplatesRoot(root);
  const absolute = path.resolve(rootReal, `${safeId}.mmd`);
  const lexical = path.relative(rootReal, absolute);
  if (lexical.startsWith("..") || path.isAbsolute(lexical)) {
    throw httpFail(400, "Invalid template id", "invalid");
  }
  let fileReal: string;
  try {
    fileReal = await fs.realpath(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(404, "Template not found", "not_found");
    throw err;
  }
  const fromRoot = path.relative(rootReal, fileReal);
  const parts = fromRoot.split(/[/\\]/).filter((part) => part.length > 0);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot) || parts.length !== 1 || parts[0] !== `${safeId}.mmd`) {
    throw httpFail(400, "Invalid template id", "invalid");
  }
  const stat = await fs.stat(fileReal);
  if (!stat.isFile()) throw httpFail(404, "Template not found", "not_found");
  return fs.readFile(fileReal, "utf8");
}

function toRecord(id: string, source: string, origin: TemplateOrigin): TemplateRecord {
  const parsed = parseDiagram(source);
  const title = parsed.title?.trim() || id;
  const category = origin === "user" ? USER_TEMPLATE_CATEGORY : parsed.category;
  return {
    id,
    title,
    description: parsed.description,
    tags: parsed.tags,
    category,
    theme: parsed.theme,
    diagramType: diagramTypeLabel(parsed.body),
    cacheKey: parsed.cacheKey,
    malformed: parsed.malformed,
    error: parsed.error,
    source,
    origin,
  };
}

function sortTemplates(records: TemplateRecord[]): TemplateRecord[] {
  const categoryRank = new Map(TEMPLATE_CATEGORIES.map((name, index) => [name.toLowerCase(), index]));
  const rank = new Map(PREFERRED_ORDER.map((id, index) => [id, index]));
  return [...records].sort((a, b) => {
    const leftCategory = categoryRank.get(a.category.trim().toLowerCase()) ?? 500;
    const rightCategory = categoryRank.get(b.category.trim().toLowerCase()) ?? 500;
    if (leftCategory !== rightCategory) return leftCategory - rightCategory;
    const left = rank.get(a.id) ?? 1000;
    const right = rank.get(b.id) ?? 1000;
    if (left !== right) return left - right;
    const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    if (byTitle !== 0) return byTitle;
    return a.id.localeCompare(b.id);
  });
}

export async function listTemplates(root = getTemplatesRoot()): Promise<TemplateRecord[]> {
  let rootReal: string;
  try {
    rootReal = await resolveTemplatesRoot(root);
  } catch (err) {
    if (errorStatus(err) === 404) return [];
    throw err;
  }
  const names = await fs.readdir(rootReal);
  const records: TemplateRecord[] = [];
  for (const name of names) {
    if (!FILE_PATTERN.test(name)) continue;
    const id = name.slice(0, -".mmd".length);
    try {
      const source = await readTemplateFile(rootReal, id);
      records.push(toRecord(id, source, "builtin"));
    } catch (err) {
      if (isHttpError(err) && err.status === 400) continue;
      throw err;
    }
  }
  return sortTemplates(records);
}

export async function readTemplate(id: string, root = getTemplatesRoot()): Promise<TemplateRecord> {
  const safeId = assertId(id);
  if (path.resolve(root) === path.resolve(getTemplatesRoot())) {
    try {
      const source = await readTemplateFile(root, safeId);
      return toRecord(safeId, source, "builtin");
    } catch (err) {
      if (errorStatus(err) !== 404) throw err;
      return readUserTemplateRecord(safeId);
    }
  }
  const source = await readTemplateFile(root, safeId);
  return toRecord(safeId, source, "builtin");
}

export async function listAllTemplates(): Promise<TemplateRecord[]> {
  const [builtin, user] = await Promise.all([listTemplates(), listUserTemplates()]);
  return sortTemplates([...builtin, ...user]);
}

function fileNameFrom(requested: string): string {
  if (/[\\/\0]/.test(requested)) {
    throw httpFail(400, "Diagram name cannot include a path", "invalid");
  }
  if (requested.startsWith(".")) {
    throw httpFail(400, "Invalid path", "invalid");
  }
  const fileName = requested.toLowerCase().endsWith(".mmd") ? requested : `${requested}.mmd`;
  const stem = fileName.slice(0, -".mmd".length).trim();
  if (!stem || stem.startsWith(".")) {
    throw httpFail(400, "Invalid path", "invalid");
  }
  if (fileName.length > 120) {
    throw httpFail(400, "Diagram name is too long", "invalid");
  }
  return fileName;
}

async function assertExistingFolder(folder: unknown): Promise<string> {
  if (folder == null || folder === "") return "";
  if (typeof folder !== "string") throw httpFail(400, "folder must be a string", "invalid");
  const normalized = normalizeRelative(folder);
  if (normalized === "" || normalized === ".") return "";
  const absolute = safeDataPath(normalized);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) throw httpFail(400, "That folder does not exist", "invalid");
  } catch (err) {
    if (isHttpError(err)) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw httpFail(400, "That folder does not exist", "invalid");
    throw err;
  }
  return toRelativePath(absolute);
}

/**
 * Copy a bundled template into the data directory.
 * An existing file at the chosen name is kept. The new file uses the next
 * free suffix (`Name 2.mmd`, `Name 3.mmd`). A race that loses the check is
 * retried. `writeFile` still refuses to overwrite when no baseline is sent.
 */
export async function createDiagramFromTemplate(
  id: string,
  input: { name?: unknown; folder?: unknown },
  root = getTemplatesRoot(),
): Promise<CreatedFromTemplate> {
  if (input.name != null && typeof input.name !== "string") {
    throw httpFail(400, "name must be a string", "invalid");
  }
  const template = await readTemplate(id, root);
  const folder = await assertExistingFolder(input.folder);
  const requested = typeof input.name === "string" ? input.name.trim() : "";
  const fileName = fileNameFrom(requested || template.title || template.id);
  const desired = folder ? `${folder}/${fileName}` : fileName;
  safeDataPath(desired);

  let candidate = desired;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    candidate = await resolveAvailablePath(candidate, (item) => pathExists(safeDataPath(item)));
    try {
      const written = await writeFile(candidate, template.source);
      return {
        path: written.path,
        mtimeMs: written.mtimeMs,
        size: written.size,
        hash: written.hash,
        templateId: template.id,
      };
    } catch (err) {
      if (errorCode(err) !== "exists") throw err;
    }
  }
  throw httpFail(409, "No free path is available", "collision", { path: desired });
}

const BUILTIN_READONLY = "Built-in templates cannot be changed";

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpFail(400, "JSON object required", "invalid");
  }
  return input as Record<string, unknown>;
}

function slugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\.mmd$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!ID_PATTERN.test(slug)) throw httpFail(400, "Template name needs a letter or number", "invalid");
  return slug;
}

function readTags(value: unknown, fallback: string[]): string[] {
  if (value == null) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw httpFail(400, "tags must be an array of strings", "invalid");
  }
  return value.map((item) => item.trim()).filter((item, index, all) => item && all.indexOf(item) === index);
}

async function builtinExists(id: string): Promise<boolean> {
  try {
    await readTemplateFile(getTemplatesRoot(), id);
    return true;
  } catch (err) {
    const status = errorStatus(err);
    if (status === 404 || status === 400) return false;
    throw err;
  }
}

async function refuseBuiltin(id: string): Promise<void> {
  if (await builtinExists(id)) throw httpFail(403, BUILTIN_READONLY, "forbidden");
}

function userFilePath(id: string): string {
  return path.join(getUserTemplatesRoot(), `${assertId(id)}.mmd`);
}

async function listUserTemplates(): Promise<TemplateRecord[]> {
  const root = getUserTemplatesRoot();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const records: TemplateRecord[] = [];
  for (const name of names) {
    if (!FILE_PATTERN.test(name)) continue;
    const id = name.slice(0, -".mmd".length);
    try {
      records.push(await readUserTemplateRecord(id));
    } catch (err) {
      if (isHttpError(err) && (err.status === 400 || err.status === 404)) continue;
      throw err;
    }
  }
  return records;
}

async function readUserTemplateRecord(id: string): Promise<TemplateRecord> {
  const safeId = assertId(id);
  const absolute = userFilePath(safeId);
  let text: string;
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw httpFail(404, "Template not found", "not_found");
    text = await fs.readFile(absolute, "utf8");
  } catch (err) {
    if (isHttpError(err)) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw httpFail(404, "Template not found", "not_found");
    throw err;
  }
  return toRecord(safeId, text, "user");
}

async function writeUserFile(id: string, source: string): Promise<void> {
  const absolute = userFilePath(id);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await fs.writeFile(temporary, source, "utf8");
  await fs.rename(temporary, absolute);
}

function stampUserTemplate(
  content: string,
  meta: { title?: string; description?: string; tags?: string[] },
): string {
  const patch: { title?: string; description?: string; tags?: string[]; category: string } = {
    category: USER_TEMPLATE_CATEGORY,
  };
  if (meta.title != null) patch.title = meta.title;
  if (meta.description != null) patch.description = meta.description;
  if (meta.tags != null) patch.tags = meta.tags;
  const applied = applyDiagramPatch(content, patch);
  if (!applied.ok) throw httpFail(400, applied.error, "invalid");
  const parsed = parseDiagram(applied.source);
  if (parsed.category !== USER_TEMPLATE_CATEGORY) {
    throw httpFail(400, "User templates stay in User created", "invalid");
  }
  return applied.source;
}

async function contentFromBody(body: Record<string, unknown>): Promise<string> {
  if (typeof body.content === "string") {
    if (!body.content.trim()) throw httpFail(400, "content is empty", "invalid");
    return body.content;
  }
  if (typeof body.path === "string" && body.path.trim()) {
    const file = await readFile(body.path);
    return file.content;
  }
  throw httpFail(400, "content or path is required", "invalid");
}

export async function createUserTemplate(input: unknown): Promise<TemplateRecord> {
  const body = asRecord(input);
  const content = await contentFromBody(body);
  const parsed = parseDiagram(content);
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : parsed.title?.trim() || "template";
  const description = typeof body.description === "string" ? body.description : parsed.description;
  const tags = readTags(body.tags, parsed.tags);
  const id = typeof body.id === "string" && body.id.trim() ? assertId(body.id.trim().toLowerCase()) : slugFromName(name);
  await refuseBuiltin(id);
  const absolute = userFilePath(id);
  let exists = false;
  try {
    const stat = await fs.stat(absolute);
    exists = stat.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (exists && body.replace !== true) {
    throw httpFail(409, "A user template with that name already exists", "exists", { id, title: name });
  }
  const stamped = stampUserTemplate(content, { title: name, description, tags });
  await writeUserFile(id, stamped);
  return toRecord(id, stamped, "user");
}

export async function saveUserTemplate(id: string, input: unknown): Promise<TemplateRecord> {
  const safeId = assertId(id);
  await refuseBuiltin(safeId);
  await readUserTemplateRecord(safeId);
  const body = asRecord(input);
  if (typeof body.content !== "string" || !body.content.trim()) {
    throw httpFail(400, "content is required", "invalid");
  }
  const stamped = stampUserTemplate(body.content, {});
  await writeUserFile(safeId, stamped);
  return toRecord(safeId, stamped, "user");
}

export async function renameUserTemplate(id: string, input: unknown): Promise<TemplateRecord> {
  const safeId = assertId(id);
  await refuseBuiltin(safeId);
  const current = await readUserTemplateRecord(safeId);
  const body = asRecord(input);
  const requested = typeof body.name === "string" ? body.name : typeof body.id === "string" ? body.id : "";
  if (!requested.trim()) throw httpFail(400, "name is required", "invalid");
  const nextId = typeof body.id === "string" && body.id.trim() ? assertId(body.id.trim().toLowerCase()) : slugFromName(requested);
  await refuseBuiltin(nextId);
  if (nextId !== safeId) {
    try {
      const stat = await fs.stat(userFilePath(nextId));
      if (stat.isFile()) throw httpFail(409, "A user template with that name already exists", "exists", { id: nextId });
    } catch (err) {
      if (isHttpError(err)) throw err;
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  const title = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.title;
  const stamped = stampUserTemplate(current.source, { title });
  await writeUserFile(nextId, stamped);
  if (nextId !== safeId) await fs.rm(userFilePath(safeId), { force: true });
  return toRecord(nextId, stamped, "user");
}

export async function deleteUserTemplate(id: string): Promise<void> {
  const safeId = assertId(id);
  await refuseBuiltin(safeId);
  await readUserTemplateRecord(safeId);
  await fs.rm(userFilePath(safeId), { force: true });
}
