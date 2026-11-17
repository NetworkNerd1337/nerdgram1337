import { describe, expect, it } from "vitest";
import { fileNameIssue, nextFreeStem, sanitizeFileStem, suggestFileStem } from "../src/lib/fileName";

describe("file names for new diagrams", () => {
  it("prefers the front matter title, then a comment, then a node label", () => {
    expect(suggestFileStem("---\ntitle: Campus core\n---\nflowchart LR\n  A[Other]\n")).toBe("Campus core");
    expect(suggestFileStem("%% Title: Edge path\nflowchart LR\n  A[Other]\n")).toBe("Edge path");
    expect(suggestFileStem("flowchart LR\n  A[\"<b>Core</b><br>One\"]\n")).toBe("Core One");
    expect(suggestFileStem("flowchart LR\n  A --> B\n")).toBe("");
  });

  it("cleans illegal characters and suggests a free name", () => {
    expect(sanitizeFileStem("A/B:C.mmd")).toBe("A B C");
    expect(sanitizeFileStem("   ")).toBe("");
    expect(nextFreeStem("Core", ["Core.mmd", "Core 2.mmd"])).toBe("Core 3");
    expect(fileNameIssue("", ["Core.mmd"]).empty).toBe(true);
    const taken = fileNameIssue("Core", ["Core.mmd"]);
    expect(taken.taken).toBe("Core");
    expect(taken.suggestion).toBe("Core 2");
  });
});
