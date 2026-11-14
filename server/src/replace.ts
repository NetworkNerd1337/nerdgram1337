import { readDataSource } from "./diagramData.js";
import { extractClickLinks } from "./diagramLinks.js";
import { matchFrontMatter } from "./frontMatter.js";
import * as store from "./fsStore.js";
import { lintDiagramSource } from "./mermaidSyntax.js";
import { assertWriteAllowed } from "./locks.js";
import { getMetaPath } from "./paths.js";
import { bloomMayContain, freshIndexedBlooms, rememberSearchEntries } from "./search.js";
import {
  atomicWriteJson,
  createId,
  httpFail,
  normalizeRelative,
  readJsonFile,
} from "./storage.js";
import path from "node:path";

/**
 * Workspace find and replace.
 *
 * The editor's find bar stays on the open diagram. This module previews a
 * replacement across diagrams, then writes each selected file through
 * `writeFile`, so the previous bytes become a revision first. Hidden files,
 * `.meta`, trash, and bundled templates are never candidates: the tree walk
 * already skips dot paths, and explicit paths into those places are refused.
 */

export const MAX_FIND_CHARS = 500;
export const MAX_REGEX_CHARS = 200;
export const MAX_REPLACE_CHARS = 20_000;
export const MAX_SHOWN_MATCHES = 200;
export const MAX_SHOWN_PER_FILE = 40;
const MAX_OPERATIONS = 40;

const UNSAFE_NESTED = /(\([^()]*[+*][^()]*\))(?:[+*]|\{\d)/;

export type ReplaceQuery = {
  find: string;
  replace: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeFrontMatter: boolean;
};

export type ReplaceScope = {
  folder?: string;
  recursive?: boolean;
  paths?: string[];
};

export type MatchWarning = "node-id" | "click-target" | "path";

export type ReplaceMatchPreview = {
  id: string;
  line: number;
  column: number;
  before: string;
  after: string;
  matchStart: number;
  matchLength: number;
  replaceLength: number;
  contextBefore: string | null;
  contextAfter: string | null;
  warnings: MatchWarning[];
  selected: boolean;
};

export type ReplaceFilePreview = {
  path: string;
  hash: string;
  mtimeMs: number;
  matchCount: number;
  shownCount: number;
  truncated: boolean;
  selected: boolean;
  generated: boolean;
  dataFile: string | null;
  generatedWarning: string | null;
  lint: {
    invalid: boolean;
    newlyInvalid: boolean;
    messages: string[];
  };
  matches: ReplaceMatchPreview[];
};

export type ReplacePreview = {
  find: string;
  replace: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeFrontMatter: boolean;
  scope: { folder: string | null; recursive: boolean; paths: string[] | null };
  totals: { replacements: number; diagrams: number; shown: number };
  truncated: boolean;
  message: string | null;
  excluded: { path: string; reason: string }[];
  files: ReplaceFilePreview[];
};

export type ReplaceSkipReason =
  | "locked"
  | "changed"
  | "not-found"
  | "hidden"
  | "meta"
  | "not-diagram"
  | "none"
  | "edited"
  | "missing";

export type ReplaceApplyResult = {
  operationId: string | null;
  changed: { path: string; revisionId: string; hash: string; replacements: number }[];
  skipped: { path: string; reason: ReplaceSkipReason }[];
  errors: { path: string; message: string }[];
  totals: { diagrams: number; replacements: number };
};

export type ReplaceUndoResult = {
  id: string;
  restored: { path: string; hash: string }[];
  skipped: { path: string; reason: ReplaceSkipReason }[];
  errors: { path: string; message: string }[];
};

type RawMatch = {
  start: number;
  end: number;
  text: string;
  replacement: string;
};

type Span = { start: number; end: number; kind: MatchWarning };

type StoredFile = { path: string; revisionId: string; hashAfter: string };

type StoredOperation = {
  id: string;
  createdAt: string;
  files: StoredFile[];
};

type OperationFile = {
  version: 1;
  operations: StoredOperation[];
};

let operationChain: Promise<void> = Promise.resolve();

function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = operationChain.then(fn, fn);
  operationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpFail(400, "JSON object required", "invalid");
  }
  return input as Record<string, unknown>;
}

function flag(value: unknown, name: string): boolean {
  if (value == null || value === false) return false;
  if (value === true) return true;
  throw httpFail(400, `${name} must be a boolean`, "invalid");
}

function readQuery(body: Record<string, unknown>): ReplaceQuery {
  if (typeof body.find !== "string" || body.find.length === 0) {
    throw httpFail(400, "find is required", "invalid");
  }
  if (body.find.length > MAX_FIND_CHARS) throw httpFail(400, "find is too long", "invalid");
  if (typeof body.replace !== "string") throw httpFail(400, "replace must be a string", "invalid");
  if (body.replace.length > MAX_REPLACE_CHARS) throw httpFail(400, "replace is too long", "invalid");
  return {
    find: body.find,
    replace: body.replace,
    matchCase: flag(body.matchCase, "matchCase"),
    wholeWord: flag(body.wholeWord, "wholeWord"),
    regex: flag(body.regex, "regex"),
    includeFrontMatter: flag(body.includeFrontMatter, "includeFrontMatter"),
  };
}

function cleanFolder(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw httpFail(400, "scope.folder must be a string", "invalid");
  const normalized = normalizeRelative(value);
  if (!normalized) return undefined;
  if (normalized.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw httpFail(400, "folder is not a workspace folder", "invalid");
  }
  return normalized;
}

function readScope(body: Record<string, unknown>): ReplaceScope {
  if (body.scope == null) return {};
  if (typeof body.scope !== "object" || Array.isArray(body.scope)) {
    throw httpFail(400, "scope must be an object", "invalid");
  }
  const scope = body.scope as Record<string, unknown>;
  let paths: string[] | undefined;
  if (scope.paths != null) {
    if (!Array.isArray(scope.paths)) throw httpFail(400, "scope.paths must be an array", "invalid");
    if (scope.paths.length > 500) throw httpFail(400, "scope.paths is too long", "invalid");
    paths = scope.paths.map((item, index) => {
      if (typeof item !== "string") throw httpFail(400, `scope.paths[${index}] must be a string`, "invalid");
      return item;
    });
  }
  if (scope.recursive != null && typeof scope.recursive !== "boolean") {
    throw httpFail(400, "scope.recursive must be a boolean", "invalid");
  }
  return {
    folder: cleanFolder(scope.folder),
    recursive: scope.recursive == null ? undefined : scope.recursive === true,
    paths,
  };
}

function exclusionReason(relativePath: string): string | null {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || !normalized.toLowerCase().endsWith(".mmd")) return "not-diagram";
  const parts = normalized.split("/");
  if (parts.some((part) => part.startsWith("."))) {
    if (parts[0] === ".meta") return "meta";
    return "hidden";
  }
  return null;
}

function underFolder(filePath: string, folder: string, recursive: boolean): boolean {
  if (!folder) return true;
  if (recursive) return filePath.startsWith(`${folder}/`);
  const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  return parent === folder;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function compileReplacePattern(query: ReplaceQuery): RegExp {
  let source: string;
  if (query.regex) {
    if (query.find.length > MAX_REGEX_CHARS) {
      throw httpFail(400, "That regular expression is too long", "invalid");
    }
    const quantifiers = query.find.match(/[+*]|\{\d/g) ?? [];
    if (UNSAFE_NESTED.test(query.find) || /\\[1-9]/.test(query.find) || quantifiers.length > 12) {
      throw httpFail(400, "That regular expression is not allowed", "unsafe_regex");
    }
    source = query.wholeWord ? `\\b(?:${query.find})\\b` : query.find;
  } else {
    source = escapeRegExp(query.find);
    if (query.wholeWord) source = `\\b${source}\\b`;
  }
  try {
    return new RegExp(source, query.matchCase ? "g" : "gi");
  } catch {
    throw httpFail(400, "That regular expression is invalid", "invalid");
  }
}

function substitute(match: RegExpExecArray, replacement: string): string {
  return replacement.replace(/\$\$|\$&|\$<([^>]+)>|\$(\d{1,2})/g, (token, name: string | undefined, num: string | undefined) => {
    if (token === "$$") return "$";
    if (token === "$&") return match[0];
    if (name) return match.groups?.[name] ?? "";
    const index = Number(num);
    return match[index] ?? "";
  });
}

function bodyStartOf(content: string): number {
  return matchFrontMatter(content)?.length ?? 0;
}

export function findReplaceMatches(content: string, query: ReplaceQuery, expression: RegExp): RawMatch[] {
  const startAt = query.includeFrontMatter ? 0 : bodyStartOf(content);
  const region = content.slice(startAt);
  const found: RawMatch[] = [];
  expression.lastIndex = 0;
  let guard = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(region))) {
    guard += 1;
    if (guard > region.length + 1) break;
    if (match[0].length === 0) {
      expression.lastIndex = match.index + 1;
      continue;
    }
    const start = startAt + match.index;
    found.push({
      start,
      end: start + match[0].length,
      text: match[0],
      replacement: query.regex ? substitute(match, query.replace) : query.replace,
    });
  }
  return found;
}

function matchKey(match: { start: number; end: number }): string {
  return `${match.start}:${match.end}`;
}

function applyMatches(content: string, matches: readonly RawMatch[], skip: ReadonlySet<string>): string {
  let cursor = 0;
  let next = "";
  for (const match of matches) {
    if (skip.has(matchKey(match))) continue;
    next += content.slice(cursor, match.start);
    next += match.replacement;
    cursor = match.end;
  }
  return next + content.slice(cursor);
}

function lineContext(content: string, match: RawMatch): Omit<ReplaceMatchPreview, "id" | "warnings" | "selected"> {
  const lineStart = content.lastIndexOf("\n", Math.max(0, match.start - 1)) + 1;
  let lineEnd = content.indexOf("\n", match.end);
  if (lineEnd === -1) lineEnd = content.length;
  let textEnd = lineEnd;
  if (textEnd > lineStart && content[textEnd - 1] === "\r") textEnd -= 1;
  const before = content.slice(lineStart, textEnd);
  const matchStart = match.start - lineStart;
  const after = before.slice(0, matchStart) + match.replacement + before.slice(matchStart + match.text.length);
  let contextBefore: string | null = null;
  if (lineStart > 0) {
    const prevEnd = lineStart - 1;
    const prevStart = content.lastIndexOf("\n", Math.max(0, prevEnd - 1)) + 1;
    contextBefore = content.slice(prevStart, content[prevEnd - 1] === "\r" ? prevEnd - 1 : prevEnd);
  }
  let contextAfter: string | null = null;
  if (lineEnd < content.length) {
    const nextStart = lineEnd + 1;
    let nextEnd = content.indexOf("\n", nextStart);
    if (nextEnd === -1) nextEnd = content.length;
    if (nextEnd > nextStart && content[nextEnd - 1] === "\r") nextEnd -= 1;
    contextAfter = content.slice(nextStart, nextEnd);
  }
  const line = content.slice(0, match.start).split("\n").length;
  return {
    line,
    column: matchStart + 1,
    before,
    after,
    matchStart,
    matchLength: match.text.length,
    replaceLength: match.replacement.length,
    contextBefore,
    contextAfter,
  };
}

const ID_KEYWORDS = new Set([
  "flowchart",
  "graph",
  "subgraph",
  "end",
  "click",
  "style",
  "class",
  "classdef",
  "direction",
  "linkstyle",
  "participant",
  "actor",
  "note",
  "loop",
  "alt",
  "else",
  "opt",
  "par",
  "title",
  "lr",
  "rl",
  "td",
  "tb",
  "bt",
]);

function addId(spans: Span[], line: string, lineStart: number, id: string, at: number): void {
  if (!id || ID_KEYWORDS.has(id.toLowerCase())) return;
  if (at < 0 || at + id.length > line.length) return;
  spans.push({ start: lineStart + at, end: lineStart + at + id.length, kind: "node-id" });
}

function looksLikePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^https?:/i.test(trimmed)) return false;
  if (/^(?:nerdgram|diagram):/i.test(trimmed)) return true;
  if (trimmed.includes("/") || trimmed.includes("\\")) return true;
  return /\.(?:mmd|csv|json|cdp|lldp)$/i.test(trimmed);
}

function insideQuotes(line: string, index: number): boolean {
  let quoted = false;
  let quote = "";
  for (let i = 0; i < index && i < line.length; i += 1) {
    const char = line[i] ?? "";
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      if (!quoted) {
        quoted = true;
        quote = char;
      } else if (char === quote) {
        quoted = false;
      }
    }
  }
  return quoted;
}

function skipShapesLeft(line: string, index: number): number {
  let cursor = index;
  const closers: Record<string, string> = { "]": "[", ")": "(", "}": "{" };
  while (cursor > 0) {
    while (cursor > 0 && /\s/.test(line[cursor - 1] ?? "")) cursor -= 1;
    const close = line[cursor - 1] ?? "";
    const open = closers[close];
    if (!open) break;
    cursor -= 1;
    let depth = 1;
    while (cursor > 0 && depth > 0) {
      cursor -= 1;
      const char = line[cursor] ?? "";
      if (char === close) depth += 1;
      else if (char === open) depth -= 1;
    }
  }
  while (cursor > 0 && /\s/.test(line[cursor - 1] ?? "")) cursor -= 1;
  return cursor;
}

function addLineSpans(line: string, lineStart: number, spans: Span[]): void {
  const labeled = [
    /^\s*click\s+/i,
    /^\s*subgraph\s+/i,
    /^\s*style\s+/i,
    /^\s*(?:participant|actor)\s+/i,
  ];
  for (const lead of labeled) {
    const found = lead.exec(line);
    const id = found ? /^([A-Za-z_][\w-]*)/.exec(line.slice(found[0].length)) : null;
    if (found && id?.[1]) addId(spans, line, lineStart, id[1], found[0].length);
  }
  if (!line.includes("[")) {
    const classLine = /^\s*class\s+([A-Za-z_][\w,-]*)\s+[A-Za-z_][\w-]*\s*$/i.exec(line);
    const classLead = /^\s*class\s+/i.exec(line);
    if (classLine?.[1] && classLead) {
      let cursor = classLead[0].length;
      for (const part of classLine[1].split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const at = line.indexOf(trimmed, cursor);
        if (at >= 0) addId(spans, line, lineStart, trimmed, at);
        cursor = Math.max(cursor, at + trimmed.length);
      }
    }
  }

  const shape = /([A-Za-z_][\w-]*)(?=\s*(?:\[\(|\[\[|\[\\|\[\/|\(\[|\(\(|\{\{|\[|\(|\{|>))/g;
  let shapeMatch: RegExpExecArray | null;
  while ((shapeMatch = shape.exec(line))) {
    if (!shapeMatch[1] || insideQuotes(line, shapeMatch.index)) continue;
    addId(spans, line, lineStart, shapeMatch[1], shapeMatch.index);
  }

  const arrow = /(<-->|<==>|-->|---|-\.->|==>|~~~|--o|--x|<--|<==|(?<!-)==(?!=))/g;
  let arrowMatch: RegExpExecArray | null;
  while ((arrowMatch = arrow.exec(line))) {
    const leftAt = skipShapesLeft(line, arrowMatch.index);
    const left = /([A-Za-z_][\w-]*)$/.exec(line.slice(0, leftAt));
    if (left?.[1] && !insideQuotes(line, leftAt - left[1].length)) {
      addId(spans, line, lineStart, left[1], leftAt - left[1].length);
    }
    let rightAt = arrowMatch.index + arrowMatch[0].length;
    while (rightAt < line.length && /\s/.test(line[rightAt] ?? "")) rightAt += 1;
    const right = /^([A-Za-z_][\w-]*)/.exec(line.slice(rightAt));
    if (right?.[1] && !insideQuotes(line, rightAt)) addId(spans, line, lineStart, right[1], rightAt);
  }
}

function sensitiveSpans(content: string): Span[] {
  const spans: Span[] = [];
  for (const click of extractClickLinks(content)) {
    spans.push({ start: click.from, end: click.to, kind: "click-target" });
    if (looksLikePath(click.target)) spans.push({ start: click.from, end: click.to, kind: "path" });
  }
  const quoted = /"([^"\n]*)"|'([^'\n]*)'/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quoted.exec(content))) {
    const value = quotedMatch[1] ?? quotedMatch[2] ?? "";
    if (!looksLikePath(value)) continue;
    const start = quotedMatch.index + 1;
    spans.push({ start, end: start + value.length, kind: "path" });
  }
  const bare = /(?:^|[\s(=])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:mmd|csv|json|cdp|lldp))/gi;
  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = bare.exec(content))) {
    const value = bareMatch[1];
    if (!value) continue;
    const start = bareMatch.index + bareMatch[0].length - value.length;
    spans.push({ start, end: start + value.length, kind: "path" });
  }

  let cursor = bodyStartOf(content);
  while (cursor <= content.length) {
    let end = content.indexOf("\n", cursor);
    if (end === -1) end = content.length;
    let textEnd = end;
    if (textEnd > cursor && content[textEnd - 1] === "\r") textEnd -= 1;
    const line = content.slice(cursor, textEnd);
    if (line.trim() && !line.trimStart().startsWith("%%")) addLineSpans(line, cursor, spans);
    if (end >= content.length) break;
    cursor = end + 1;
  }
  return spans;
}

function warningsFor(match: RawMatch, spans: readonly Span[]): MatchWarning[] {
  const kinds = new Set<MatchWarning>();
  for (const span of spans) {
    if (match.start < span.end && match.end > span.start) kinds.add(span.kind);
  }
  return [...kinds];
}

function generatedOf(content: string): { generated: boolean; dataFile: string | null; warning: string | null } {
  const source = readDataSource(content);
  if (!source) return { generated: false, dataFile: null, warning: null };
  const files = [source.file, source.edgesFile].filter((item): item is string => Boolean(item));
  return {
    generated: true,
    dataFile: source.file,
    warning: `Generated from ${files.join(" and ")}. Refresh from data would overwrite this change. Update the data file too, or the next refresh will lose it.`,
  };
}

async function lintOutcome(before: string, after: string, sourcePath: string): Promise<ReplaceFilePreview["lint"]> {
  const [beforeDiags, afterDiags] = await Promise.all([
    lintDiagramSource(before, { sourcePath }),
    lintDiagramSource(after, { sourcePath }),
  ]);
  const errors = (items: typeof beforeDiags) => items.filter((item) => item.severity === "error");
  const key = (item: (typeof beforeDiags)[number]) => `${item.ruleId}:${item.line}:${item.message}`;
  const beforeKeys = new Set(errors(beforeDiags).map(key));
  const afterErrors = errors(afterDiags);
  const hasParseError = afterDiags.some((item) => item.ruleId === "parse");
  const newlyInvalid = afterErrors.some((item) => !beforeKeys.has(key(item)));
  return {
    invalid: hasParseError || newlyInvalid,
    newlyInvalid,
    messages: afterErrors.slice(0, 5).map((item) => item.message),
  };
}

type DiagramFile = { path: string; mtimeMs: number; size: number };

function flattenDiagrams(nodes: store.TreeNode[]): DiagramFile[] {
  const files: DiagramFile[] = [];
  for (const node of nodes) {
    if (node.type === "folder") {
      if (node.children) files.push(...flattenDiagrams(node.children));
    } else if (node.path.toLowerCase().endsWith(".mmd")) {
      files.push({ path: node.path, mtimeMs: node.mtimeMs, size: node.size ?? -1 });
    }
  }
  return files;
}

async function diagramsInScope(scope: ReplaceScope): Promise<{ files: DiagramFile[]; excluded: ReplacePreview["excluded"] }> {
  const tree = flattenDiagrams(await store.buildTree());
  const byPath = new Map(tree.map((file) => [file.path, file]));
  const excluded: ReplacePreview["excluded"] = [];
  const recursive = scope.recursive !== false;
  let files = tree;
  if (scope.paths && scope.paths.length > 0) {
    files = [];
    const seen = new Set<string>();
    for (const raw of scope.paths) {
      const normalized = normalizeRelative(raw);
      const reason = exclusionReason(raw);
      if (reason) {
        excluded.push({ path: normalized || raw, reason });
        continue;
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const found = byPath.get(normalized);
      if (!found) {
        excluded.push({ path: normalized, reason: "not-found" });
        continue;
      }
      if (scope.folder && !underFolder(found.path, scope.folder, recursive)) {
        excluded.push({ path: normalized, reason: "outside-folder" });
        continue;
      }
      files.push(found);
    }
  } else if (scope.folder) {
    files = tree.filter((file) => underFolder(file.path, scope.folder ?? "", recursive));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, excluded };
}

function scopeEcho(scope: ReplaceScope): ReplacePreview["scope"] {
  return {
    folder: scope.folder ?? null,
    recursive: scope.recursive !== false,
    paths: scope.paths && scope.paths.length > 0 ? scope.paths.map((item) => normalizeRelative(item)) : null,
  };
}

export async function previewReplace(input: unknown): Promise<ReplacePreview> {
  const body = asObject(input);
  const query = readQuery(body);
  const scope = readScope(body);
  const expression = compileReplacePattern(query);
  const { files, excluded } = await diagramsInScope(scope);
  const indexed = await freshIndexedBlooms(files);
  const toRead: DiagramFile[] = [];
  for (const file of files) {
    const bloom = indexed.get(file.path);
    if (bloom && !query.regex && query.find.length >= 3 && !bloomMayContain(bloom, query.find)) continue;
    toRead.push(file);
  }

  const previews: ReplaceFilePreview[] = [];
  const remembered: { path: string; content: string; mtimeMs: number; size: number }[] = [];
  let replacements = 0;
  let shown = 0;
  for (const file of toRead) {
    const disk = await store.readFile(file.path);
    remembered.push({ path: disk.path, content: disk.content, mtimeMs: disk.mtimeMs, size: disk.size });
    const matches = findReplaceMatches(disk.content, query, expression);
    if (matches.length === 0) continue;
    replacements += matches.length;
    const room = Math.max(0, MAX_SHOWN_MATCHES - shown);
    const take = Math.min(matches.length, MAX_SHOWN_PER_FILE, room);
    const visible = matches.slice(0, take);
    shown += visible.length;
    const next = applyMatches(disk.content, matches, new Set());
    const lint = await lintOutcome(disk.content, next, disk.path);
    const spans = sensitiveSpans(disk.content);
    const generated = generatedOf(disk.content);
    previews.push({
      path: disk.path,
      hash: disk.hash,
      mtimeMs: disk.mtimeMs,
      matchCount: matches.length,
      shownCount: visible.length,
      truncated: visible.length < matches.length,
      selected: !lint.invalid,
      generated: generated.generated,
      dataFile: generated.dataFile,
      generatedWarning: generated.warning,
      lint,
      matches: visible.map((match) => ({
        id: matchKey(match),
        ...lineContext(disk.content, match),
        warnings: warningsFor(match, spans),
        selected: true,
      })),
    });
  }
  await rememberSearchEntries(remembered);

  const truncated = shown < replacements;
  const message = truncated
    ? `Showing ${shown} of ${replacements} matches. A selected diagram still replaces every match, including ones not listed. Uncheck a listed match to skip that one.`
    : null;
  return {
    find: query.find,
    replace: query.replace,
    matchCase: query.matchCase,
    wholeWord: query.wholeWord,
    regex: query.regex,
    includeFrontMatter: query.includeFrontMatter,
    scope: scopeEcho(scope),
    totals: { replacements, diagrams: previews.length, shown },
    truncated,
    message,
    excluded,
    files: previews,
  };
}

type ApplyFile = { path: string; hash: string; skip: Set<string> };

function readApplyFiles(body: Record<string, unknown>): ApplyFile[] {
  if (!Array.isArray(body.files)) throw httpFail(400, "files must be an array", "invalid");
  if (body.files.length > 500) throw httpFail(400, "files is too long", "invalid");
  return body.files.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw httpFail(400, `files[${index}] must be an object`, "invalid");
    }
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || !record.path.trim()) {
      throw httpFail(400, `files[${index}].path is required`, "invalid");
    }
    if (typeof record.hash !== "string" || !record.hash) {
      throw httpFail(400, `files[${index}].hash is required`, "invalid");
    }
    const skip = new Set<string>();
    if (record.skipMatchIds != null) {
      if (!Array.isArray(record.skipMatchIds)) {
        throw httpFail(400, `files[${index}].skipMatchIds must be an array`, "invalid");
      }
      for (const id of record.skipMatchIds) {
        if (typeof id !== "string") throw httpFail(400, `files[${index}].skipMatchIds must be strings`, "invalid");
        skip.add(id);
      }
    }
    return { path: normalizeRelative(record.path), hash: record.hash, skip };
  });
}

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return undefined;
}

function operationsPath(): string {
  return path.join(getMetaPath(), "replace", "operations.json");
}

async function recordOperation(files: StoredFile[]): Promise<string> {
  return queued(async () => {
    const id = createId();
    const stored = await readJsonFile<OperationFile>(operationsPath());
    const operations = stored?.version === 1 && Array.isArray(stored.operations) ? stored.operations : [];
    operations.push({ id, createdAt: new Date().toISOString(), files });
    const kept = operations.slice(-MAX_OPERATIONS);
    await atomicWriteJson(operationsPath(), { version: 1, operations: kept } satisfies OperationFile);
    return id;
  });
}

async function loadOperation(id: string): Promise<StoredOperation | null> {
  return queued(async () => {
    const stored = await readJsonFile<OperationFile>(operationsPath());
    if (!stored || stored.version !== 1 || !Array.isArray(stored.operations)) return null;
    return stored.operations.find((item) => item && item.id === id) ?? null;
  });
}

export async function applyReplace(input: unknown): Promise<ReplaceApplyResult> {
  const body = asObject(input);
  const query = readQuery(body);
  const expression = compileReplacePattern(query);
  const requested = readApplyFiles(body);
  const changed: ReplaceApplyResult["changed"] = [];
  const skipped: ReplaceApplyResult["skipped"] = [];
  const errors: ReplaceApplyResult["errors"] = [];

  for (const file of requested) {
    const blocked = exclusionReason(file.path);
    if (blocked) {
      skipped.push({
        path: file.path,
        reason: blocked === "meta" || blocked === "not-diagram" ? blocked : "hidden",
      });
      continue;
    }
    try {
      let disk: Awaited<ReturnType<typeof store.readFile>>;
      try {
        disk = await store.readFile(file.path);
      } catch (err) {
        if (statusOf(err) === 404) {
          skipped.push({ path: file.path, reason: "not-found" });
          continue;
        }
        throw err;
      }
      if (disk.hash !== file.hash) {
        skipped.push({ path: disk.path, reason: "changed" });
        continue;
      }
      try {
        await assertWriteAllowed(disk.path, null);
      } catch (err) {
        if (statusOf(err) === 423) {
          skipped.push({ path: disk.path, reason: "locked" });
          continue;
        }
        throw err;
      }
      const matches = findReplaceMatches(disk.content, query, expression);
      const selected = matches.filter((match) => !file.skip.has(matchKey(match)));
      if (selected.length === 0) {
        skipped.push({ path: disk.path, reason: "none" });
        continue;
      }
      const next = applyMatches(disk.content, matches, file.skip);
      if (next === disk.content) {
        skipped.push({ path: disk.path, reason: "none" });
        continue;
      }
      let written: Awaited<ReturnType<typeof store.writeFile>>;
      try {
        written = await store.writeFile(disk.path, next, { expectedHash: disk.hash });
      } catch (err) {
        if (statusOf(err) === 423) {
          skipped.push({ path: disk.path, reason: "locked" });
          continue;
        }
        if (statusOf(err) === 409) {
          skipped.push({ path: disk.path, reason: "changed" });
          continue;
        }
        throw err;
      }
      if (!written.revisionId) {
        skipped.push({ path: disk.path, reason: "none" });
        continue;
      }
      changed.push({
        path: written.path,
        revisionId: written.revisionId,
        hash: written.hash,
        replacements: selected.length,
      });
    } catch (err) {
      errors.push({
        path: file.path,
        message: err instanceof Error ? err.message : "Could not replace this diagram.",
      });
    }
  }

  const operationId = changed.length > 0 ? await recordOperation(changed.map((file) => ({
    path: file.path,
    revisionId: file.revisionId,
    hashAfter: file.hash,
  }))) : null;
  const replacements = changed.reduce((sum, file) => sum + file.replacements, 0);
  return {
    operationId,
    changed,
    skipped,
    errors,
    totals: { diagrams: changed.length, replacements },
  };
}

export async function undoReplace(input: unknown): Promise<ReplaceUndoResult> {
  const body = asObject(input);
  if (typeof body.id !== "string" || !body.id.trim()) throw httpFail(400, "id is required", "invalid");
  const operation = await loadOperation(body.id.trim());
  if (!operation) throw httpFail(404, "Replace operation not found", "not_found");
  const restored: ReplaceUndoResult["restored"] = [];
  const skipped: ReplaceUndoResult["skipped"] = [];
  const errors: ReplaceUndoResult["errors"] = [];
  for (const file of operation.files) {
    if (!file || typeof file.path !== "string" || typeof file.revisionId !== "string" || typeof file.hashAfter !== "string") {
      continue;
    }
    try {
      let disk: Awaited<ReturnType<typeof store.readFile>>;
      try {
        disk = await store.readFile(file.path);
      } catch (err) {
        if (statusOf(err) === 404) {
          skipped.push({ path: file.path, reason: "missing" });
          continue;
        }
        throw err;
      }
      if (disk.hash !== file.hashAfter) {
        skipped.push({ path: disk.path, reason: "edited" });
        continue;
      }
      try {
        await assertWriteAllowed(disk.path, null);
      } catch (err) {
        if (statusOf(err) === 423) {
          skipped.push({ path: disk.path, reason: "locked" });
          continue;
        }
        throw err;
      }
      const written = await store.restoreRevision(disk.path, file.revisionId);
      restored.push({ path: written.path, hash: written.hash });
    } catch (err) {
      const status = statusOf(err);
      if (status === 423) {
        skipped.push({ path: file.path, reason: "locked" });
        continue;
      }
      if (status === 404) {
        skipped.push({ path: file.path, reason: "missing" });
        continue;
      }
      errors.push({
        path: file.path,
        message: err instanceof Error ? err.message : "Could not undo this diagram.",
      });
    }
  }
  return { id: operation.id, restored, skipped, errors };
}
