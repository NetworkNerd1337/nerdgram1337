import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import {
  LINT_RULE_IDS,
  brokenClickFindings,
  lintDiagramContent,
  type ClickRef,
  type LintDiagnostic,
} from "./diagramLint.js";
import { mermaidSyntaxDiagnostic } from "./mermaidSyntax.js";
import { resolveSafePath } from "./paths.js";
import { reportUnreadable, type UnreadableDiagram } from "./readError.js";
import { warningsMuted } from "./warningMute.js";

const CONCURRENCY = 4;

type Entry = {
  size: number;
  mtimeMs: number;
  hash: string;
  diagnostics: LintDiagnostic[];
  clicks: ClickRef[];
  muted: boolean;
};

export type DiagramLintPass = {
  checked: number;
  relinted: number;
  durationMs: number;
  cachedAt: string;
  diagrams: { path: string; diagnostics: LintDiagnostic[] }[];
  unreadable: UnreadableDiagram[];
  muted: string[];
};

export type DiagramLintSummary = {
  status: "not-checked" | "ready";
  checkedAt: string | null;
  stale: boolean;
  checked: number | null;
  errors: number | null;
  warnings: number | null;
  unreadable: number | null;
  muted: number | null;
  diagrams: { path: string; errors: number; warnings: number; parse: boolean; muted: boolean }[] | null;
};

type PassInput = {
  files: readonly { path: string }[];
  stat: (filePath: string) => Promise<{ size: number; mtimeMs: number } | null>;
  read: (filePath: string) => Promise<{ content: string }>;
};

type LintOutcome = "parsed" | "cached" | "missing" | "discarded";

const entries = new Map<string, Entry>();
const dirty = new Set<string>();
let pathSetHash = "";
let rulesKey = "";
let last: DiagramLintPass | null = null;
let stale = false;
let workspaceDirty = false;
let revision = 0;
let inflight: Promise<DiagramLintPass> | null = null;
let tail: Promise<void> = Promise.resolve();
let parsedFiles = 0;
let fullPasses = 0;
let afterRead: ((filePath: string) => Promise<void> | void) | null = null;

/**
 * Paths passed in are dirty: the next summary re-lints only those files.
 * Omitting paths marks the whole workspace dirty (a folder wipe). A pass
 * that is already running must not publish its pre-invalidation rows as fresh.
 */
export function invalidateDiagramLint(paths?: readonly string[]): void {
  revision += 1;
  if (!paths) {
    markWorkspaceDirty();
    return;
  }
  let marked = false;
  for (const item of paths) {
    if (!item) continue;
    entries.delete(item);
    dirty.add(item);
    marked = true;
  }
  if (marked && last) stale = true;
}

function markWorkspaceDirty(): void {
  const known = new Set<string>(entries.keys());
  if (last) {
    for (const row of last.diagrams) known.add(row.path);
    for (const filePath of last.muted) known.add(filePath);
    for (const item of last.unreadable) known.add(item.path);
  }
  entries.clear();
  pathSetHash = "";
  dirty.clear();
  for (const filePath of known) dirty.add(filePath);
  workspaceDirty = true;
  if (last) stale = true;
}

export function clearDiagramLintCache(): void {
  entries.clear();
  dirty.clear();
  pathSetHash = "";
  rulesKey = "";
  last = null;
  stale = false;
  workspaceDirty = false;
  revision += 1;
  afterRead = null;
}

/** How many diagrams were actually parsed since the last reset. Cache hits are not counted. */
export function diagramLintParsedCount(): number {
  return parsedFiles;
}

/** How many library-wide passes have started since the last reset. Summary refresh is not one. */
export function diagramLintFullPassCount(): number {
  return fullPasses;
}

export function resetDiagramLintCounters(): void {
  parsedFiles = 0;
  fullPasses = 0;
}

/** Test hook. Runs after a file is read and before that read is stored. */
export function setDiagramLintAfterRead(hook: ((filePath: string) => Promise<void> | void) | null): void {
  afterRead = hook;
}

/** Current cache flags, without refreshing. `entryMuted` is null when that path has no row. */
export function peekDiagramLintCache(): {
  stale: boolean;
  dirty: string[];
  workspaceDirty: boolean;
  entryMuted: (filePath: string) => boolean | null;
} {
  return {
    stale,
    dirty: [...dirty],
    workspaceDirty,
    entryMuted: (filePath: string) => {
      const entry = entries.get(filePath);
      return entry ? entry.muted : null;
    },
  };
}

export function diagramLintSummary(): DiagramLintSummary {
  if (!last) {
    return {
      status: "not-checked",
      checkedAt: null,
      stale: false,
      checked: null,
      errors: null,
      warnings: null,
      unreadable: null,
      muted: null,
      diagrams: null,
    };
  }
  let errors = 0;
  let warnings = 0;
  const mutedPaths = new Set(last.muted);
  const diagrams = last.diagrams.map((diagram) => {
    const diagramErrors = diagram.diagnostics.filter((item) => item.severity === "error").length;
    const diagramWarnings = diagram.diagnostics.length - diagramErrors;
    errors += diagramErrors;
    warnings += diagramWarnings;
    return {
      path: diagram.path,
      errors: diagramErrors,
      warnings: diagramWarnings,
      parse: diagram.diagnostics.some((item) => item.ruleId === "parse"),
      muted: mutedPaths.has(diagram.path),
    };
  });
  return {
    status: "ready",
    checkedAt: last.cachedAt,
    stale,
    checked: last.checked,
    errors,
    warnings,
    unreadable: last.unreadable.length,
    muted: last.muted.length,
    diagrams,
  };
}

/**
 * Summary read. When nothing is dirty this does not stat or read a diagram.
 * Otherwise it re-lints only the dirty paths and patches `last`. A library-wide
 * pass that is already running is allowed to finish first, and it cannot clear
 * `stale` for files invalidated while it was in flight.
 */
export async function diagramLintSummaryFresh(load: () => Promise<PassInput>): Promise<DiagramLintSummary> {
  if (inflight) await inflight.catch(() => undefined);
  if (!last || (!workspaceDirty && dirty.size === 0)) return diagramLintSummary();
  await exclusive(async () => {
    let guard = 0;
    while (last && (workspaceDirty || dirty.size > 0) && guard < 8) {
      guard += 1;
      await refreshDirty(await load());
    }
  });
  return diagramLintSummary();
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hashPaths(paths: readonly string[]): string {
  return createHash("sha256").update(paths.join("\n"), "utf8").digest("hex");
}

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function pool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) await run(item);
    }
  });
  await Promise.all(workers);
}

function visibleDiagnostics(entry: Entry, paths: readonly string[], sourcePath: string): LintDiagnostic[] {
  const links = brokenClickFindings(entry.clicks, paths, sourcePath);
  const combined = [...entry.diagnostics, ...links];
  const kept = entry.muted ? combined.filter((item) => item.severity !== "warning") : combined;
  kept.sort((a, b) => a.from - b.from || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  return kept;
}

function stillDirty(filePath: string, ticket: number): boolean {
  return revision !== ticket && (dirty.has(filePath) || workspaceDirty);
}

async function lintOne(
  filePath: string,
  stat: PassInput["stat"],
  read: PassInput["read"],
  unreadable: UnreadableDiagram[],
): Promise<LintOutcome> {
  const ticket = revision;
  let fileStat: { size: number; mtimeMs: number } | null;
  try {
    fileStat = await stat(filePath);
  } catch (err) {
    if (stillDirty(filePath, ticket)) return "discarded";
    unreadable.push(reportUnreadable(filePath, err));
    entries.delete(filePath);
    dirty.delete(filePath);
    return "missing";
  }
  if (!fileStat) {
    if (stillDirty(filePath, ticket)) return "discarded";
    unreadable.push(reportUnreadable(filePath, Object.assign(new Error("missing"), { code: "ENOENT" })));
    entries.delete(filePath);
    dirty.delete(filePath);
    return "missing";
  }
  const cached = entries.get(filePath);
  if (cached && cached.size === fileStat.size && cached.mtimeMs === fileStat.mtimeMs) {
    if (stillDirty(filePath, ticket)) {
      entries.delete(filePath);
      return "discarded";
    }
    dirty.delete(filePath);
    return "cached";
  }
  let content: string;
  try {
    content = (await read(filePath)).content;
  } catch (err) {
    if (stillDirty(filePath, ticket)) return "discarded";
    unreadable.push(reportUnreadable(filePath, err));
    entries.delete(filePath);
    dirty.delete(filePath);
    return "missing";
  }
  if (afterRead) await afterRead(filePath);
  const digest = hashText(content);
  if (cached && cached.hash === digest) {
    if (stillDirty(filePath, ticket)) {
      entries.delete(filePath);
      return "discarded";
    }
    entries.set(filePath, { ...cached, size: fileStat.size, mtimeMs: fileStat.mtimeMs });
    dirty.delete(filePath);
    return "cached";
  }
  const parsed = lintDiagramContent(content);
  parsedFiles += 1;
  const syntax = await mermaidSyntaxDiagnostic(content);
  if (stillDirty(filePath, ticket)) {
    entries.delete(filePath);
    return "discarded";
  }
  const diagnostics = syntax ? [...parsed.diagnostics, syntax] : parsed.diagnostics;
  entries.set(filePath, {
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    hash: digest,
    diagnostics,
    clicks: parsed.clicks,
    muted: warningsMuted(content),
  });
  dirty.delete(filePath);
  return "parsed";
}

function assemble(
  paths: readonly string[],
  unreadable: UnreadableDiagram[],
  relinted: number,
  started: number,
): DiagramLintPass {
  const muted: string[] = [];
  const diagrams: { path: string; diagnostics: LintDiagnostic[] }[] = [];
  for (const filePath of paths) {
    if (dirty.has(filePath) || workspaceDirty) continue;
    const entry = entries.get(filePath);
    if (!entry) continue;
    if (entry.muted) muted.push(filePath);
    const diagnostics = visibleDiagnostics(entry, paths, filePath);
    if (diagnostics.length > 0) diagrams.push({ path: filePath, diagnostics });
  }
  return {
    checked: paths.length,
    relinted,
    durationMs: Date.now() - started,
    cachedAt: new Date().toISOString(),
    diagrams,
    unreadable,
    muted,
  };
}

async function execute(input: PassInput): Promise<DiagramLintPass> {
  fullPasses += 1;
  const started = Date.now();
  const signature = LINT_RULE_IDS.join(",");
  if (rulesKey && rulesKey !== signature) {
    entries.clear();
    pathSetHash = "";
  }
  rulesKey = signature;
  workspaceDirty = false;
  const ticket = revision;

  const paths = input.files.map((file) => file.path);
  const seen = new Set(paths);
  let relinted = 0;
  const unreadable: UnreadableDiagram[] = [];

  await pool(input.files, CONCURRENCY, async (file) => {
    const outcome = await lintOne(file.path, input.stat, input.read, unreadable);
    if (outcome === "parsed") relinted += 1;
  });

  for (const key of [...entries.keys()]) {
    if (!seen.has(key)) entries.delete(key);
  }
  if (revision === ticket) {
    for (const filePath of [...dirty]) {
      if (!seen.has(filePath)) dirty.delete(filePath);
    }
  }

  const result = assemble(paths, unreadable, relinted, started);
  last = result;
  pathSetHash = hashPaths(paths);
  stale = workspaceDirty || dirty.size > 0;
  return result;
}

async function refreshDirty(input: PassInput): Promise<void> {
  if (!last) return;
  const started = Date.now();
  const paths = input.files.map((file) => file.path);
  const pathSet = new Set(paths);
  const todo = new Set<string>();
  if (workspaceDirty) {
    workspaceDirty = false;
    entries.clear();
    dirty.clear();
    for (const filePath of paths) todo.add(filePath);
  } else {
    for (const filePath of dirty) todo.add(filePath);
  }

  const unreadable = last.unreadable.filter((item) => pathSet.has(item.path) && !todo.has(item.path));
  let relinted = 0;
  await pool([...todo], CONCURRENCY, async (filePath) => {
    if (!pathSet.has(filePath)) {
      const ticket = revision;
      entries.delete(filePath);
      if (revision === ticket) dirty.delete(filePath);
      return;
    }
    const outcome = await lintOne(filePath, input.stat, input.read, unreadable);
    if (outcome === "parsed") relinted += 1;
  });

  if (!last) return;
  last = assemble(paths, unreadable, relinted, started);
  pathSetHash = hashPaths(paths);
  stale = workspaceDirty || dirty.size > 0;
}

/**
 * One library-wide pass at a time. A request that arrives while a pass is
 * running waits for that pass instead of starting another. Summary refresh
 * waits behind the same lock so the two cannot write the cache together.
 */
export function lintWorkspaceCached(input: PassInput): Promise<DiagramLintPass> {
  if (!inflight) {
    inflight = exclusive(() => execute(input)).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

type TreeLike = { type: string; path: string; children?: TreeLike[] };

function walkDiagramPaths(nodes: readonly TreeLike[]): { path: string }[] {
  const files: { path: string }[] = [];
  for (const node of nodes) {
    if (node.type === "folder" && node.children) files.push(...walkDiagramPaths(node.children));
    else if (node.type === "file") files.push({ path: node.path });
  }
  return files;
}

async function statDiagramFile(filePath: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.stat(resolveSafePath(filePath));
    if (!stat.isFile()) return null;
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

/**
 * One library-wide pass for process start, so a file edited outside NerdGram
 * is included before the first dashboard visit. Later visits re-lint only
 * what changed inside the app. Diagram health still calls `lintWorkspaceCached`.
 */
export async function startDiagramLintScan(): Promise<void> {
  const { buildTree, readFile } = await import("./fsStore.js");
  const files = walkDiagramPaths(await buildTree());
  await lintWorkspaceCached({
    files,
    stat: statDiagramFile,
    read: async (filePath) => readFile(filePath),
  });
}
