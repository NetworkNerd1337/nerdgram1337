import { useEffect, useState } from "react";
import { api } from "../api";
import { dismissDataFolder, isDataFolderDismissed, problemIssues, problemSignature } from "../lib/dataFolderNotice";
import type { DataDoctorReport, DataHealthIssue } from "../types";
import { CLOUD_SYNC_DOCS_LINK_TEXT, CLOUD_SYNC_DOCS_URL } from "../../../server/src/syncFolderHint.ts";
import { ClashList, QuarantineList } from "./DataFolderExtras";

function browserStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function DataIssueText({ issue }: { issue: DataHealthIssue }) {
  const urlAt = issue.message.indexOf(CLOUD_SYNC_DOCS_URL);
  if (urlAt < 0) {
    return (
      <>
        {issue.file ? <code>{issue.file}</code> : null} {issue.message}
      </>
    );
  }
  const before = issue.message.slice(0, urlAt).replace(new RegExp(`${CLOUD_SYNC_DOCS_LINK_TEXT}:\\s*$`), "");
  const after = issue.message.slice(urlAt + CLOUD_SYNC_DOCS_URL.length);
  return (
    <>
      {issue.file ? <code>{issue.file}</code> : null} {before}
      <a href={CLOUD_SYNC_DOCS_URL} target="_blank" rel="noopener noreferrer">
        {CLOUD_SYNC_DOCS_LINK_TEXT}
      </a>
      {after}
    </>
  );
}

export function DataFolderNotes({ notes }: { notes: readonly DataHealthIssue[] }) {
  if (notes.length === 0) return null;
  return (
    <section className="data-folder-notes" aria-label="Data folder notes">
      <h2>NerdGram checked the data folder. No action needed.</h2>
      <ul>
        {notes.map((issue) => (
          <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>
        ))}
      </ul>
    </section>
  );
}

export function DataHealthNotice({ report: given }: { report?: DataDoctorReport | null }) {
  const [fetched, setFetched] = useState<DataDoctorReport | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissedOverride, setDismissedOverride] = useState<string | null>(null);
  const report = given !== undefined ? given : fetched;
  useEffect(() => {
    if (given !== undefined) return;
    let cancelled = false;
    void api
      .doctor()
      .then((next) => {
        if (!cancelled) setFetched(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [given]);

  const problems = problemIssues(report?.issues ?? []);
  const signature = problemSignature(report?.issues ?? []);
  const store = browserStore();
  const hidden =
    signature.length > 0 && (dismissedOverride === signature || (store != null && isDataFolderDismissed(store, signature)));
  if (problems.length === 0 || hidden) return null;
  const count = problems.length;
  const files = [...new Set(problems.map((issue) => issue.file).filter((file): file is string => Boolean(file)))];
  return (
    <div className="data-health-banner" role="status">
      <p>
        NerdGram checked the data folder and found {count} {count === 1 ? "problem" : "problems"}. You need to do something.
      </p>
      <span className="data-health-banner-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          Details
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Dismiss"
          onClick={() => {
            const current = browserStore();
            if (current) dismissDataFolder(current, signature);
            setDismissedOverride(signature);
            setOpen(false);
          }}
        >
          ×
        </button>
      </span>
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <div
            className="modal data-health-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-health-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="data-health-title">NerdGram checked the data folder</h2>
            {files.length > 0 ? (
              <p>
                It found {count} {count === 1 ? "problem" : "problems"} in NerdGram's own settings/history files (not your diagrams):{" "}
                {files.map((file, index) => (
                  <span key={file}>
                    {index > 0 ? ", " : null}
                    <code>{file}</code>
                  </span>
                ))}
                . Your diagrams were not moved or changed. You need to do something for each item below.
              </p>
            ) : (
              <p>
                It found {count} {count === 1 ? "problem" : "problems"} in the data folder. Your diagrams were not moved or changed. You need to do
                something for each item below.
              </p>
            )}
            <ul>
              {problems.map((issue) => (
                <li key={`${issue.code}:${issue.file ?? ""}:${issue.message}`}>
                  <DataIssueText issue={issue} />
                </li>
              ))}
            </ul>
            <QuarantineList
              sets={report?.quarantineSets ?? []}
              onRestore={async (id) => {
                await api.restoreQuarantine(id);
                const next = await api.doctor();
                setFetched(next);
              }}
            />
            <ClashList clashes={report?.clashes ?? []} />
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
