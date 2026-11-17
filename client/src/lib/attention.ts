import type { DiagramCheckFinding } from "./diagramChecks";
import type { UnreadableDiagram } from "../../../server/src/readError.ts";

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
