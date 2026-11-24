import { useEffect, useState } from "react";
import { api } from "../api";
import type { DataDoctorReport } from "../types";
import { infoIssues, problemIssues } from "../lib/dataFolderNotice";
import { ClashList, QuarantineList } from "./DataFolderExtras";
import { DataFolderNotes, DataIssueText } from "./DataHealthNotice";
import { SettingsCard } from "./SettingsCard";

export function DataFolderSettings() {
  const [report, setReport] = useState<DataDoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .doctor()
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "The data folder report could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const problems = problemIssues(report?.issues ?? []);
  const notes = infoIssues(report?.issues ?? []);
  const count = problems.length;
  const summary = !report
    ? "NerdGram is checking the data folder."
    : count === 0
      ? "NerdGram checked the data folder. No problems found. No action needed."
      : `NerdGram checked the data folder and found ${count} ${count === 1 ? "problem" : "problems"}. You need to do something.`;
  return (
    <SettingsCard id="data-folder" title="Data folder" summary={summary}>
      {error ? <p>{error}</p> : null}
      {report ? (
        <>
          <p>
            NerdGram checked the data folder. {report.writable ? "It can save." : "It cannot save."}
            {report.syncFolder ? " This folder looks synced or shared." : ""} Copies set aside: {report.quarantined}.
          </p>
          {count > 0 ? (
            <ul>
              {problems.map((issue) => (
                <li key={`${issue.code}:${issue.file ?? ""}:${issue.message}`}>
                  <DataIssueText issue={issue} />
                </li>
              ))}
            </ul>
          ) : null}
          <DataFolderNotes notes={notes} />
          <QuarantineList
            sets={report.quarantineSets ?? []}
            onRestore={async (id) => {
              await api.restoreQuarantine(id);
              setReport(await api.doctor());
            }}
          />
          <ClashList clashes={report.clashes ?? []} />
        </>
      ) : null}
    </SettingsCard>
  );
}
