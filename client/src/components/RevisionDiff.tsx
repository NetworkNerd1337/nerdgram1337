import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { exportDiagram, type ExportFormat } from "../lib/exportDiagram";
import { renderMermaid } from "../lib/mermaidRender";
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

export function RevisionDiff({ path, revisions, initialFrom, initialTo, onClose }: RevisionDiffProps) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [diff, setDiff] = useState<HistoryDiff | null>(null);
  const [view, setView] = useState<View>("merged");
  const [mergedSvg, setMergedSvg] = useState("");
  const [leftSvg, setLeftSvg] = useState("");
  const [rightSvg, setRightSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
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
            if (!cancelled) setLeftSvg(result.svg);
          },
          () => undefined,
        ),
      );
      jobs.push(
        renderMermaid(diff.toSource).then(
          (result) => {
            if (!cancelled) setRightSvg(result.svg);
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
      await exportDiagram(svg, `${fileStem(path)}-diff`, format);
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
                <figcaption>{diff.from.label}</figcaption>
                <div className="diff-canvas" dangerouslySetInnerHTML={{ __html: leftSvg }} />
              </figure>
              <figure>
                <figcaption>{diff.to.label}</figcaption>
                <div className="diff-canvas" dangerouslySetInnerHTML={{ __html: rightSvg }} />
              </figure>
            </div>
          )}
          {view === "text" && (
            <div className="diff-text" aria-label="Text diff">
              <table>
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
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Back to history
        </button>
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
