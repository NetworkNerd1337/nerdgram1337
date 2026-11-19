export type DiagramCardTone = "error" | "warning" | "none";

export type DiagramCardHealth = {
  tone: DiagramCardTone;
  label: string | null;
  title: string | null;
};

export type DiagramCardHealthInput = {
  /** Error-level problems from the workspace check summary. */
  errors?: number;
  /**
   * Unmuted warnings from that same summary. Muted warnings are already left
   * out of the summary. Pass `muted` when the count still includes them.
   */
  warnings?: number;
  muted?: boolean;
  /** The preview could not be drawn. That is an error, even before a check has run. */
  parseError?: boolean;
  /**
   * The YAML header is malformed. This is an error even before a check has
   * run. A real Mermaid syntax failure (`parseError`) still wins.
   */
  frontMatterError?: boolean;
};

function count(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Card chrome for one diagram. Errors, including a parse error, win over
 * warnings. Muted warnings add nothing. A clean diagram adds nothing.
 */
export function diagramCardHealth(input: DiagramCardHealthInput = {}): DiagramCardHealth {
  const errors = count(input.errors);
  const warnings = input.muted ? 0 : count(input.warnings);
  if (input.parseError) return { tone: "error", label: "Parse error", title: "Parse error" };
  // One front-matter error is named. Extra errors keep the count, so a
  // second problem is not hidden behind the header message.
  if (input.frontMatterError && errors <= 1) {
    return { tone: "error", label: "Front matter error", title: "Front matter error" };
  }
  if (errors > 0) {
    const label = errors === 1 ? "1 error" : `${errors} errors`;
    return { tone: "error", label, title: label };
  }
  if (warnings > 0) {
    const label = warnings === 1 ? "1 warning" : `${warnings} warnings`;
    return { tone: "warning", label, title: label };
  }
  return { tone: "none", label: null, title: null };
}

/** Grid and list share this so a broken header and a Mermaid failure use the same words. */
export function diagramSurfaceHealth(input: {
  errors?: number;
  warnings?: number;
  malformed?: boolean;
  thumbnailFailed?: boolean;
} = {}): DiagramCardHealth {
  return diagramCardHealth({
    errors: input.errors,
    warnings: input.warnings,
    parseError: input.thumbnailFailed === true,
    frontMatterError: input.malformed === true,
  });
}

export function diagramHealthClass(health: DiagramCardHealth): string {
  if (health.tone === "error") return " is-health-error";
  if (health.tone === "warning") return " is-health-warning";
  return "";
}
