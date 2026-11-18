import type { LintFix } from "../../../server/src/diagramLint.ts";
import type { ReportedDiagnostic } from "../lib/mermaidLint";

type ProblemsPanelProps = {
  diagnostics: readonly ReportedDiagnostic[];
  pending?: boolean;
  readOnly?: boolean;
  warningsMuted?: boolean;
  onToggleWarnings?: () => void;
  onSelect: (diagnostic: ReportedDiagnostic) => void;
  onFix: (fix: LintFix) => void;
};

export function ProblemsPanel({
  diagnostics,
  pending = false,
  readOnly = false,
  warningsMuted = false,
  onToggleWarnings,
  onSelect,
  onFix,
}: ProblemsPanelProps) {
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const summary = pending
      ? "Checking…"
      : warningsMuted && errors === 0 && warnings === 0
        ? "Warnings muted"
        : diagnostics.length === 0
      ? "No problems"
      : [
          errors ? `${errors} error${errors === 1 ? "" : "s"}` : "",
          warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(", ");
  const showToggle = Boolean(onToggleWarnings) && (warningsMuted || warnings > 0);

  return (
    <section className="problems-panel" aria-label="Problems">
      <h3>{summary}</h3>
      {showToggle ? (
        <p className="problems-muted">
          {warningsMuted && errors > 0 ? <span>Warnings muted</span> : null}
          <button type="button" onClick={onToggleWarnings} disabled={readOnly}>
            {warningsMuted ? "Unmute" : "Mute warnings"}
          </button>
        </p>
      ) : null}
      {diagnostics.length > 0 ? (
        <ul>
          {diagnostics.map((item, index) => (
            <li key={`${item.ruleId}-${item.from}-${index}`}>
              <button type="button" className={`problem ${item.severity}`} onClick={() => onSelect(item)}>
                <span className="problem-kind">{item.severity === "error" ? "Error" : "Warning"}</span>
                <span className="problem-where">
                  Line {item.line}
                  {item.column > 1 ? `, column ${item.column}` : ""}
                </span>
                <span className="problem-message">{messageWithoutLocation(item)}</span>
              </button>
              {item.fixes.length > 0 ? (
                <span className="problem-fixes">
                  {item.fixes.map((fix) => (
                    <button
                      key={`${fix.id}-${fix.title}`}
                      type="button"
                      disabled={readOnly && (fix.edits.length > 0 || fix.id === "repair-links")}
                      onClick={() => onFix(fix)}
                    >
                      {fix.title}
                    </button>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : pending ? (
        <p>Looking through the diagram.</p>
      ) : warningsMuted ? null : (
        <p>Nothing to fix in this diagram.</p>
      )}
    </section>
  );
}

function messageWithoutLocation(item: ReportedDiagnostic): string {
  const prefix = item.column > 1 ? `Line ${item.line}, column ${item.column}: ` : `Line ${item.line}: `;
  if (!item.message.startsWith(prefix)) return item.message;
  const rest = item.message.slice(prefix.length);
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : item.message;
}
