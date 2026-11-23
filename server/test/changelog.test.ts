import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/paths.js";
import {
  cutChangelogRelease,
  UNRELEASED_PLACEHOLDER,
  unreleasedProblem,
} from "../../scripts/changelog-notes.mjs";

function notes(args: string[], changelog?: string): { code: number; stdout: string; stderr: string } {
  const dir = changelog == null ? "" : fs.mkdtempSync(path.join(os.tmpdir(), "nerdgram-notes-"));
  const file = dir ? path.join(dir, "CHANGELOG.md") : "";
  if (file) fs.writeFileSync(file, changelog ?? "");
  const argv = [...args];
  if (file) argv.push("--file", file);
  try {
    const stdout = execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts/changelog-notes.mjs"), ...argv], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const error = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      code: error.status ?? 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("changelog notes", () => {
  it("prints the Azimuth title and the 2.1.12 section without the heading", () => {
    const title = notes(["--title", "v2.1.12"]);
    expect(title.code).toBe(0);
    expect(title.stdout).toBe("v2.1.12 Azimuth\n");
    const body = notes(["v2.1.12"]);
    expect(body.code).toBe(0);
    expect(body.stdout.startsWith("Patch on the Azimuth line.")).toBe(true);
    expect(body.stdout).toContain("Paste Mermaid");
    expect(body.stdout).toContain("zod ^4.6.6");
    expect(body.stdout).not.toContain('## 2.1.12 "Azimuth"');
    expect(body.stdout).not.toContain("Future ideas");
    expect(body.stdout).not.toMatch(/^_No unreleased items\._$/m);
  });

  it("keeps Atlas through 1.4, Compass on 1.5, and the later milestone names", () => {
    const changelog = [
      '## 1.4.8 "Atlas" - 2026-11-17',
      "",
      "Atlas body.",
      "",
      '## 1.5.0 "Compass" - 2026-11-17',
      "",
      "Compass body.",
      "",
      '## 1.6.1 "Galileo" - 2026-12-01',
      "",
      "Galileo body.",
      "",
      '## 1.7.5 "Navigator" - 2026-12-01',
      "",
      "Navigator body.",
      "",
      '## 1.8.5 "Meridian" - 2026-12-01',
      "",
      "Meridian body.",
      "",
    ].join("\n");
    expect(notes(["--title", "v1.4.8"], changelog).stdout).toBe("v1.4.8 Atlas\n");
    expect(notes(["--title", "v1.5.0"], changelog).stdout).toBe("v1.5.0 Compass\n");
    expect(notes(["--title", "v1.6.1"], changelog).stdout).toBe("v1.6.1 Galileo\n");
    expect(notes(["--title", "v1.7.5"], changelog).stdout).toBe("v1.7.5 Navigator\n");
    expect(notes(["--title", "v1.8.5"], changelog).stdout).toBe("v1.8.5 Meridian\n");
    expect(notes(["v1.4.8"], changelog).stdout).toBe("Atlas body.\n");
    expect(notes(["v1.8.5"], changelog).stdout).toBe("Meridian body.\n");
    const unnamed = notes(["--title", "v1.9.3"], changelog);
    expect(unnamed.code).toBe(2);
    expect(unnamed.stderr).toMatch(/no entry/);
  });

  it("matches a quoted heading and a bracket heading, and not a longer patch", () => {
    const quoted = notes(
      ["v1.2.3"],
      '## 1.2.3 "Atlas" - 2026-11-13\n\nQuoted body.\n\n## 1.2.30\n\nOther.\n',
    );
    expect(quoted.code).toBe(0);
    expect(quoted.stdout).toBe("Quoted body.\n");
    const bracket = notes(["v1.2.3"], "## [1.2.3]\n\nBracket body.\n");
    expect(bracket.stdout).toBe("Bracket body.\n");
    const longer = notes(["v1.0.5"], '## 1.0.50 "Atlas" - 2026-11-13\n\nNot this one.\n');
    expect(longer.code).toBe(2);
    expect(longer.stderr).toMatch(/no section for 1\.0\.5/);
  });

  it("titles 1.8 Meridian and refuses an unmapped 2.0", () => {
    const meridian = notes(["--title", "v1.8.0"], '## 1.8.0 "Meridian" - 2026-12-01\n\nNext line.\n');
    expect(meridian.code).toBe(0);
    expect(meridian.stdout).toBe("v1.8.0 Meridian\n");
    const still = notes(["--title", "v1.8.5"], '## 1.8.5 "Meridian" - 2026-12-01\n\nStill that minor.\n');
    expect(still.code).toBe(0);
    expect(still.stdout).toBe("v1.8.5 Meridian\n");
    const unmapped = notes(["--title", "v2.2.0"], "## 2.2.0 - 2026-12-01\n\nNext line.\n");
    expect(unmapped.code).toBe(2);
    expect(unmapped.stderr).toMatch(/no entry/);
    const wrong = notes(["--title", "v1.0.5"], '## 1.0.5 "Wrong" - 2026-11-13\n\nBody.\n');
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toMatch(/does not match package.json Atlas/);
    const empty = notes(["v1.0.5"], "## 1.0.5 \"Atlas\" - 2026-11-13\n\n");
    expect(empty.code).toBe(2);
    expect(empty.stderr).toMatch(/empty/);
    const badTag = notes(["v1.0.5-beta.1"]);
    expect(badTag.code).toBe(2);
  });

  it("does not publish the empty Unreleased line as release notes", () => {
    const mixed = notes(
      ["v1.2.3"],
      `## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n\n## 1.2.3 "Atlas" - 2026-11-13\n\nQuoted body.\n\n${UNRELEASED_PLACEHOLDER}\n`,
    );
    expect(mixed.code).toBe(0);
    expect(mixed.stdout).toBe("Quoted body.\n");
    expect(mixed.stdout).not.toContain("No unreleased items");
    const only = notes(
      ["v1.0.5"],
      `## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n\n## 1.0.5 "Atlas" - 2026-11-13\n\n${UNRELEASED_PLACEHOLDER}\n`,
    );
    expect(only.code).toBe(2);
    expect(only.stderr).toMatch(/empty/);
  });

  it("cuts Unreleased into the version section and restores the empty line", () => {
    const before = `# Changelog\n\nIntro.\n\n## Unreleased\n\n- First note.\n- Second note.\n\n## 1.4.7 "Atlas" - 2026-11-17\n\nOld release.\n`;
    const cut = cutChangelogRelease(before, { version: "1.4.8", codename: "Atlas", date: "2026-11-18" });
    expect(cut).toContain(`## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n`);
    expect(cut).toContain('## 1.4.8 "Atlas" - 2026-11-18\n\n- First note.\n- Second note.\n');
    expect(cut.indexOf("## Unreleased")).toBeLessThan(cut.indexOf("## 1.4.8"));
    expect(cut.indexOf("## 1.4.8")).toBeLessThan(cut.indexOf("## 1.4.7"));
    expect(unreleasedProblem(cut)).toBeNull();
    const again = cutChangelogRelease(cut, { version: "1.4.8", codename: "Atlas", date: "2026-11-18" });
    expect(again.match(/## 1\.4\.8/g)).toHaveLength(1);
    const kept = cutChangelogRelease(
      cut.replace(UNRELEASED_PLACEHOLDER, "- Next thing."),
      { version: "1.4.8", codename: "Atlas", date: "2026-11-18" },
    );
    expect(kept).toContain("- Next thing.");
    expect(kept).not.toContain(UNRELEASED_PLACEHOLDER);
    const blank = cutChangelogRelease(
      `# Changelog\n\nIntro.\n\n## Unreleased\n\n## 1.4.7 "Atlas" - 2026-11-17\n\nOld release.\n`,
      { version: "1.4.7", codename: "Atlas", date: "2026-11-17" },
    );
    expect(blank).toContain(`## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n`);
    expect(unreleasedProblem(`# Changelog\n\n## Unreleased\n\n## 1.0.0 "Atlas" - 2026-01-01\n\nBody.\n`)).toMatch(/empty/i);
    expect(unreleasedProblem(`# Changelog\n\n## 1.0.0 "Atlas" - 2026-01-01\n\nBody.\n`)).toMatch(/## Unreleased/);
    const inserted = cutChangelogRelease(`# Changelog\n\nIntro.\n\n## 1.4.7 "Atlas" - 2026-11-17\n\nOld release.\n`, {
      version: "1.4.7",
      codename: "Atlas",
      date: "2026-11-17",
    });
    expect(inserted).toContain(`## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n`);
    expect(unreleasedProblem(inserted)).toBeNull();
    const published = notes(["v1.4.8"], cut);
    expect(published.stdout).toBe("- First note.\n- Second note.\n");
    expect(published.stdout).not.toContain("No unreleased items");
  });
});
