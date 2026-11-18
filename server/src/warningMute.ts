import { matchFrontMatter } from "./frontMatter.js";

/**
 * Per-diagram mute for diagram-check warnings.
 * The line is a Mermaid comment, so the renderer ignores it.
 * Put it near the top of the file, after YAML front matter when the file has that block.
 *
 *     %% nerdgram: warnings=muted
 *
 * Remove the line to unmute. Errors are never muted.
 */
export const WARNINGS_MUTED_LINE = "%% nerdgram: warnings=muted";

const DIRECTIVE = /^[ \t]*%%[ \t]*nerdgram:[ \t]*warnings[ \t]*=[ \t]*muted[ \t]*$/;

export function warningsMuted(source: string): boolean {
  return splitSource(source).lines.some((line) => DIRECTIVE.test(line));
}

export function omitMutedWarnings<T extends { severity: string }>(source: string, diagnostics: readonly T[]): T[] {
  if (!warningsMuted(source)) return [...diagnostics];
  return diagnostics.filter((item) => item.severity !== "warning");
}

/** Add or remove the mute directive. A second call with the same state returns the same text. */
export function setWarningsMuted(source: string, muted: boolean): string {
  if (muted === warningsMuted(source)) return source;
  const { lines, ending, trailing } = splitSource(source);
  const stripped = lines.filter((line) => !DIRECTIVE.test(line));
  if (!muted) return joinSource(stripped, ending, trailing);
  const at = directiveIndex(stripped);
  stripped.splice(at, 0, WARNINGS_MUTED_LINE);
  return joinSource(stripped, ending, trailing);
}

function directiveIndex(lines: string[]): number {
  if (lines.length === 0) return 0;
  const text = `${lines.join("\n")}\n`;
  const match = matchFrontMatter(text);
  if (!match) return 0;
  const prefix = text.slice(0, match.length);
  const consumed = prefix.endsWith("\n") ? prefix.split("\n").length - 1 : prefix.split("\n").length;
  if (!Number.isFinite(consumed) || consumed < 0) return 0;
  return Math.min(consumed, lines.length);
}

function splitSource(source: string): { lines: string[]; ending: "\n" | "\r\n"; trailing: boolean } {
  const ending = source.includes("\r\n") ? "\r\n" : "\n";
  const trailing = source.endsWith("\n");
  if (source.length === 0) return { lines: [], ending, trailing: false };
  const parts = source.split(/\r?\n/);
  if (trailing) parts.pop();
  return { lines: parts, ending, trailing };
}

function joinSource(lines: string[], ending: "\n" | "\r\n", trailing: boolean): string {
  if (lines.length === 0) return "";
  return lines.join(ending) + (trailing ? ending : "");
}
