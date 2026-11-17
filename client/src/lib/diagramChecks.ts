/** `"1"` is open. Anything else, including a missing key, stays closed. */
export const DIAGRAM_CHECKS_OPEN_KEY = "nerdgram.diagramChecksOpen";

export const DIAGRAM_CHECKS_EXPLAINER =
  "NerdGram checks every diagram for mistakes that would break it or look wrong, like a link to a diagram that doesn't exist or a node with no text. Anything it finds is listed here. Click one to jump to that line.";

export type DiagramCheckSeverity = "error" | "warning";

export type DiagramCheckFinding = {
  path: string;
  line: number;
  severity: DiagramCheckSeverity;
  message: string;
  ruleId: string;
};

export type DiagramCheckGroup = {
  path: string;
  findings: DiagramCheckFinding[];
};

export type DiagramCheckStatus = "loading" | "clear" | "warning" | "error" | "failed";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readDiagramChecksOpen(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(DIAGRAM_CHECKS_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDiagramChecksOpen(open: boolean, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(DIAGRAM_CHECKS_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Private mode and blocked storage still leave the section usable for this visit.
  }
}

export function findingsFromLint(
  result: {
    diagrams: {
      path: string;
      diagnostics: { line: number; severity: string; message: string; ruleId: string }[];
    }[];
  },
): DiagramCheckFinding[] {
  return result.diagrams.flatMap((diagram) =>
    diagram.diagnostics.map((item) => ({
      path: diagram.path,
      line: item.line,
      severity: item.severity === "error" ? "error" : "warning",
      message: item.message,
      ruleId: item.ruleId,
    })),
  );
}

export function groupDiagramChecks(findings: readonly DiagramCheckFinding[]): DiagramCheckGroup[] {
  const groups: DiagramCheckGroup[] = [];
  const index = new Map<string, DiagramCheckGroup>();
  for (const finding of findings) {
    let group = index.get(finding.path);
    if (!group) {
      group = { path: finding.path, findings: [] };
      index.set(finding.path, group);
      groups.push(group);
    }
    group.findings.push(finding);
  }
  return groups;
}

export function diagramCheckStatus(
  findings: readonly DiagramCheckFinding[] | null,
  failed: boolean,
  unreadable = 0,
): DiagramCheckStatus {
  if (findings == null) return failed ? "failed" : "loading";
  if (unreadable > 0 || findings.some((item) => item.severity === "error")) return "error";
  if (findings.length > 0) return "warning";
  return "clear";
}

export function diagramCheckSummary(
  status: DiagramCheckStatus,
  findings: readonly DiagramCheckFinding[] | null,
  unreadable = 0,
): string {
  if (status === "loading") return "Checking diagrams…";
  if (status === "failed") return "Diagram checks: could not check the diagrams";
  const items = findings ?? [];
  const errors = items.filter((item) => item.severity === "error").length;
  const warnings = items.length - errors;
  if (errors === 0 && warnings === 0 && unreadable === 0) return "Diagram checks: all diagrams look good";
  if (errors === 0 && unreadable === 0) {
    const diagrams = new Set(items.map((item) => item.path)).size;
    return `Diagram checks: ${plural(warnings, "warning")} in ${plural(diagrams, "diagram")}`;
  }
  const parts: string[] = [];
  if (unreadable > 0) parts.push(`${plural(unreadable, "file")} couldn't be read`);
  if (errors > 0) parts.push(plural(errors, "error"));
  if (warnings > 0) parts.push(plural(warnings, "warning"));
  return `Diagram checks: ${parts.join(", ")}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
