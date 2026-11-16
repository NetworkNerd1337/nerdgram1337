import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api";
import {
  bindWorkspaceReplace,
  type ReplaceApplyResult,
  type ReplaceFilePreview,
  type ReplacePreview,
  type ReplaceSeed,
} from "../lib/workspaceReplace";

type Phase = "edit" | "preview" | "result";

type FileChoice = { selected: boolean; skip: Set<string> };

const WARNING_LABEL: Record<string, string> = {
  "node-id": "node id",
  "click-target": "click target",
  path: "path",
};

function Marked({ text, start, length }: { text: string; start: number; length: number }) {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(safeStart + length, text.length));
  return (
    <span>
      {text.slice(0, safeStart)}
      <mark>{text.slice(safeStart, safeEnd)}</mark>
      {text.slice(safeEnd)}
    </span>
  );
}

function choicesFrom(preview: ReplacePreview): Map<string, FileChoice> {
  return new Map(
    preview.files.map((file) => [file.path, { selected: file.selected, skip: new Set<string>() }]),
  );
}

export function WorkspaceReplaceDialog({ seed, onClose }: { seed: ReplaceSeed; onClose: () => void }) {
  const [find, setFind] = useState(seed.find ?? "");
  const [replace, setReplace] = useState(seed.replace ?? "");
  const [matchCase, setMatchCase] = useState(seed.matchCase ?? false);
  const [wholeWord, setWholeWord] = useState(seed.wholeWord ?? false);
  const [regex, setRegex] = useState(seed.regex ?? false);
  const [includeFrontMatter, setIncludeFrontMatter] = useState(false);
  const [mode, setMode] = useState<"all" | "folder">("all");
  const [recursive, setRecursive] = useState(true);
  const [phase, setPhase] = useState<Phase>("edit");
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [choices, setChoices] = useState<Map<string, FileChoice>>(new Map());
  const [result, setResult] = useState<ReplaceApplyResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folder = seed.folder ?? "";

  const query = useMemo(
    () => ({
      find,
      replace,
      matchCase,
      wholeWord,
      regex,
      includeFrontMatter,
      scope: mode === "folder" && folder ? { folder, recursive } : {},
    }),
    [find, folder, includeFrontMatter, matchCase, mode, recursive, regex, replace, wholeWord],
  );

  async function runPreview() {
    if (!find) {
      setError("Enter the text to find.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await api.replacePreview(query);
      setPreview(next);
      setChoices(choicesFrom(next));
      setPhase("preview");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not preview that replace.");
    } finally {
      setBusy(false);
    }
  }

  function toggleFile(file: ReplaceFilePreview) {
    setChoices((current) => {
      const next = new Map(current);
      const choice = next.get(file.path) ?? { selected: file.selected, skip: new Set<string>() };
      next.set(file.path, { ...choice, selected: !choice.selected });
      return next;
    });
  }

  function toggleMatch(filePath: string, matchId: string) {
    setChoices((current) => {
      const next = new Map(current);
      const choice = next.get(filePath);
      if (!choice) return current;
      const skip = new Set(choice.skip);
      if (skip.has(matchId)) skip.delete(matchId);
      else skip.add(matchId);
      next.set(filePath, { ...choice, skip });
      return next;
    });
  }

  async function runApply() {
    if (!preview) return;
    const files = preview.files.flatMap((file) => {
      const choice = choices.get(file.path);
      if (!choice?.selected) return [];
      return [{ path: file.path, hash: file.hash, skipMatchIds: [...choice.skip] }];
    });
    setBusy(true);
    setError(null);
    try {
      const applied = await api.replaceApply({ ...query, files });
      setResult(applied);
      setPhase("result");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not apply that replace.");
    } finally {
      setBusy(false);
    }
  }

  async function runUndo() {
    if (!result?.operationId) return;
    setBusy(true);
    setError(null);
    try {
      const undone = await api.replaceUndo(result.operationId);
      const restored = undone.restored.length;
      const skipped = undone.skipped.filter((item) => item.reason !== "none");
      setNote(
        restored === 0
          ? "Nothing was restored."
          : `The replace was undone. Restored ${restored} diagram${restored === 1 ? "" : "s"}.`,
      );
      setResult({
        ...result,
        operationId: null,
        changed: [],
        totals: { diagrams: 0, replacements: 0 },
        skipped: skipped.map((item) => ({ path: item.path, reason: item.reason })),
        errors: undone.errors,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not undo that replace.");
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = preview
    ? preview.files.filter((file) => choices.get(file.path)?.selected).length
    : 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="modal replace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (phase === "edit") void runPreview();
        }}
      >
        <h3 id="replace-title">Replace across diagrams</h3>
        <p className="replace-note">
          This changes every selected diagram. Find and replace in the editor still applies to the
          open diagram only.
        </p>
        {error ? <div className="error-banner">{error}</div> : null}

        {phase === "edit" ? (
          <>
            <label htmlFor="replace-find">Find</label>
            <input id="replace-find" value={find} onChange={(event) => setFind(event.target.value)} autoFocus />
            <label htmlFor="replace-with">Replace with</label>
            <input id="replace-with" value={replace} onChange={(event) => setReplace(event.target.value)} />
            <div className="replace-options">
              <label>
                <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
                Match case
              </label>
              <label>
                <input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} />
                Whole word
              </label>
              <label>
                <input type="checkbox" checked={regex} onChange={(event) => setRegex(event.target.checked)} />
                Regular expression
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={includeFrontMatter}
                  onChange={(event) => setIncludeFrontMatter(event.target.checked)}
                />
                Include front matter
              </label>
            </div>
            <fieldset className="replace-scope">
              <legend>Scope</legend>
              <label>
                <input type="radio" name="replace-scope" checked={mode === "all"} onChange={() => setMode("all")} />
                All diagrams
              </label>
              <label>
                <input
                  type="radio"
                  name="replace-scope"
                  checked={mode === "folder"}
                  disabled={!folder}
                  onChange={() => setMode("folder")}
                />
                This folder{folder ? ` (${folder})` : ""}
              </label>
              {mode === "folder" && folder ? (
                <label>
                  <input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />
                  Include subfolders
                </label>
              ) : null}
            </fieldset>
            <p className="replace-note">The preview lists every diagram so you can leave some out. Nothing is written yet.</p>
          </>
        ) : null}

        {phase === "preview" && preview ? (
          <div className="replace-preview">
            <p>
              <strong>
                {preview.totals.replacements} replacement{preview.totals.replacements === 1 ? "" : "s"} in{" "}
                {preview.totals.diagrams} diagram{preview.totals.diagrams === 1 ? "" : "s"}
              </strong>
              {selectedCount !== preview.files.length ? ` · ${selectedCount} selected` : ""}
            </p>
            {preview.message ? <p className="replace-note">{preview.message}</p> : null}
            {preview.files.length === 0 ? <p>No matches.</p> : null}
            <div className="replace-files">
              {preview.files.map((file) => {
                const choice = choices.get(file.path);
                const selected = choice?.selected ?? file.selected;
                return (
                  <section key={file.path} className="replace-file">
                    <label className="replace-file-label">
                      <input type="checkbox" checked={selected} onChange={() => toggleFile(file)} />
                      <span>
                        {file.path}{" "}
                        <span className="replace-count">
                          ({file.matchCount} match{file.matchCount === 1 ? "" : "es"})
                        </span>
                      </span>
                    </label>
                    {file.lint.invalid ? (
                      <p className="replace-warning">
                        {file.lint.newlyInvalid
                          ? "This replace would make the diagram invalid. It is unchecked."
                          : "This diagram would not parse after the replace. It is unchecked."}{" "}
                        {file.lint.messages[0] ?? ""}
                      </p>
                    ) : null}
                    {file.generatedWarning ? <p className="replace-warning">{file.generatedWarning}</p> : null}
                    <ul className="replace-matches">
                      {file.matches.map((match) => {
                        const skipped = choice?.skip.has(match.id) ?? false;
                        const warning = match.warnings.map((item) => WARNING_LABEL[item] ?? item).join(", ");
                        return (
                          <li key={match.id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selected && !skipped}
                                disabled={!selected}
                                onChange={() => toggleMatch(file.path, match.id)}
                              />
                              <span className="replace-match">
                                {match.contextBefore != null ? <span className="replace-context">{match.contextBefore}</span> : null}
                                <span>
                                  {match.line}: <Marked text={match.before} start={match.matchStart} length={match.matchLength} />
                                </span>
                                <span>
                                  → <Marked text={match.after} start={match.matchStart} length={match.replaceLength} />
                                </span>
                                {match.contextAfter != null ? <span className="replace-context">{match.contextAfter}</span> : null}
                              </span>
                            </label>
                            {warning ? (
                              <p className="replace-warning">Match is inside a {warning}. Changing it can break styles or links.</p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    {file.truncated ? (
                      <p className="replace-note">
                        Showing {file.shownCount} of {file.matchCount}. The rest are still replaced if this diagram stays selected.
                      </p>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>
        ) : null}

        {phase === "result" && result ? (
          <div className="replace-result">
            <p>
              {note ??
                `Changed ${result.totals.diagrams} diagram${result.totals.diagrams === 1 ? "" : "s"} (${result.totals.replacements} replacement${result.totals.replacements === 1 ? "" : "s"}).`}
            </p>
            <ul>
              {result.changed.map((file) => (
                <li key={file.path}>
                  {file.path} ({file.replacements})
                </li>
              ))}
              {result.skipped
                .filter((item) => item.reason !== "none")
                .map((item) => (
                  <li key={`${item.path}-${item.reason}`}>
                    Skipped {item.path} ({item.reason === "locked" ? "open in an editor" : item.reason === "changed" ? "changed since the preview" : item.reason === "edited" ? "edited since the replace" : item.reason === "undone" ? "already undone" : item.reason}).
                  </li>
                ))}
              {result.errors.map((item) => (
                <li key={item.path}>
                  {item.path}: {item.message}
                </li>
              ))}
            </ul>
            {result.operationId ? (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void runUndo()}>
                Undo this replace
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {phase === "result" ? "Close" : "Cancel"}
          </button>
          {phase === "edit" ? (
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Previewing…" : "Preview"}
            </button>
          ) : null}
          {phase === "preview" ? (
            <>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPhase("edit")}>
                Back
              </button>
              <button type="button" className="btn btn-primary" disabled={busy || selectedCount === 0} onClick={() => void runApply()}>
                {busy ? "Replacing…" : "Replace"}
              </button>
            </>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export function WorkspaceReplaceHost() {
  const [request, setRequest] = useState<{ id: number; seed: ReplaceSeed } | null>(null);
  useEffect(() => {
    let id = 0;
    bindWorkspaceReplace((seed) => {
      id += 1;
      setRequest({ id, seed });
    });
    return () => bindWorkspaceReplace(null);
  }, []);
  if (!request) return null;
  return <WorkspaceReplaceDialog key={request.id} seed={request.seed} onClose={() => setRequest(null)} />;
}
