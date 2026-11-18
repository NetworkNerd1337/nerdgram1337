import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("dashboard does not run a library check", () => {
  it("does not call the full diagram lint route", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "../src/pages/DashboardPage.tsx"), "utf8");
    expect(source).not.toContain("diagramLint(");
    expect(source).not.toContain("DiagramLintProvider");
    expect(source).not.toContain("<DiagramChecks");
    expect(source).toContain("diagramLintSummary");
    expect(source).toContain("Not checked yet");
  });
});
