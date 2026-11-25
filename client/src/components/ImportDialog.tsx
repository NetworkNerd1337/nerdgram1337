import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { ImportCollisionChoice, ImportDraft, ImportHubLayout, ImportUnit } from "../lib/importDrafts";
import {
  FOREIGN_IMPORT_MAX_BYTES,
  importChoiceCollides,
  importSavePath,
  MAX_IMPORT_FILE_CHARS,
  MAX_IMPORT_FILES,
  unitsFromDraft,
} from "../lib/importDrafts";
import { largeImportAdvice } from "../lib/largeImport";
import { parseMermaid } from "../lib/mermaidRender";
import { IMPORT_DATA_KEY, IMPORT_PRESET_KEY, SUPPORTED_IMPORT_LINE } from "../lib/importRecognize";
import { collectPaths, explainOrganizeError, nextAvailablePath } from "../lib/organize";
import { displayName, joinPath } from "../lib/paths";
import type { ImportFileResult, TreeNode } from "../types";
import { FolderPicker } from "./FolderPicker";

type ImportDialogProps = {
  tree: TreeNode[];
  folder: string;
  drafts: ImportDraft[];
  onFolderChange: (folder: string) => void;
  onClose: () => void;
  onDone: (message: string, close: boolean) => void;
};

type Planned = {
  unit: ImportUnit | null;
  draft: ImportDraft;
  path: string;
  conflict: boolean;
  suggested: string | null;
};

function planImports(
  folder: string,
  drafts: ImportDraft[],
  taken: Set<string>,
  choices: Record<string, ImportCollisionChoice | "">,
): Planned[] {
  const reserved = new Set<string>();
  const planned: Planned[] = [];
  for (const draft of drafts) {
    const units = unitsFromDraft(draft);
    if (units.length === 0) {
      planned.push({ unit: null, draft, path: "", conflict: false, suggested: null });
      continue;
    }
    for (const unit of units) {
      const path = joinPath(folder, unit.diagramName);
      const isTaken = (candidate: string) => taken.has(candidate) || reserved.has(candidate);
      const conflict = isTaken(path);
      const choice = choices[unit.id];
      if (!conflict) {
        reserved.add(path);
        planned.push({ unit, draft, path, conflict, suggested: null });
        continue;
      }
      const suggested = nextAvailablePath(path, isTaken);
      if (choice === "rename" && suggested) reserved.add(suggested);
      if (choice === "replace") reserved.add(path);
      planned.push({ unit, draft, path, conflict, suggested });
    }
  }
  return planned;
}

export function ImportDialog({
  tree,
  folder,
  drafts,
  onFolderChange,
  onClose,
  onDone,
}: ImportDialogProps) {
  const [rows, setRows] = useState(drafts);
  const [choices, setChoices] = useState<Record<string, ImportCollisionChoice | "">>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = useMemo(() => collectPaths(tree), [tree]);
  const planned = useMemo(
    () => planImports(folder, rows, taken, choices),
    [folder, rows, taken, choices],
  );
  const parseKey = useMemo(
    () => planned.map((item) => `${item.unit?.id ?? item.draft.id}\n${item.unit?.text ?? ""}`).join("\n---\n"),
    [planned],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const item of planned) {
        if (!item.unit) continue;
        if (!item.unit.text.trim()) {
          next[item.unit.id] = "This file is empty. You can still import it and edit it later.";
          continue;
        }
        try {
          await parseMermaid(item.unit.text);
        } catch {
          next[item.unit.id] = "This may not render until you fix it in the editor. You can still import it.";
        }
      }
      if (!cancelled) setWarnings(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [parseKey, planned]);

  const pendingChoice = planned.some((item) => item.conflict && item.unit && !choices[item.unit.id]);
  const sendable = planned.filter((item) => item.unit);
  const tooMany = sendable.length > MAX_IMPORT_FILES;

  const setAll = (choice: ImportCollisionChoice) => {
    setChoices((current) => {
      const next = { ...current };
      for (const item of planned) {
        if (item.conflict && item.unit) next[item.unit.id] = choice;
      }
      return next;
    });
  };

  const submit = async () => {
    if (pendingChoice || sendable.length === 0 || tooMany) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importFiles(
        folder,
        sendable.map((item) => ({
          name: item.unit?.diagramName || item.draft.sourceName,
          text: item.unit?.text || "",
          onCollision: item.conflict && item.unit ? (choices[item.unit.id] as ImportCollisionChoice) : undefined,
        })),
      );
      const failed = result.results.filter(
        (item) => item.status === "error" || item.status === "collision",
      );
      if (failed.length > 0) {
        const failedIds = new Set<string>();
        sendable.forEach((entry, index) => {
          const status = result.results[index]?.status;
          if (status === "error" || status === "collision" || !status) failedIds.add(entry.draft.id);
        });
        setRows((current) => current.filter((draft) => draft.error || failedIds.has(draft.id)));
        setError(failed.map((item) => `${item.name}: ${item.error || "Could not import."}`).join(" "));
        onDone(summarize(result.results), false);
        return;
      }
      onDone(summarize(result.results), true);
    } catch (err) {
      setError(explainOrganizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <form
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <h3 id="import-dialog-title">Import diagrams</h3>
        <div className="modal-scroll">
        <p>
          {SUPPORTED_IMPORT_LINE} Lucid and Visio files are up to {FOREIGN_IMPORT_MAX_BYTES / (1024 * 1024)} MiB.
          Mermaid files are up to {MAX_IMPORT_FILE_CHARS / 1024} KB. Mermaid is copied into the folder you
          pick. A name that is already there is never replaced unless you choose Replace.
        </p>
        <FolderPicker tree={tree} value={folder} onChange={onFolderChange} />
        <div className="import-list">
          {planned.map((item) => (
            <div key={item.unit?.id ?? item.draft.id} className="import-row">
              <strong>{item.unit?.sourceName ?? item.draft.sourceName}</strong>
              {item.draft.formatLabel ? <p className="import-meta">Recognized as {item.draft.formatLabel}.</p> : null}
              {planned.find((row) => row.draft.id === item.draft.id) === item && item.draft.pages && item.draft.pages.length > 1 ? (
                <label>
                  Page
                  <select
                    aria-label={`Page for ${item.draft.sourceName}`}
                    value={item.draft.pageChoice ?? "all"}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((draft) =>
                          draft.id === item.draft.id ? { ...draft, pageChoice: event.target.value } : draft,
                        ),
                      )
                    }
                  >
                    <option value="all">Each page as its own diagram</option>
                    {item.draft.pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {planned.find((row) => row.draft.id === item.draft.id) === item ? (
                <HubChoice
                  name={`import-hub-${item.draft.id}`}
                  text={(planned.find((row) => row.draft.id === item.draft.id && row.unit && largeImportAdvice(row.unit.text, row.unit.nodes)) ?? item).unit?.text ?? ""}
                  nodes={(planned.find((row) => row.draft.id === item.draft.id && row.unit && largeImportAdvice(row.unit.text, row.unit.nodes)) ?? item).unit?.nodes ?? 0}
                  value={item.draft.hubLayout ?? ""}
                  onChange={(hubLayout) =>
                    setRows((current) => current.map((draft) => (draft.id === item.draft.id ? { ...draft, hubLayout } : draft)))
                  }
                />
              ) : null}
              {item.unit?.warnings.map((warning) => (
                <p key={warning} className="import-warning">
                  {warning}
                </p>
              ))}
              {item.draft.error ? (
                <p className="import-error">
                  {item.draft.error}{" "}
                  {item.draft.suggestFromData ? <Link to="/generate">From data</Link> : null}
                </p>
              ) : null}
              {item.draft.route === "from-data" ? (
                <p>
                  <Link
                    to="/generate"
                    onClick={() => {
                      sessionStorage.setItem(
                        IMPORT_DATA_KEY,
                        JSON.stringify({
                          text: item.draft.text,
                          fileName: item.draft.sourceName,
                          format: item.draft.dataFormat || "auto",
                        }),
                      );
                    }}
                  >
                    Open in From data
                  </Link>
                </p>
              ) : null}
              {item.draft.route === "style-presets" ? (
                <p>
                  <Link
                    to="/settings#style-presets"
                    onClick={() => {
                      sessionStorage.setItem(IMPORT_PRESET_KEY, item.draft.text);
                    }}
                  >
                    Open in Style presets
                  </Link>
                </p>
              ) : null}
              {!item.draft.error && item.path ? (
                <p className="import-meta">
                  Saves as{" "}
                  {importSavePath(item.path, item.unit ? choices[item.unit.id] : "", item.suggested)}
                </p>
              ) : null}
              {item.unit && warnings[item.unit.id] ? <p className="import-warning">{warnings[item.unit.id]}</p> : null}
              {item.conflict && item.unit ? (
                <label>
                  {importChoiceCollides(item.conflict, choices[item.unit.id], item.suggested) ? (
                    <span>This name is taken</span>
                  ) : (
                    <span className="sr-only">Name already in this folder</span>
                  )}
                  <select
                    aria-label={`What to do with ${item.unit.sourceName}`}
                    value={choices[item.unit.id] ?? ""}
                    onChange={(event) =>
                      setChoices((current) => ({
                        ...current,
                        [item.unit?.id ?? ""]: event.target.value as ImportCollisionChoice | "",
                      }))
                    }
                  >
                    <option value="">Choose…</option>
                    <option value="rename">
                      Rename to {item.suggested ? displayName(item.suggested) : "a free name"}
                    </option>
                    <option value="skip">Skip</option>
                    <option value="replace">Replace the existing diagram</option>
                  </select>
                </label>
              ) : null}
            </div>
          ))}
        </div>
        {planned.some((item) => item.conflict) ? (
          <div className="import-bulk">
            <button type="button" className="btn btn-ghost" onClick={() => setAll("rename")}>
              Rename all
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAll("skip")}>
              Skip all
            </button>
          </div>
        ) : null}
        {tooMany ? <p className="import-error">Import up to {MAX_IMPORT_FILES} files at a time.</p> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || pendingChoice || sendable.length === 0 || tooMany}
          >
            {sendable.length === 0 ? "Nothing to import" : `Import ${sendable.length}`}
          </button>
        </div>
      </form>
    </div>
  );
}

function HubChoice({
  name,
  text,
  nodes,
  value,
  onChange,
}: {
  name: string;
  text: string;
  nodes: number;
  value: ImportHubLayout;
  onChange: (value: ImportHubLayout) => void;
}) {
  const advice = largeImportAdvice(text, nodes);
  if (!advice) return null;
  return (
    <fieldset className="import-hub">
      <legend>Large diagram</legend>
      <p>{advice.message}</p>
      {(
        [
          ["", "Default rank"],
          ["compact", "Compact hub layout"],
          ["radial", "Radial hub layout"],
        ] as const
      ).map(([id, label]) => (
        <label key={id || "default"} className="import-choice">
          <input type="radio" name={name} checked={value === id} onChange={() => onChange(id)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function summarize(results: ImportFileResult[]): string {
  const saved = results.filter(
    (item) => item.status === "created" || item.status === "renamed" || item.status === "replaced",
  ).length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  const failed = results.filter((item) => item.status === "error" || item.status === "collision").length;
  const parts = [`Imported ${saved} diagram${saved === 1 ? "" : "s"}`];
  if (skipped > 0) parts.push(`skipped ${skipped}`);
  if (failed > 0) parts.push(`${failed} could not be imported`);
  return `${parts.join(", ")}.`;
}
