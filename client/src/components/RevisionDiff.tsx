import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { exportDiagram, type ExportFormat } from "../lib/exportDiagram";
import { renderMermaid } from "../lib/mermaidRender";
import { prepareSideSvg } from "../lib/sideDiff";
import type { HistoryDiff, RevisionSummary } from "../types";
import { PresentationView } from "./PresentationView";

type RevisionDiffProps = {
  path: string;
  revisions: RevisionSummary[];
  initialFrom: string;
  initialTo: string;
  onClose: () => void;
};

type View = "merged" | "side" | "text";

function optionLabel(revision: RevisionSummary): string {
  const stamp = formatStamp(revision.createdAt);
  return revision.name ? `${revision.name} · ${stamp}` : stamp;
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function fileStem(path: string): string {
  const name = path.split("/").pop() || "diagram";
  return name.replace(/\.mmd$/i, "") || "diagram";
}

function ColumnHeading({
  role,
  age,
  endpoint,
}: {
  role: "From" | "To";
  age: "Older" | "Newer";
  endpoint: HistoryDiff["from"];
}) {
  return (
    <th colSpan={2} scope="col">
      <span className="diff-col-role">{role}</span>
      <span className="diff-col-age">{age}</span>
      <span className="diff-col-name">{endpoint.label}</span>
      {endpoint.createdAt ? <time dateTime={endpoint.createdAt}>{formatStamp(endpoint.createdAt)}</time> : null}
    </th>
  );
}

export function RevisionDiff({ path, revisions, initialFrom, initialTo, onClose }: RevisionDiffProps) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [diff, setDiff] = useState<HistoryDiff | null>(null);
  const [view, setView] = useState<View>("merged");
  const [mergedSvg, setMergedSvg] = useState("");
  const [leftSvg, setLeftSvg] = useState("");
  const [rightSvg, setRightSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const query = `${path}\0${from}\0${to}`;
  const [loadedQuery, setLoadedQuery] = useState("");
  if (query !== loadedQuery) {
    setLoadedQuery(query);
    setBusy(true);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    api
      .historyDiff(path, from, to)
      .then((next) => {
        if (cancelled) return;
        setDiff(next);
        setView(next.visualSource ? "merged" : "text");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDiff(null);
        setError(err instanceof ApiError ? err.message : "Could not compare those revisions");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, from, to]);

  const drawKey = `${diff?.visualSource ?? ""}\0${view}`;
  const [drawnKey, setDrawnKey] = useState("");
  if (diff && drawKey !== drawnKey) {
    setDrawnKey(drawKey);
    setRenderError(null);
    setMergedSvg("");
    setLeftSvg("");
    setRightSvg("");
  }

  useEffect(() => {
    if (!diff) return;
    let cancelled = false;
    const jobs: Promise<void>[] = [];
    if (diff.visualSource) {
      jobs.push(
        renderMermaid(diff.visualSource).then(
          (result) => {
            if (!cancelled) setMergedSvg(result.svg);
          },
          (err: unknown) => {
            if (!cancelled) setRenderError(err instanceof Error ? err.message : "Could not draw the diff");
          },
        ),
      );
    }
    if (view === "side") {
      jobs.push(
        renderMermaid(diff.fromSource).then(
          (result) => {
            if (!cancelled) setLeftSvg(prepareSideSvg(result.svg, "from", diff));
          },
          () => undefined,
        ),
      );
      jobs.push(
        renderMermaid(diff.toSource).then(
          (result) => {
            if (!cancelled) setRightSvg(prepareSideSvg(result.svg, "to", diff));
          },
          () => undefined,
        ),
      );
    }
    void Promise.all(jobs);
    return () => {
      cancelled = true;
    };
  }, [diff, view]);

  const exportImage = async (format: ExportFormat) => {
    if (!diff?.visualSource) return;
    setError(null);
    setExportNote(null);
    let svgText = mergedSvg;
    if (!svgText) {
      try {
        svgText = (await renderMermaid(diff.visualSource)).svg;
        setMergedSvg(svgText);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not draw the diff");
        return;
      }
    }
    const host = document.createElement("div");
    host.innerHTML = svgText;
    const svg = host.querySelector("svg");
    if (!svg) {
      setError("The diff did not draw a diagram.");
      return;
    }
    try {
      const exported = await exportDiagram(svg, `${fileStem(path)}-diff`, format);
      setExportNote(exported.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export the diff");
    }
  };

  const exportMarkdown = () => {
    if (!diff) return;
    const blob = new Blob([diff.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileStem(path)}-diff.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="revision-diff" aria-label="Revision diff">
      <div className="diff-toolbar">
        <label>
          From
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            <option value="current">Current</option>
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                {optionLabel(revision)}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select value={to} onChange={(event) => setTo(event.target.value)}>
            <option value="current">Current</option>
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                {optionLabel(revision)}
              </option>
            ))}
          </select>
        </label>
        <div className="diff-views" role="group" aria-label="Diff view">
          <button type="button" className={view === "merged" ? "btn btn-primary" : "btn btn-ghost"} disabled={!diff?.visualSource} onClick={() => setView("merged")}>
            Merged
          </button>
          <button type="button" className={view === "side" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setView("side")}>
            Side by side
          </button>
          <button type="button" className={view === "text" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setView("text")}>
            Text
          </button>
        </div>
      </div>
      <p className="diff-readonly">This comparison is read-only. It does not change the diagram.</p>
      {error && <div className="error-banner">{error}</div>}
      {exportNote && (
        <div className="editor-banner" role="status">
          {exportNote}
        </div>
      )}
      <div className="diff-scroll">
        {busy && <p>Comparing…</p>}
        {diff && (
          <>
            {diff.note && <p className="diff-note">{diff.note}</p>}
            <DiffLegend />
            <div className="diff-summary" aria-label="Change summary">
              <h4>Changes</h4>
              <ul>
                {diff.summary.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </div>
            {view === "merged" && (
              <div className="diff-canvas" aria-label="Merged diagram">
                {renderError ? <div className="preview-error">{renderError}</div> : null}
                {mergedSvg ? <div dangerouslySetInnerHTML={{ __html: mergedSvg }} /> : <p>Drawing the diff…</p>}
              </div>
            )}
            {view === "side" && (
              <div className="diff-side">
                <figure>
                  <figcaption>
                    From, older · {diff.from.label}
                    {diff.from.createdAt ? <time dateTime={diff.from.createdAt}>{formatStamp(diff.from.createdAt)}</time> : null}
                  </figcaption>
                  <div className="diff-canvas diff-fit" dangerouslySetInnerHTML={{ __html: leftSvg }} />
                </figure>
                <figure>
                  <figcaption>
                    To, newer · {diff.to.label}
                    {diff.to.createdAt ? <time dateTime={diff.to.createdAt}>{formatStamp(diff.to.createdAt)}</time> : null}
                  </figcaption>
                  <div className="diff-canvas diff-fit" dangerouslySetInnerHTML={{ __html: rightSvg }} />
                </figure>
              </div>
            )}
            {view === "text" && (
              <div className="diff-text" aria-label="Text diff">
                <table>
                  <thead>
                    <tr>
                      <ColumnHeading role="From" age="Older" endpoint={diff.from} />
                      <ColumnHeading role="To" age="Newer" endpoint={diff.to} />
                    </tr>
                  </thead>
                  <tbody>
                    {diff.text.rows.map((row, index) => (
                      <tr key={index} className={`diff-row is-${row.kind}`}>
                        <td>{row.leftLine ?? ""}</td>
                        <td>{row.left ?? ""}</td>
                        <td>{row.rightLine ?? ""}</td>
                        <td>{row.right ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      <div className="diff-footer">
        {diff ? (
          <div className="diff-export">
            <button type="button" className="btn btn-ghost" disabled={!diff.visualSource} onClick={() => void exportImage("svg")}>
              Export SVG
            </button>
            <button type="button" className="btn btn-ghost" disabled={!diff.visualSource} onClick={() => void exportImage("png")}>
              Export PNG
            </button>
            <button type="button" className="btn btn-ghost" disabled={!diff.visualSource} onClick={() => void exportImage("jpg")}>
              Export JPG
            </button>
            <button type="button" className="btn btn-ghost" disabled={!diff.visualSource} onClick={() => void exportImage("pdf")}>
              Export PDF
            </button>
            <button type="button" className="btn btn-ghost" onClick={exportMarkdown}>
              Export Markdown
            </button>
            <button type="button" className="btn btn-ghost" disabled={!diff.visualSource} onClick={() => setPresenting(true)}>
              Present
            </button>
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back to history
          </button>
        </div>
      </div>
      {presenting && diff?.visualSource ? (
        <PresentationView
          source={diff.visualSource}
          path={path}
          diffLegend
          onExit={() => setPresenting(false)}
        />
      ) : null}
    </section>
  );
}

export function DiffLegend() {
  return (
    <ul className="diff-legend" aria-label="Diff legend">
      <li>
        <i className="diff-swatch added" /> Added
      </li>
      <li>
        <i className="diff-swatch removed" /> Removed
      </li>
      <li>
        <i className="diff-swatch changed" /> Changed
      </li>
      <li>
        <i className="diff-swatch same" /> Unchanged
      </li>
    </ul>
  );
}
