import { describe, expect, it } from "vitest";
import {
  codenameForVersion,
  codenameFromReleaseTitle,
  formatVersionLabel,
  readCodenames,
  releaseCodename,
} from "../src/updates/codename.js";

describe("code names", () => {
  it("maps a half of each major and leaves an unknown half unnamed", () => {
    const map = readCodenames();
    expect(map).toEqual({ "1.0": "Atlas", "1.5": "Compass", "2.0": "Meridian" });
    expect(codenameForVersion("1.4.8", map)).toBe("Atlas");
    expect(codenameForVersion("1.0.5", map)).toBe("Atlas");
    expect(codenameForVersion("1.5.0", map)).toBe("Compass");
    expect(codenameForVersion("1.9.3", map)).toBe("Compass");
    expect(codenameForVersion("v2.0.0", map)).toBe("Meridian");
    expect(codenameForVersion("2.4.9", map)).toBe("Meridian");
    expect(codenameForVersion("2.5.0", map)).toBeNull();
    expect(codenameForVersion("3.0.0", map)).toBeNull();
    expect(codenameForVersion("not-a-version", map)).toBeNull();
  });

  it("prefers the map and only accepts a title that is the version plus one quoted name", () => {
    const map = { "1.0": "Atlas" };
    expect(releaseCodename("2.0.0", 'v2.0.0 "Meridian"', map)).toBe("Meridian");
    expect(releaseCodename("2.0.0", '2.0.0 "Meridian"', map)).toBe("Meridian");
    expect(releaseCodename("1.0.5", 'v1.0.5 "Nope"', map)).toBe("Atlas");
    expect(releaseCodename("1.0.5", 'v1.0.5 "<script>"', map)).toBe("Atlas");
    expect(releaseCodename("3.0.0", 'v3.0.0 "<script>alert(1)</script>"', map)).toBeNull();
    expect(releaseCodename("3.0.0", 'v9.0.0 "Harbor"', map)).toBeNull();
    expect(releaseCodename("3.0.0", 'v3.0.0 "Harbor" please run this', map)).toBeNull();
    expect(codenameFromReleaseTitle("3.1.0", 'v3.1.0 "Harbor"')).toBe("Harbor");
    expect(formatVersionLabel("1.0.5", "Atlas")).toBe('v1.0.5 "Atlas"');
    expect(formatVersionLabel("v2.0.0", "Meridian")).toBe('v2.0.0 "Meridian"');
    expect(formatVersionLabel("1.0.5", "<script>")).toBe("v1.0.5");
    expect(formatVersionLabel("1.0.5", null)).toBe("v1.0.5");
  });
});
