import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  DIAGRAM_CHECKS_EXPLAINER,
  diagramCheckStatus,
  diagramCheckSummary,
  findingsFromLint,
  groupDiagramChecks,
  readDiagramChecksOpen,
  writeDiagramChecksOpen,
  type DiagramCheckFinding,
  type DiagramCheckSeverity,
  type DiagramCheckStatus,
} from "../lib/diagramChecks";
import { editorHref } from "../lib/diagramSearch";
import { RepairLinksDialog } from "./RepairLinksDialog";

/**
 * Dashboard fold-out for workspace diagram checks.
 * The check runs once when this mounts. Open or closed is remembered in this browser.
 */
export function DiagramChecks() {
  const [open, setOpen] = useState(() => readDiagramChecksOpen());
  const [findings, setFindings] = useState<DiagramCheckFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api.diagramLint().then(
      (result) => {
        if (cancelled) return;
        setFindings(findingsFromLint(result));
      },
      (err: unknown) => {
        if (cancelled) return;
        setFindings(null);
        setError(err instanceof Error ? err.message : "Could not check the diagrams");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const status = diagramCheckStatus(findings, error != null);
  const summary = diagramCheckSummary(status, findings);
  const groups = findings ? groupDiagramChecks(findings) : [];
  const canRepair = findings?.some((item) => item.ruleId === "broken-click") ?? false;

  return (
    <details
      className={`diagram-checks is-${status}`}
      data-status={status}
      open={open}
      onToggle={(event) => {
        if (!event.currentTarget.isConnected) return;
        const next = event.currentTarget.open;
        setOpen(next);
        writeDiagramChecksOpen(next);
      }}
    >
      <summary>
        <Chevron open={open} />
        {status === "loading" || status === "failed" ? null : <StatusMark status={status} />}
        <span className="diagram-checks-label">{summary}</span>
      </summary>
      <div className="diagram-checks-body">
        <p className="diagram-checks-explainer">{DIAGRAM_CHECKS_EXPLAINER}</p>
        {error ? <p className="diagram-checks-error">{error}</p> : null}
        {canRepair ? (
          <button type="button" className="btn btn-ghost diagram-checks-repair" onClick={() => setRepairOpen(true)}>
            Repair links
          </button>
        ) : null}
        {groups.length > 0 ? (
          <div className="diagram-checks-groups">
            {groups.map((group, groupIndex) => {
              const headingId = `diagram-checks-group-${groupIndex}`;
              return (
                <section key={group.path} className="diagram-checks-group" aria-labelledby={headingId}>
                  <h3 id={headingId} className="diagram-checks-path">
                    {group.path}
                  </h3>
                  <ul>
                    {group.findings.map((item, index) => (
                      <li key={`${item.ruleId}-${item.line}-${index}`}>
                        <Link className="diagram-checks-finding" to={editorHref(item.path, item.line, "")}>
                          <span className={`diagram-checks-severity ${item.severity}`}>
                            <SeverityGlyph severity={item.severity} />
                            {item.severity === "error" ? "Error" : "Warning"}
                          </span>
                          <span className="diagram-checks-line">Line {item.line}</span>
                          <span className="diagram-checks-message">{item.message}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>
      {repairOpen ? (
        <RepairLinksDialog
          onClose={() => setRepairOpen(false)}
          onApplied={() => {
            setRepairOpen(false);
            setFindings(null);
            setError(null);
            setReloadToken((value) => value + 1);
          }}
        />
      ) : null}
    </details>
  );
}

/** Closed points right. Open points down. */
const CHEVRON_RIGHT = "M6 3.5 10.5 8 6 12.5";
const CHEVRON_DOWN = "M3.5 6 8 10.5 12.5 6";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="diagram-checks-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={open ? CHEVRON_DOWN : CHEVRON_RIGHT}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusMark({ status }: { status: Exclude<DiagramCheckStatus, "loading" | "failed"> }) {
  if (status === "warning") return <SeverityGlyph severity="warning" className="diagram-checks-mark" />;
  if (status === "error") return <SeverityGlyph severity="error" className="diagram-checks-mark" />;
  return (
    <svg className="diagram-checks-mark" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 8.2 7.1 10.3 11 6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SeverityGlyph({ severity, className }: { severity: DiagramCheckSeverity; className?: string }) {
  if (severity === "warning") {
    return (
      <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 2.15 14.35 13.35H1.65L8 2.15Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M8 6.15v3.15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.25" r="0.75" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.6 5.6 10.4 10.4M10.4 5.6 5.6 10.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
