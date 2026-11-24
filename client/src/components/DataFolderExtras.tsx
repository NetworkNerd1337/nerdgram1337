import { useState } from "react";
import { api } from "../api";
import type { DataDoctorReport, NameClash, QuarantineSet } from "../types";

export function UpgradeBlockers({ report }: { report: DataDoctorReport | null }) {
  if (!report) return <p>Checking the data folder before the upgrade.</p>;
  if (report.blockers.length === 0) return <p>The data folder check found no upgrade blockers.</p>;
  return (
    <div className="upgrade-blockers">
      <p>Fix these before you upgrade:</p>
      <ul>
        {report.blockers.map((blocker) => (
          <li key={blocker.code}>{blocker.message}</li>
        ))}
      </ul>
    </div>
  );
}

export function QuarantineList({
  sets,
  onRestore,
}: {
  sets: QuarantineSet[];
  onRestore: (id: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (sets.length === 0) return null;
  return (
    <div>
      <h3>Quarantine</h3>
      <p>The 10 most recent copies are kept. Restore puts that file back. Diagrams are not changed.</p>
      {error ? <p>{error}</p> : null}
      <ul>
        {sets.map((set) => (
          <li key={set.id}>
            <code>{set.file || set.id}</code> {set.reason}
            <div>
              <code>{set.path}</code>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending === set.id}
              onClick={() => {
                setPending(set.id);
                setError(null);
                void onRestore(set.id)
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "The copy could not be restored."))
                  .finally(() => setPending(null));
              }}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClashList({ clashes }: { clashes: NameClash[] }) {
  const [open, setOpen] = useState<NameClash | null>(null);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (clashes.length === 0) return null;

  async function compare(clash: NameClash) {
    setOpen(clash);
    setError(null);
    setLeft("");
    setRight("");
    try {
      const first = await api.readFile(clash.paths[0] ?? "");
      setLeft(first.content);
      if (clash.paths[1]) {
        const second = await api.readFile(clash.paths[1]);
        setRight(second.content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The diagrams could not be read.");
    }
  }

  return (
    <div>
      <h3>Names that collide</h3>
      <p>Both copies stay on disk. Nothing is deleted.</p>
      <ul>
        {clashes.map((clash) => (
          <li key={`${clash.kind}:${clash.paths.join("|")}`}>
            {clash.kind === "case" ? "Case" : "Conflict copy"}: {clash.paths.join(" and ")}{" "}
            <button type="button" className="btn btn-ghost" onClick={() => void compare(clash)}>
              Compare
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <div className="compare-grid">
          <div>
            <strong>{open.paths[0]}</strong>
            <pre>{left || " "}</pre>
          </div>
          <div>
            <strong>{open.paths[1] ?? "No second file"}</strong>
            <pre>{right || " "}</pre>
          </div>
          {error ? <p>{error}</p> : null}
          <button type="button" className="btn" onClick={() => setOpen(null)}>
            Keep both
          </button>
        </div>
      ) : null}
    </div>
  );
}
