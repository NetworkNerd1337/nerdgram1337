import { useEffect, useState } from "react";
import { api } from "../api";
import type { DataDoctorReport } from "../types";

export function DataHealthNotice({ report: given }: { report?: DataDoctorReport | null }) {
  const [report, setReport] = useState<DataDoctorReport | null>(given ?? null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (given) return;
    let cancelled = false;
    void api
      .doctor()
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [given]);

  const issues = report?.issues ?? [];
  if (issues.length === 0) return null;
  const count = issues.length;
  return (
    <div className="data-health-banner" role="status">
      <p>
        NerdGram found {count} {count === 1 ? "problem" : "problems"} with its data folder.
      </p>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Details
      </button>
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <div
            className="modal data-health-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-health-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="data-health-title">Data folder</h2>
            <p>These files are app state. Diagrams were not moved or changed.</p>
            <ul>
              {issues.map((issue) => (
                <li key={`${issue.code}:${issue.file ?? ""}:${issue.message}`}>
                  {issue.file ? <code>{issue.file}</code> : null} {issue.message}
                </li>
              ))}
            </ul>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
