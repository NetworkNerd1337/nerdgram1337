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
  /** The preview could not be drawn, or the check reported a Mermaid syntax error. */
  parseError?: boolean;
  /**
   * The YAML header is malformed. This is an error even before a check has
   * run. A real Mermaid syntax failure (`parseError`) still wins.
   */
  frontMatterError?: boolean;
  /** 1-based file line of the broken settings block, when the parser has one. */
  frontMatterLine?: number | null;
};

function count(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** Hover text for a broken settings block. The line is included when the file has one. */
export function settingsErrorTitle(line?: number | null): string {
  const known = typeof line === "number" && Number.isFinite(line) && line > 0 ? Math.floor(line) : null;
  if (known == null) return "The settings block at the top of the file (front matter) has an error.";
  return `The settings block at the top of the file (front matter) has an error on line ${known}.`;
}

/**
 * Card and list chrome for one diagram. Errors, including a parse error, win
 * over warnings. Muted warnings add nothing. A clean diagram adds nothing.
 * Grid and list both call this so the words cannot drift.
 */
export function diagramCardHealth(input: DiagramCardHealthInput = {}): DiagramCardHealth {
  const errors = count(input.errors);
  const warnings = input.muted ? 0 : count(input.warnings);
  if (input.parseError) return { tone: "error", label: "Parse error", title: "Parse error" };
  // One settings-block error is named. Extra errors keep the count, so a
  // second problem is not hidden behind the header message.
  if (input.frontMatterError && errors <= 1) {
    const title = settingsErrorTitle(input.frontMatterLine);
    return { tone: "error", label: "Settings error", title };
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

/**
 * Grid and list share this so a broken header and a Mermaid failure use the
 * same words. `thumbnailFailed` is the card preview. `syntaxError` is the
 * workspace check's parse diagnostic, which the list has without a preview.
 */
export function diagramSurfaceHealth(input: {
  errors?: number;
  warnings?: number;
  muted?: boolean;
  malformed?: boolean;
  thumbnailFailed?: boolean;
  syntaxError?: boolean;
  frontMatterLine?: number | null;
} = {}): DiagramCardHealth {
  return diagramCardHealth({
    errors: input.errors,
    warnings: input.warnings,
    muted: input.muted,
    parseError: input.thumbnailFailed === true || input.syntaxError === true,
    frontMatterError: input.malformed === true,
    frontMatterLine: input.frontMatterLine,
  });
}

export function diagramHealthClass(health: DiagramCardHealth): string {
  if (health.tone === "error") return " is-health-error";
  if (health.tone === "warning") return " is-health-warning";
  return "";
}
