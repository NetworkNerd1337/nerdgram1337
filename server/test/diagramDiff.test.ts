import { describe, expect, it } from "vitest";
import { diffDiagrams } from "../src/diagramDiff.js";
import { mermaidSyntaxDiagnostic } from "../src/mermaidSyntax.js";

const before = `---
title: Old
---
flowchart LR
  core1[Core 1] --> dist2[Dist-2]
  old-fw[Old FW]
  click core1 "nerdgram:One.mmd" "Open"
`;

const after = `---
title: New
---
flowchart LR
  core1[Core 1] --> dist2["Dist-2 (new)"]
  core1 --> dist3[Dist 3]
  click core1 "nerdgram:Two.mmd" "Open"
`;

describe("diagram diff", () => {
  it("reports adds, removes, relabels, clicks, and front matter", () => {
    const diff = diffDiagrams(before, after, { from: "Baseline", to: "Current" });
    expect(diff.semantic).toBe(true);
    expect(diff.diagramType).toBe("flowchart");
    expect(diff.note).toBeNull();
    expect(diff.nodes.added.map((node) => node.id)).toContain("dist3");
    expect(diff.nodes.removed.map((node) => node.id)).toEqual(["old-fw"]);
    expect(diff.nodes.changed.find((node) => node.id === "dist2")?.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "label", from: "Dist-2", to: "Dist-2 (new)" })]),
    );
    expect(diff.edges.added).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: "core1", to: "dist3" })]),
    );
    expect(diff.clicks.changed).toEqual([
      { nodeId: "core1", from: "nerdgram:One.mmd", to: "nerdgram:Two.mmd" },
    ]);
    expect(diff.frontMatter).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "title", from: "Old", to: "New" })]),
    );
    expect(diff.summary).toEqual(
      expect.arrayContaining([
        "Added link core1 to dist3.",
        "Removed node old-fw.",
        "Relabeled dist2 from `Dist-2` to `Dist-2 (new)`.",
        "Changed front matter title from `Old` to `New`.",
      ]),
    );
    expect(diff.text.unified).toContain("title: Old");
    expect(diff.text.unified).toContain("title: New");
    expect(diff.markdown).toContain("# Diagram changes");
    expect(diff.markdown).toContain("## Front matter");
    expect(diff.fromSource).toBe(before);
    expect(diff.toSource).toBe(after);
  });

  it("pairs duplicate edges between the same nodes and reports arrow and style changes", () => {
    const from = `flowchart LR
  A --> B
  A --> B
  A ==> C
`;
    const to = `flowchart LR
  A --> B
  A -->|spare| B
  A -.-> C
  linkStyle 2 stroke:#f00
`;
    const diff = diffDiagrams(from, to);
    const pair = diff.edges.changed.filter((edge) => edge.from === "A" && edge.to === "B");
    expect(pair).toHaveLength(1);
    expect(pair[0]).toMatchObject({ index: 1 });
    expect(pair[0]?.changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: "label", from: "", to: "spare" })]));
    const arrow = diff.edges.changed.find((edge) => edge.from === "A" && edge.to === "C");
    expect(arrow?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "arrow", from: "==>", to: "-.->" }),
        expect.objectContaining({ field: "style", to: "stroke:#f00" }),
      ]),
    );
    expect(diff.summary.join("\n")).toContain("Changed the link 2 from A to B");
  });

  it("reports a node that moves into another subgraph", () => {
    const from = `flowchart TB
  subgraph one [Site A]
    n1[Node]
  end
`;
    const to = `flowchart TB
  subgraph two [Site B]
    n1[Node]
  end
`;
    const diff = diffDiagrams(from, to);
    expect(diff.nodes.changed).toEqual([
      {
        id: "n1",
        changes: [expect.objectContaining({ field: "subgraph", from: "one", to: "two" })],
      },
    ]);
    expect(diff.summary).toContain("Moved n1 from subgraph one into two.");
    expect(diff.subgraphs.removed.map((item) => item.id)).toContain("one");
    expect(diff.subgraphs.added.map((item) => item.id)).toContain("two");
  });

  it("falls back to a text diff for diagrams that are not flowcharts", () => {
    const from = "sequenceDiagram\n  Alice->>Bob: Hi\n";
    const to = "sequenceDiagram\n  Alice->>Bob: Hello\n";
    const diff = diffDiagrams(from, to);
    expect(diff.semantic).toBe(false);
    expect(diff.visualSource).toBeNull();
    expect(diff.note).toMatch(/text diff/);
    expect(diff.nodes.added).toEqual([]);
    expect(diff.text.rows.some((row) => row.kind !== "same")).toBe(true);
    expect(diff.text.unified).toContain("Hello");
    expect(diff.summary[0]).toMatch(/text diff/);
  });

  it("builds a read-only visual source with Mermaid class colours", async () => {
    const diff = diffDiagrams(before, after);
    expect(diff.visualSource).toBeTruthy();
    const visual = diff.visualSource ?? "";
    expect(visual).toContain("classDef ngAdded");
    expect(visual).toContain("classDef ngRemoved");
    expect(visual).toContain("classDef ngChanged");
    expect(visual).toContain("classDef ngSame");
    expect(visual).toContain("fill:#1f7a4d");
    expect(visual).toContain("fill:#8f2430");
    expect(visual).toContain("stroke-dasharray:5 4");
    expect(visual).toContain("fill:#8a5a12");
    expect(visual).toContain("old-fw");
    expect(visual).toContain(":::ngRemoved");
    expect(visual).toContain(":::ngChanged");
    expect(visual).toContain(":::ngAdded");
    expect(visual).not.toBe(before);
    expect(visual).not.toBe(after);
    expect(await mermaidSyntaxDiagnostic(visual)).toBeNull();
  });

  it("reports no semantic changes when the flowchart is unchanged", () => {
    const source = "flowchart LR\n  A[One] --> B[Two]\n";
    const diff = diffDiagrams(source, source);
    expect(diff.summary).toEqual(["No changes."]);
    expect(diff.text.unified).toBe("");
    expect(diff.visualSource).toContain(":::ngSame");
  });
});
