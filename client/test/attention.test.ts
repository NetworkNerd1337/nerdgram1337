import { describe, expect, it } from "vitest";
import { attentionRows } from "../src/lib/attention";

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
});