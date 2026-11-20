import { describe, expect, it } from "vitest";
import { formatProblem, settingsBlockTooltip } from "../src/lib/problemText";

describe("problem text", () => {
  it("shows Line N, column M once, even when the message repeats it", () => {
    const view = formatProblem({
      ruleId: "parse",
      severity: "error",
      line: 4,
      column: 1,
      message: "Line 4, column 1: this isn't valid Mermaid.",
    });
    expect(view.where).toBe("Line 4, column 1:");
    expect(view.message).toBe("this isn't valid Mermaid.");
    expect(`${view.where} ${view.message}`).toBe("Line 4, column 1: this isn't valid Mermaid.");
    expect(`${view.where} ${view.message}`).not.toContain("Line 4 Line 4");
  });

  it("uses Settings error for a broken settings block and keeps the parser text in the tooltip", () => {
    const message = "The YAML header could not be parsed. unexpected end of the stream within a flow collection (2:1)";
    const view = formatProblem({
      ruleId: "front-matter",
      severity: "error",
      line: 2,
      column: 1,
      message,
    });
    expect(view.message).toBe("Settings error");
    expect(view.where).toBe("Line 2, column 1:");
    expect(view.title).toContain("front matter");
    expect(view.title).toContain("Line 2, column 1");
    expect(view.title).toContain("unexpected end of the stream");
    expect(view.title).not.toContain("YAML header could not be parsed");
    expect(settingsBlockTooltip(2, null, "unexpected end of the stream within a flow collection (2:1)")).toContain(
      "column 1",
    );
  });

  it("leaves a theme warning as a warning", () => {
    const view = formatProblem({
      ruleId: "front-matter",
      severity: "warning",
      line: 3,
      column: 4,
      message: 'Theme "neon" is not a Mermaid theme.',
    });
    expect(view.message).toContain("neon");
    expect(view.message).not.toBe("Settings error");
    expect(view.where).toBe("Line 3, column 4:");
  });
});
