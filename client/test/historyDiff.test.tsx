/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"></svg>`,
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
      from: { ref: "rev-1", id: "rev-1", name: revision.name, label: revision.name },
      to: { ref: "current", id: null, name: null, label: "Current" },
      text: { unified: "-old\n+new", rows: [{ kind: "change", left: "old", right: "new", leftLine: 1, rightLine: 1 }] },
      frontMatter: [],
      nodes: { added: [], removed: [{ id: "old-fw", label: "old-fw", shape: "rect", className: "", style: "", subgraph: "" }], changed: [] },
      edges: { added: [], removed: [], changed: [] },
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

    const text = [...container.querySelectorAll("button")].find((button) => button.textContent === "Text");
    await act(async () => {
      text?.click();
    });
    expect(container.textContent).toContain("old");
    expect(container.textContent).toContain("new");

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
});
