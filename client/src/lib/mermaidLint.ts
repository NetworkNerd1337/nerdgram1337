import type { Action, Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import {
  lintDiagram,
  mergeAstFacts,
  type LintDiagnostic,
  type LintFix,
  type LintOptions,
} from "../../../server/src/diagramLint.ts";
import { applyLintFix } from "./lintActions";
import { readAstFacts } from "./mermaidFacts";
import { inspectMermaid } from "./mermaidRender";
import { isMermaidEnvironmentError, locateParseError, settingsBlockHidesSyntaxError } from "./parseError";
import { omitMutedWarnings } from "../../../server/src/warningMute.ts";

export const LINT_DELAY_MS = 400;

export type ReportedDiagnostic = LintDiagnostic | ParseDiagnostic;

export type ParseDiagnostic = {
  ruleId: "parse";
  severity: "error";
  message: string;
  from: number;
  to: number;
  line: number;
  column: number;
  fixes: [];
};

/**
 * Syntax errors come from Mermaid's parser. The other checks are the shared
 * rules, confirmed against Mermaid's diagram database when that parse succeeds.
 */
export async function lintMermaidDoc(code: string, options: LintOptions = {}): Promise<ReportedDiagnostic[]> {
  if (!code.trim()) return [];
  const text = lintDiagram(code, options);
  const inspected = await inspectMermaid(code);
  if (!inspected.ok) {
    if (isMermaidEnvironmentError(inspected.error) || settingsBlockHidesSyntaxError(code)) {
      return omitMutedWarnings(code, text);
    }
    const located = locateParseError(inspected.error, code);
    const parseError: ParseDiagnostic = {
      ruleId: "parse",
      severity: "error",
      message: located.message,
      from: located.from,
      to: located.to,
      line: located.line,
      column: located.column,
      fixes: [],
    };
    return omitMutedWarnings(code, [parseError, ...text]);
  }
  const facts = readAstFacts(inspected.diagram);
  const merged = facts ? mergeAstFacts(code, text, facts, options) : text;
  return omitMutedWarnings(code, merged);
}

export function toCodeMirrorDiagnostics(items: readonly ReportedDiagnostic[]): Diagnostic[] {
  return items.map((item) => ({
    from: item.from,
    to: Math.max(item.to, item.from + 1),
    severity: item.severity,
    message: item.message,
    actions: item.fixes.map((fix) => codeMirrorAction(fix)),
  }));
}

function codeMirrorAction(fix: LintFix): Action {
  return {
    name: fix.title,
    apply(view: EditorView) {
      if (fix.id === "repair-links") {
        window.dispatchEvent(new CustomEvent("nerdgram:repair-links"));
        return;
      }
      applyLintFix(view, fix);
    },
  };
}
