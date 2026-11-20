/**
 * One location prefix for a problem row, and the same Settings error words
 * on every surface. The parser's own sentence stays in the tooltip.
 */

const LEADING_LOCATION = /^line\s+\d+(?:,\s*column\s+\d+)?\s*:\s*/i;

export type ProblemView = {
  /** "Line N, column M:" — shown once. */
  where: string;
  message: string;
  /** Technical detail. Empty when the visible message is already the whole sentence. */
  title: string;
};

export function problemWhere(line: number, column?: number | null): string {
  const safeLine = Number.isFinite(line) && line > 0 ? Math.floor(line) : 1;
  const safeColumn = typeof column === "number" && Number.isFinite(column) && column > 0 ? Math.floor(column) : 1;
  return `Line ${safeLine}, column ${safeColumn}`;
}

/** Column from a YAML message such as "(2:1)", when the parser included one. */
export function columnHint(message: string | null | undefined): number | null {
  const match = /\((\d+):(\d+)\)/.exec(message ?? "");
  if (!match) return null;
  const column = Number(match[2]);
  return Number.isFinite(column) && column > 0 ? column : null;
}

export function settingsBlockTooltip(
  line?: number | null,
  column?: number | null,
  parserMessage?: string | null,
): string {
  const knownLine = typeof line === "number" && Number.isFinite(line) && line > 0 ? Math.floor(line) : null;
  const hinted = columnHint(parserMessage);
  const knownColumn =
    typeof column === "number" && Number.isFinite(column) && column > 0 ? Math.floor(column) : hinted;
  const where = knownLine ? problemWhere(knownLine, knownColumn) : null;
  const parser = cleanParserMessage(parserMessage);
  const place = where ? ` at ${where}` : "";
  const detail = parser ? ` ${parser}` : "";
  return `The settings block at the top of the file (front matter) has an error${place}.${detail}`.trim();
}

export function formatProblem(item: {
  ruleId?: string;
  severity?: string;
  message: string;
  line: number;
  column?: number | null;
}): ProblemView {
  const where = `${problemWhere(item.line, item.column)}:`;
  if (item.ruleId === "front-matter" && item.severity === "error") {
    return {
      where,
      message: "Settings error",
      title: settingsBlockTooltip(item.line, item.column, item.message),
    };
  }
  const message = item.message.replace(LEADING_LOCATION, "").trim() || item.message;
  return { where, message, title: "" };
}

function cleanParserMessage(message: string | null | undefined): string {
  if (!message) return "";
  return message
    .replace(/^The YAML header could not be parsed\.?\s*/i, "")
    .replace(/^The YAML front matter could not be parsed\.?\s*/i, "")
    .replace(LEADING_LOCATION, "")
    .trim();
}
