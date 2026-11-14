import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { FileWriteResult, RevisionSummary } from "../types";
import { RevisionDiff } from "./RevisionDiff";

type HistoryDialogProps = {
  path: string;
  lockToken: string | null;
  canRestore: boolean;
  onClose: () => void;
  onRestored: (file: FileWriteResult & { content: string }) => void;
};

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function HistoryDialog({ path, lockToken, canRestore, onClose, onRestored }: HistoryDialogProps) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [retention, setRetention] = useState<number | null>(null);
  const [baselineCap, setBaselineCap] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<string | "current" | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [baselinePick, setBaselinePick] = useState("");
  const [compare, setCompare] = useState<{ from: string; to: string } | null>(null);

  const load = async () => {
    const data = await api.history(path);
    setRevisions(data.revisions);
    setRetention(data.retention);
    setBaselineCap(data.baselineCap);
    const named = data.revisions.find((revision) => revision.name);
    setBaselinePick((current) => current || named?.id || "");
    return data.revisions;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.history(path);
        if (cancelled) return;
        setRevisions(data.revisions);
        setRetention(data.retention);
        setBaselineCap(data.baselineCap);
        const named = data.revisions.find((revision) => revision.name);
        setBaselinePick(named?.id ?? "");
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load history");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const viewRevision = async (id: string) => {
    setSelected(id);
    setCompare(null);
    setError(null);
    try {
      const revision = await api.historyRevision(path, id);
      setPreview(revision.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that revision");
    }
  };

  const restore = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const file = await api.restoreRevision(path, id, lockToken);
      onRestored(file);
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not restore that revision";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const startName = (revision: RevisionSummary | "current") => {
    if (revision === "current") {
      setNaming("current");
      setName("");
      setNote("");
      return;
    }
    setNaming(revision.id);
    setName(revision.name ?? "");
    setNote(revision.note ?? "");
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A baseline needs a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (naming === "current") {
        await api.saveBaseline({ path, name: trimmed, note });
      } else if (naming) {
        const existing = revisions.find((revision) => revision.id === naming);
        if (existing?.name) await api.updateBaseline({ path, id: naming, name: trimmed, note });
        else await api.saveBaseline({ path, id: naming, name: trimmed, note });
      }
      setNaming(null);
      const next = await load();
      const named = next.find((revision) => revision.name === trimmed);
      if (named) setBaselinePick(named.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that baseline");
    } finally {
      setBusy(false);
    }
  };

  const removeName = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.removeBaseline(path, id);
      if (result.pruned) {
        setError("The name was removed. That revision was also dropped because only the last 20 unnamed revisions are kept.");
      }
      await load();
      if (selected === id) {
        setSelected(null);
        setPreview("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove that baseline");
    } finally {
      setBusy(false);
    }
  };

  const named = revisions.filter((revision) => revision.name);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`modal wide${compare ? " diff-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="history-title">Version history</h3>
        <p>
          Each save keeps the previous contents. The last {retention ?? 20} unnamed revisions are kept.
          Named baselines are kept as well, up to {baselineCap ?? 20} per diagram, and are not dropped by that
          limit. Restoring saves the current text as a revision first.
        </p>
        {error && <div className="error-banner">{error}</div>}
        {compare ? (
          <RevisionDiff
            path={path}
            revisions={revisions}
            initialFrom={compare.from}
            initialTo={compare.to}
            onClose={() => setCompare(null)}
          />
        ) : (
          <>
            <div className="history-baseline">
              <button type="button" className="btn btn-ghost" onClick={() => startName("current")}>
                Save baseline
              </button>
              {named.length > 0 && (
                <>
                  <label>
                    Compare with baseline
                    <select value={baselinePick} onChange={(event) => setBaselinePick(event.target.value)}>
                      {named.map((revision) => (
                        <option key={revision.id} value={revision.id}>
                          {revision.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!baselinePick}
                    onClick={() => setCompare({ from: baselinePick, to: "current" })}
                  >
                    Compare
                  </button>
                </>
              )}
            </div>
            {naming && (
              <form
                className="baseline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveName();
                }}
              >
                <label>
                  Name
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
                </label>
                <label>
                  Note
                  <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
                </label>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Save baseline
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setNaming(null)}>
                  Cancel
                </button>
              </form>
            )}
            {revisions.length === 0 ? (
              <div className="empty-state">No earlier versions yet. Save baseline keeps the current diagram.</div>
            ) : (
              <ul className="history-list">
                {revisions.map((revision) => (
                  <li key={revision.id} className="history-item">
                    <div>
                      <strong>{revision.name || formatStamp(revision.createdAt)}</strong>
                      <div className="history-meta">
                        {revision.name ? `${formatStamp(revision.createdAt)} · ` : ""}
                        {revision.size} bytes
                        {revision.note ? ` · ${revision.note}` : ""}
                      </div>
                    </div>
                    <div className="history-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => void viewRevision(revision.id)}>
                        View
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setCompare({ from: revision.id, to: "current" })}
                      >
                        Compare
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => startName(revision)}>
                        {revision.name ? "Rename" : "Name"}
                      </button>
                      {revision.name ? (
                        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void removeName(revision.id)}>
                          Remove name
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!canRestore || busy}
                        onClick={() => void restore(revision.id)}
                      >
                        Restore
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {selected && (
              <pre className="history-preview" aria-label="Revision preview">
                {preview}
              </pre>
            )}
            {!canRestore && revisions.length > 0 && (
              <p>This diagram is read-only in this window, so restore is unavailable.</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
