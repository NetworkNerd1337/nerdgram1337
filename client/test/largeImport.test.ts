import { describe, expect, it } from "vitest";
import { applyDiagramPatch } from "../src/lib/frontMatter";
import { LARGE_IMPORT_LEAVES, LARGE_IMPORT_NODES, largeImportAdvice } from "../src/lib/largeImport";

function hub(leaves: number): string {
  const lines = ["flowchart LR", 'hub["Core"]'];
  for (let i = 0; i < leaves; i += 1) lines.push(`hub --> n${i}`);
  return lines.join("\n");
}

describe("large import advice", () => {
  it("stays quiet under the threshold", () => {
    expect(largeImportAdvice(hub(12), 13)).toBeNull();
    expect(largeImportAdvice("flowchart LR\na --> b", LARGE_IMPORT_NODES - 1)).toBeNull();
  });

  it("warns at 200 nodes or 50 leaf neighbors and names the count", () => {
    const byNodes = largeImportAdvice("flowchart LR\na --> b", LARGE_IMPORT_NODES);
    expect(byNodes?.message).toMatch(/200 nodes/);
    expect(byNodes?.message).toMatch(/a while/i);
    const byLeaves = largeImportAdvice(hub(LARGE_IMPORT_LEAVES), LARGE_IMPORT_LEAVES + 1);
    expect(byLeaves?.message).toMatch(/51 nodes/);
    expect(byLeaves?.message).toMatch(/Compact or Radial/);
    expect(byNodes?.message).not.toMatch(/Compact or Radial/);
  });

  it("stores compact or radial on the new file and leaves the default unset", () => {
    const source = "flowchart LR\na --> b\n";
    const compact = applyDiagramPatch(source, { hubLayout: "compact" });
    const radial = applyDiagramPatch(source, { hubLayout: "radial" });
    expect(compact.ok && compact.source).toMatch(/hubLayout: compact/);
    expect(radial.ok && radial.source).toMatch(/hubLayout: radial/);
    const cleared = applyDiagramPatch(compact.ok ? compact.source : source, { hubLayout: null });
    expect(cleared.ok && cleared.source.includes("hubLayout")).toBe(false);
  });
});
