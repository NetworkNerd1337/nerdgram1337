import { useEffect, useState } from "react";
import { api } from "../api";
import type { DataDoctorReport } from "../types";
import { ClashList, QuarantineList } from "./DataFolderExtras";
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

  const count = report?.issues.length ?? 0;
  const summary = !report ? "Checking the data folder." : count === 0 ? "No problems found." : `${count} ${count === 1 ? "problem" : "problems"} found.`;
  return (
    <SettingsCard id="data-folder" title="Data folder" summary={summary}>
      {error ? <p>{error}</p> : null}
      {report ? (
        <>
          <p>
            Status: {report.status}. Writable: {report.writable ? "yes" : "no"}.
            {report.syncFolder ? " This folder looks synced or shared." : ""} Quarantined sets: {report.quarantined}.
          </p>
          {count === 0 ? <p>NerdGram did not find a problem with its data folder.</p> : null}
          {count > 0 ? (
            <ul>
              {report.issues.map((issue) => (
                <li key={`${issue.code}:${issue.file ?? ""}:${issue.message}`}>
                  {issue.file ? <code>{issue.file}</code> : null} {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
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
