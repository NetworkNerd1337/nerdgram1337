import { describe, expect, it } from "vitest";
import { attentionBadgeCount, attentionProblemLabel, attentionRows } from "../src/lib/attention";

describe("needs attention", () => {
  it("counts diagrams with problems and skips a clear workspace", () => {
    const rows = attentionRows(
      [
        { path: "WAN.mmd", line: 8, severity: "warning", message: "Broken link", ruleId: "broken-click" },
        { path: "WAN.mmd", line: 2, severity: "error", message: "Parse error", ruleId: "parse" },
        { path: "Welcome.mmd", line: 4, severity: "warning", message: "Unused", ruleId: "unused-class" },
      ],
      [{ path: "Old.mmd", code: "EIO", message: "Could not read `Old.mmd`." }],
    );
    expect(rows.map((row) => row.path)).toEqual(["WAN.mmd", "Welcome.mmd", "Old.mmd"]);
    expect(rows[0]).toMatchObject({ count: 2, line: 2, message: "Parse error" });
    expect(attentionRows([], [])).toEqual([]);
  });

  it("counts diagrams for the badge and separates errors from warnings", () => {
    const diagrams = [
      { errors: 1, warnings: 2 },
      { errors: 0, warnings: 3 },
      { errors: 0, warnings: 0 },
    ];
    expect(attentionBadgeCount(diagrams)).toBe(2);
    expect(attentionProblemLabel(1, 2)).toBe("1 error · 2 warnings");
    expect(attentionProblemLabel(1, 0)).toBe("1 error");
    expect(attentionProblemLabel(0, 1)).toBe("1 warning");
    expect(attentionProblemLabel(0, 0)).toBe("");
  });
});