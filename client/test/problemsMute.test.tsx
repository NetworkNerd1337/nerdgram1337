/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProblemsPanel } from "../src/components/ProblemsPanel";
import type { ReportedDiagnostic } from "../src/lib/mermaidLint";
import { mutedWarningNote } from "../src/lib/diagramChecks";
import { attentionRows } from "../src/lib/attention";

const warning: ReportedDiagnostic = {
  ruleId: "unused-class",
  severity: "warning",
  message: "Class coreStyle is unused",
  from: 0,
  to: 1,
  line: 2,
  column: 1,
  fixes: [],
};

const error: ReportedDiagnostic = {
  ruleId: "parse",
  severity: "error",
  message: "Parse error",
  from: 0,
  to: 1,
  line: 3,
  column: 1,
  fixes: [],
};

describe("muted warnings in the editor and attention counts", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  function render(props: { diagnostics: ReportedDiagnostic[]; warningsMuted?: boolean; onToggle?: () => void }) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <ProblemsPanel
          diagnostics={props.diagnostics}
          warningsMuted={props.warningsMuted}
          onToggleWarnings={props.onToggle}
          onSelect={() => undefined}
          onFix={() => undefined}
        />,
      );
    });
  }

  it("offers mute when warnings are visible, and only the unmute indicator when they are muted", () => {
    let clicks = 0;
    render({ diagnostics: [warning], onToggle: () => (clicks += 1) });
    expect(document.body.textContent).toContain("1 warning");
    expect(document.body.textContent).toContain("Mute warnings");
    act(() => {
      document.querySelector("button")?.click();
    });
    expect(clicks).toBe(1);

    act(() => root?.unmount());
    render({ diagnostics: [], warningsMuted: true, onToggle: () => undefined });
    expect(document.querySelector("h3")?.textContent).toBe("Warnings muted");
    expect(document.body.textContent).toContain("Unmute");
    expect(document.body.textContent).not.toContain("warning");
    expect(document.body.textContent).not.toContain("Nothing to fix");

    act(() => root?.unmount());
    render({ diagnostics: [error], warningsMuted: true, onToggle: () => undefined });
    expect(document.body.textContent).toContain("1 error");
    expect(document.body.textContent).toContain("Warnings muted");
    expect(document.body.textContent).toContain("Parse error");
    expect(document.body.textContent).not.toMatch(/\d warning/);
  });

  it("counts only the findings it is given, so a muted diagram drops out of Needs attention", () => {
    const loud = [{ path: "Loud.mmd", line: 2, severity: "warning" as const, message: "Unused", ruleId: "unused-class" }];
    const withError = [
      ...loud,
      { path: "Bad.mmd", line: 3, severity: "error" as const, message: "Parse error", ruleId: "parse" },
    ];
    expect(attentionRows(loud, []).map((row) => row.path)).toEqual(["Loud.mmd"]);
    expect(attentionRows([], []).map((row) => row.path)).toEqual([]);
    expect(attentionRows(withError, []).map((row) => row.path)).toEqual(["Loud.mmd", "Bad.mmd"]);
    expect(mutedWarningNote(1)).toBe("1 diagram has muted warnings");
    expect(mutedWarningNote(7)).toBe("7 diagrams have muted warnings");
  });
});
