/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryDialog } from "../src/components/HistoryDialog";

const history = vi.hoisted(() => vi.fn());
const historyDiff = vi.hoisted(() => vi.fn());
const saveBaseline = vi.hoisted(() => vi.fn());

vi.mock("../src/api", () => ({
  api: {
    history,
    historyDiff,
    tree: async () => ({ tree: [] }),
    historyRevision: vi.fn(),
    saveBaseline,
    updateBaseline: vi.fn(),
    removeBaseline: vi.fn(),
    restoreRevision: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock("../src/lib/exportDiagram", () => ({
  exportDiagram: vi.fn(),
}));

vi.mock("../src/lib/mermaidRender", () => ({
  renderMermaid: async () => ({
    id: "mock",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="800" height="200"><g class="node default" id="nerdgram-1-flowchart-old-fw-0"><rect width="10" height="10"/></g><g class="node default" id="nerdgram-1-flowchart-dist2-1"><rect width="10" height="10"/></g><g class="node default" id="nerdgram-1-flowchart-dist3-2"><rect width="10" height="10"/></g><g class="edgePath"><path class="flowchart-link" id="nerdgram-1-L_core1_old-fw_0" d="M0 0 L8 8"/></g><g class="edgePath"><path class="flowchart-link" id="nerdgram-1-L_core1_dist2_0" d="M0 0 L8 8"/></g><g class="edgePath"><path class="flowchart-link" id="nerdgram-1-L_core1_dist3_0" d="M0 0 L8 8"/></g></svg>`,
  }),
}));

const revision = {
  id: "rev-1",
  createdAt: "2026-11-14T12:00:00.000Z",
  mtimeMs: 1,
  size: 20,
  hash: "abc",
  name: "Baseline - pre-change",
  note: "CAB",
  namedAt: "2026-11-14T12:00:00.000Z",
};

describe("history diff dialog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it("compares a baseline without writing the diagram", async () => {
    history.mockResolvedValue({
      path: "Net.mmd",
      retention: 20,
      baselineCap: 20,
      baselineCount: 1,
      revisions: [revision],
    });
    historyDiff.mockResolvedValue({
      path: "Net.mmd",
      semantic: true,
      diagramType: "flowchart",
      note: null,
      from: { ref: "rev-1", id: "rev-1", name: revision.name, label: revision.name, createdAt: revision.createdAt },
      to: { ref: "current", id: null, name: null, label: "Current", createdAt: "2026-11-21T15:00:00.000Z" },
      text: { unified: "-old\n+new", rows: [{ kind: "change", left: "old", right: "new", leftLine: 1, rightLine: 1 }] },
      frontMatter: [],
      nodes: {
        added: [{ id: "dist3" }],
        removed: [{ id: "old-fw", label: "old-fw", shape: "rect", className: "", style: "", subgraph: "" }],
        changed: [{ id: "dist2" }],
      },
      edges: {
        added: [{ from: "core1", to: "dist3", index: 0 }],
        removed: [{ from: "core1", to: "old-fw", index: 0 }],
        changed: [{ from: "core1", to: "dist2", index: 0 }],
      },
      clicks: { added: [], removed: [], changed: [] },
      subgraphs: { added: [], removed: [], changed: [] },
      summary: ["Removed node old-fw."],
      counts: {
        nodesAdded: 0,
        nodesRemoved: 1,
        nodesChanged: 0,
        edgesAdded: 0,
        edgesRemoved: 0,
        edgesChanged: 0,
        clicksAdded: 0,
        clicksRemoved: 0,
        clicksChanged: 0,
        frontMatter: 0,
      },
      markdown: "# Diagram changes\n\n- Removed node old-fw.\n",
      visualSource: "flowchart LR\n  old-fw[old-fw]:::ngRemoved\n",
      fromSource: "flowchart LR\n  old-fw[old-fw]\n",
      toSource: "flowchart LR\n  A --> B\n",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <HistoryDialog path="Net.mmd" lockToken={null} canRestore onClose={() => undefined} onRestored={() => undefined} />,
      );
    });

    expect(container.textContent).toContain("Save baseline");
    expect(container.textContent).toContain("Baseline - pre-change");
    expect(container.textContent).toContain("Named baselines are kept");

    const compare = [...container.querySelectorAll("button")].find((button) => button.textContent === "Compare");
    expect(compare).toBeTruthy();
    await act(async () => {
      compare?.click();
    });

    expect(container.querySelector("[aria-label='Diff legend']")).toBeTruthy();
    expect(container.textContent).toContain("Removed node old-fw.");
    expect(container.textContent).toContain("This comparison is read-only");
    expect(container.textContent).toContain("Added");
    expect(container.textContent).toContain("Removed");
    expect(container.textContent).toContain("Changed");
    expect(saveBaseline).not.toHaveBeenCalled();
    expect(historyDiff).toHaveBeenCalledWith("Net.mmd", "rev-1", "current");
    const open = container.querySelector(".modal.diff-open");
    expect(open).toBeTruthy();
    expect(container.querySelector(".diff-scroll")).toBeTruthy();
    expect(container.querySelector(".diff-footer")?.textContent).toContain("Back to history");

    const side = [...container.querySelectorAll("button")].find((button) => button.textContent === "Side by side");
    await act(async () => {
      side?.click();
    });
    const figures = container.querySelectorAll(".diff-side figure");
    const fromCaption = figures[0]?.querySelector("figcaption")?.textContent ?? "";
    const fromTime = figures[0]?.querySelector("figcaption time")?.textContent ?? "";
    expect(fromCaption).toContain(`From, older · Baseline - pre-change · ${fromTime}`);
    const toCaption = figures[1]?.querySelector("figcaption")?.textContent ?? "";
    const toTime = figures[1]?.querySelector("figcaption time")?.textContent ?? "";
    expect(toCaption).toContain(`To, newer · Current · ${toTime}`);
    expect(figures[0]?.querySelector(".node.ngRemoved")).toBeTruthy();
    expect(figures[0]?.querySelector(".node.ngAdded")).toBeNull();
    expect(figures[0]?.querySelector(".flowchart-link.ngRemoved")).toBeTruthy();
    expect(figures[0]?.querySelector(".node.ngChanged")).toBeTruthy();
    expect(figures[1]?.textContent).toContain("To, newer");
    expect(figures[1]?.querySelector(".node.ngAdded")).toBeTruthy();
    expect(figures[1]?.querySelector(".node.ngRemoved")).toBeNull();
    expect(figures[1]?.querySelector(".flowchart-link.ngAdded")).toBeTruthy();
    expect(figures[0]?.querySelector(".diff-fit svg")?.getAttribute("width")).toBe("100%");
    expect(figures[0]?.querySelector(".diff-fit svg")?.getAttribute("height")).toBeNull();

    const text = [...container.querySelectorAll("button")].find((button) => button.textContent === "Text");
    await act(async () => {
      text?.click();
    });
    expect(container.textContent).toContain("old");
    expect(container.textContent).toContain("new");
    const headers = container.querySelectorAll(".diff-text th");
    expect(headers[0]?.textContent).toContain("From");
    expect(headers[0]?.textContent).toContain("Older");
    expect(headers[0]?.textContent).toContain("Baseline - pre-change");
    expect(headers[0]?.querySelector("time")?.getAttribute("dateTime")).toBe(revision.createdAt);
    expect(headers[1]?.textContent).toContain("To");
    expect(headers[1]?.textContent).toContain("Newer");
    expect(headers[1]?.textContent).toContain("Current");
    expect(headers[1]?.querySelector("time")?.getAttribute("dateTime")).toBe("2026-11-21T15:00:00.000Z");
    expect(container.querySelector(".diff-row.is-change")).toBeTruthy();

    const present = [...container.querySelectorAll("button")].find((button) => button.textContent === "Present");
    await act(async () => {
      present?.click();
    });
    expect(document.querySelector("[aria-label='Diff legend']")).toBeTruthy();
    expect(document.body.textContent).toContain("Unchanged");
  });
});

describe("diff node label color", () => {
  it("uses near-white text on the colored fills in the compare view and presentation", () => {
    const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8");
    const start = css.indexOf("/* Diff node labels");
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    expect(rule).toContain(".diff-canvas .node.ngAdded .nodeLabel");
    expect(rule).toContain(".diff-canvas .node.ngRemoved .nodeLabel");
    expect(rule).toContain(".diff-canvas .node.ngChanged .nodeLabel");
    expect(rule).toContain(".diff-canvas .node.ngSame .nodeLabel");
    expect(rule).toContain(".presentation-canvas .node.ngAdded .nodeLabel");
    expect(rule).toContain(".presentation-canvas .node.ngRemoved .nodeLabel p");
    expect(rule).toContain(".presentation-canvas .node.ngChanged .nodeLabel p");
    expect(rule).toContain(".presentation-canvas .node.ngSame .nodeLabel p");
    expect(rule).toContain("color: #f8fafc");
    expect(rule).toContain("opacity: 1");
    expect(rule).not.toContain("edgeLabel");
  });

  it("themes baseline fields, From and To, the canvas, and the compare frame", () => {
    const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8");
    const fields = css.slice(
      css.indexOf(".baseline-form input,\n.diff-toolbar select"),
      css.indexOf(".revision-diff {\n  display: flex"),
    );
    expect(fields).toContain("background: var(--bg-muted)");
    expect(fields).toContain("color: var(--ink)");
    expect(fields).toContain("color: var(--ink-soft)");
    expect(fields).toContain("outline: 2px solid var(--accent)");
    expect(fields).not.toContain("#fff");
    const canvas = css.slice(css.indexOf(".diff-canvas {"), css.indexOf(".diff-canvas svg"));
    expect(canvas).toContain("background: var(--bg-muted)");
    expect(canvas).not.toContain("#f4f7f5");
    const frame = css.slice(css.indexOf(".modal.diff-open {"), css.indexOf(".modal.diff-open > p"));
    expect(frame).toContain("max-height: 90vh");
    expect(frame).toContain("display: flex");
    expect(css).toContain(".diff-scroll {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow: auto;");
    expect(css).toContain(".diff-side .diff-fit svg {\n  display: block;\n  width: 100%;");
    expect(css).toContain(".diff-canvas .node.ngAdded :is(rect, polygon, circle, ellipse, path)");
    expect(css).toContain("fill: #1f7a4d");
    expect(css).toContain("fill: #8f2430");
    expect(css).toContain("fill: #8a5a12");
    const rows = css.slice(css.indexOf(".diff-text .diff-row.is-add td"), css.indexOf(".confirm-backdrop"));
    expect(rows).toContain("background: #1f7a4d");
    expect(rows).toContain("background: #8f2430");
    expect(rows).toContain("background: #8a5a12");
    expect(rows).toContain("color: #f8fafc");
    expect(rows).toContain("color: var(--ink-soft)");
    expect(rows).not.toContain("#e5f6ec");
    expect(rows).not.toContain("#fff4df");
    const root = css.slice(0, css.indexOf("html[data-theme=\"dark\"]"));
    const dark = css.slice(css.indexOf("html[data-theme=\"dark\"]"), css.indexOf("html,\nbody,"));
    expect(root).toContain("--bg-muted: #e8eeea");
    expect(root).toContain("--ink: #1c2420");
    expect(dark).toContain("--bg-muted: #1a2330");
    expect(dark).toContain("--ink: #e8eef5");
  });
});
