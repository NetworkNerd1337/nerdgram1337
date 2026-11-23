import { describe, expect, it } from "vitest";
import { formatVersionLabel, knownCodeName } from "../src/lib/versionLabel";

describe("version label", () => {
  it("prints the version and a safe code name", () => {
    expect(formatVersionLabel("1.0.5", "Atlas")).toBe("v1.0.5 Atlas");
    expect(formatVersionLabel("v1.5.0", "Compass")).toBe("v1.5.0 Compass");
    expect(formatVersionLabel("v1.6.0", "Galileo")).toBe("v1.6.0 Galileo");
    expect(formatVersionLabel("2.5.0", null)).toBe("v2.5.0");
    expect(formatVersionLabel("3.0.0", null)).toBe("v3.0.0");
    expect(formatVersionLabel("3.0.0", "<script>")).toBe("v3.0.0");
    expect(formatVersionLabel("3.0.0", "harbor")).toBe("v3.0.0");
    expect(knownCodeName("Atlas")).toBe("Atlas");
    expect(knownCodeName("harbor")).toBeNull();
    expect(knownCodeName(null)).toBeNull();
  });
});
