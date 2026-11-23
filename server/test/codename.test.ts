import { describe, expect, it } from "vitest";
import {
  codenameForVersion,
  codenameFromReleaseTitle,
  formatVersionLabel,
  readCodenames,
  releaseCodename,
} from "../src/updates/codename.js";

describe("code names", () => {
  it("maps each named milestone and leaves an unnamed minor unnamed", () => {
    const map = readCodenames();
    expect(map).toEqual({
      "1.0": "Atlas",
      "1.5": "Compass",
      "1.6": "Galileo",
      "1.7": "Navigator",
      "1.8": "Meridian",
      "2.1": "Zenith",
      "2.1.5": "Azimuth",
    });
    expect(codenameForVersion("1.4.8", map)).toBe("Atlas");
    expect(codenameForVersion("1.0.5", map)).toBe("Atlas");
    expect(codenameForVersion("1.5.0", map)).toBe("Compass");
    expect(codenameForVersion("1.5.1", map)).toBe("Compass");
    expect(codenameForVersion("1.5.9", map)).toBe("Compass");
    expect(codenameForVersion("1.6.0", map)).toBe("Galileo");
    expect(codenameForVersion("1.6.4", map)).toBe("Galileo");
    expect(codenameForVersion("1.7.0", map)).toBe("Navigator");
    expect(codenameForVersion("1.7.5", map)).toBe("Navigator");
    expect(codenameForVersion("1.8.0", map)).toBe("Meridian");
    expect(codenameForVersion("1.8.5", map)).toBe("Meridian");
    expect(codenameForVersion("1.9.3", map)).toBeNull();
    expect(codenameForVersion("v2.0.0", map)).toBeNull();
    expect(codenameForVersion("2.1.0", map)).toBe("Zenith");
    expect(codenameForVersion("2.1.4", map)).toBe("Zenith");
    expect(codenameForVersion("2.1.5", map)).toBe("Azimuth");
    expect(codenameForVersion("2.1.6", map)).toBe("Azimuth");
    expect(codenameForVersion("2.4.9", map)).toBeNull();
    expect(codenameForVersion("2.5.0", map)).toBeNull();
    expect(codenameForVersion("3.0.0", map)).toBeNull();
    expect(codenameForVersion("not-a-version", map)).toBeNull();
    expect(releaseCodename("1.6.0", 'v1.6.0 "Nope"', map)).toBe("Galileo");
    expect(releaseCodename("2.0.0", 'v2.0.0 "Nope"', map)).toBe("Nope");
    expect(releaseCodename("2.2.0", 'v2.2.0 "Nope"', map)).toBe("Nope");
    expect(releaseCodename("2.2.0", 'v9.9.9 "Nope"', map)).toBeNull();
    expect(releaseCodename("2.5.0", 'v9.9.9 "Nope"', map)).toBeNull();
    expect(formatVersionLabel("v1.6.0", "Galileo")).toBe("v1.6.0 Galileo");
  });

  it("prefers the map and only accepts a title that is the version plus one quoted name", () => {
    const map = { "1.0": "Atlas" };
    expect(releaseCodename("1.0.5", 'v1.0.5 "Nope"', map)).toBe("Atlas");
    expect(releaseCodename("1.0.5", 'v1.0.5 "<script>"', map)).toBe("Atlas");
    expect(releaseCodename("3.0.0", 'v3.0.0 "<script>alert(1)</script>"', map)).toBeNull();
    expect(releaseCodename("3.0.0", 'v9.0.0 "Harbor"', map)).toBeNull();
    expect(releaseCodename("3.0.0", 'v3.0.0 "Harbor" please run this', map)).toBeNull();
    expect(codenameFromReleaseTitle("3.1.0", 'v3.1.0 "Harbor"')).toBe("Harbor");
    expect(codenameFromReleaseTitle("3.1.0", "v3.1.0 Harbor")).toBe("Harbor");
    expect(codenameFromReleaseTitle("3.1.0", "v3.1.0 Harbor please")).toBeNull();
    expect(formatVersionLabel("1.0.5", "Atlas")).toBe("v1.0.5 Atlas");
    expect(formatVersionLabel("v1.5.0", "Compass")).toBe("v1.5.0 Compass");
    expect(formatVersionLabel("1.0.5", "<script>")).toBe("v1.0.5");
    expect(formatVersionLabel("1.0.5", null)).toBe("v1.0.5");
  });
});
