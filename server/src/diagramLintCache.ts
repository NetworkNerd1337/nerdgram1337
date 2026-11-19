import { createHash } from "node:crypto";
import {
  LINT_RULE_IDS,
  brokenClickFindings,
  lintDiagramContent,
  type ClickRef,
  type LintDiagnostic,
} from "./diagramLint.js";
import { mermaidSyntaxDiagnostic } from "./mermaidSyntax.js";
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

const entries = new Map<string, Entry>();
let pathSetHash = "";
let rulesKey = "";
let last: DiagramLintPass | null = null;
let stale = false;
let inflight: Promise<DiagramLintPass> | null = null;

export function invalidateDiagramLint(paths?: readonly string[]): void {
  if (!paths) {
    entries.clear();
    pathSetHash = "";
    if (last) stale = true;
    return;
  }
  let changed = false;
  for (const item of paths) {
    if (entries.delete(item)) changed = true;
  }
  if (changed && last) stale = true;
}

export function clearDiagramLintCache(): void {
  entries.clear();
  pathSetHash = "";
  rulesKey = "";
  last = null;
  stale = false;
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

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hashPaths(paths: readonly string[]): string {
  return createHash("sha256").update(paths.join("\n"), "utf8").digest("hex");
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

async function execute(input: PassInput): Promise<DiagramLintPass> {
  const started = Date.now();
  const signature = LINT_RULE_IDS.join(",");
  if (rulesKey && rulesKey !== signature) {
    entries.clear();
    pathSetHash = "";
  }
  rulesKey = signature;

  const paths = input.files.map((file) => file.path);
  const nextHash = hashPaths(paths);
  let relinted = 0;
  const unreadable: UnreadableDiagram[] = [];
  const seen = new Set(paths);

  await pool(input.files, CONCURRENCY, async (file) => {
    let stat: { size: number; mtimeMs: number } | null;
    try {
      stat = await input.stat(file.path);
    } catch (err) {
      unreadable.push(reportUnreadable(file.path, err));
      entries.delete(file.path);
      return;
    }
    if (!stat) {
      unreadable.push(reportUnreadable(file.path, Object.assign(new Error("missing"), { code: "ENOENT" })));
      entries.delete(file.path);
      return;
    }
    const cached = entries.get(file.path);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return;
    let content: string;
    try {
      content = (await input.read(file.path)).content;
    } catch (err) {
      unreadable.push(reportUnreadable(file.path, err));
      entries.delete(file.path);
      return;
    }
    const digest = hashText(content);
    if (cached && cached.hash === digest) {
      entries.set(file.path, { ...cached, size: stat.size, mtimeMs: stat.mtimeMs });
      return;
    }
    const parsed = lintDiagramContent(content);
    const syntax = await mermaidSyntaxDiagnostic(content);
    const diagnostics = syntax ? [...parsed.diagnostics, syntax] : parsed.diagnostics;
    entries.set(file.path, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: digest,
      diagnostics,
      clicks: parsed.clicks,
      muted: warningsMuted(content),
    });
    relinted += 1;
  });

  for (const key of [...entries.keys()]) {
    if (!seen.has(key)) entries.delete(key);
  }

  const muted: string[] = [];
  const diagrams: { path: string; diagnostics: LintDiagnostic[] }[] = [];
  for (const filePath of paths) {
    const entry = entries.get(filePath);
    if (!entry) continue;
    if (entry.muted) muted.push(filePath);
    const diagnostics = visibleDiagnostics(entry, paths, filePath);
    if (diagnostics.length > 0) diagrams.push({ path: filePath, diagnostics });
  }
  pathSetHash = nextHash;
  const result: DiagramLintPass = {
    checked: paths.length,
    relinted,
    durationMs: Date.now() - started,
    cachedAt: new Date().toISOString(),
    diagrams,
    unreadable,
    muted,
  };
  last = result;
  stale = false;
  return result;
}

/**
 * One pass at a time. A request that arrives while a pass is running waits
 * for that pass instead of starting another.
 */
export function lintWorkspaceCached(input: PassInput): Promise<DiagramLintPass> {
  if (!inflight) {
    inflight = execute(input).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
