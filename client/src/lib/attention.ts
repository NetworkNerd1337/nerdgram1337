import type { DiagramCheckFinding } from "./diagramChecks";
import type { UnreadableDiagram } from "../../../server/src/readError.ts";

/** Diagrams the Diagram health badge counts. */
export function attentionBadgeCount(
  diagrams: readonly { errors: number; warnings: number }[] | null | undefined,
): number {
  return (diagrams ?? []).filter((item) => item.errors > 0 || item.warnings > 0).length;
}

/** "1 error · 2 warnings". Errors and warnings stay separate. */
export function attentionProblemLabel(errors: number, warnings: number): string {
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(" · ");
}

export type AttentionRow = {
  path: string;
  count: number;
  message: string;
  line: number;
};

/**
 * One row per diagram that has a check problem, a broken link, or could not
 * be read. Trashed diagrams are already absent from the lint result.
 */
export function attentionRows(
  findings: readonly DiagramCheckFinding[] | null,
  unreadable: readonly UnreadableDiagram[] = [],
): AttentionRow[] {
  const rows = new Map<string, AttentionRow>();
  for (const finding of findings ?? []) {
    const current = rows.get(finding.path);
    if (!current) {
      rows.set(finding.path, {
        path: finding.path,
        count: 1,
        message: finding.message,
        line: finding.line,
      });
      continue;
    }
    current.count += 1;
    if (finding.line < current.line) {
      current.line = finding.line;
      current.message = finding.message;
    }
  }
  for (const item of unreadable) {
    if (rows.has(item.path)) {
      const current = rows.get(item.path);
      if (current) current.count += 1;
      continue;
    }
    rows.set(item.path, {
      path: item.path,
      count: 1,
      message: item.message,
      line: 1,
    });
  }
  return [...rows.values()];
}
