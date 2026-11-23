import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codenameForVersion, currentCodename, parseCodenames, readRootPackage } from "./codenames.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Heading forms the release workflow accepts. The version is a whole X.Y.Z,
 * so `## 1.0.5` does not match a `## 1.0.50` section.
 *
 *   ## 1.0.5
 *   ## 1.0.5 "Atlas"
 *   ## 1.0.5 "Atlas" - 2026-11-13
 *   ## [1.0.5]
 *   ## [1.0.5] - 2026-11-13
 *   ## [1.0.5] "Atlas" - 2026-11-13
 */
const HEADING =
  /^## (?:\[((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\]|((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)))(?:\s+"([A-Z][A-Za-z0-9]{1,31})")?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;

/** Shown under `## Unreleased` when nothing is waiting for the next release. */
export const UNRELEASED_PLACEHOLDER = "_No unreleased items._";

/**
 * Drop the empty-state line. It is a placeholder, not release notes.
 * @param {string} body
 */
export function meaningfulChangelogBody(body) {
  const kept = String(body)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== UNRELEASED_PLACEHOLDER);
  return kept.join("\n").trim();
}

/**
 * @param {string} markdown
 * @param {string} version
 * @returns {{ heading: string, version: string, codename: string | null, date: string | null, body: string } | null}
 */
export function findChangelogSection(markdown, version) {
  const parts = String(markdown).split(/\n(?=## )/);
  for (const part of parts) {
    const first = (part.split(/\r?\n/, 1)[0] ?? "").replace(/\r$/, "");
    const match = HEADING.exec(first);
    if (!match) continue;
    const found = match[1] || match[2];
    if (found !== version) continue;
    const body = meaningfulChangelogBody(part.split(/\r?\n/).slice(1).join("\n"));
    return {
      heading: first,
      version: found,
      codename: match[3] ?? null,
      date: match[4] ?? null,
      body,
    };
  }
  return null;
}

/**
 * @param {string} markdown
 * @returns {{ raw: string } | null}
 */
export function findUnreleased(markdown) {
  const parts = String(markdown).replace(/\r\n/g, "\n").split(/\n(?=## )/);
  for (const part of parts) {
    const heading = (part.split("\n", 1)[0] ?? "").trim();
    if (heading !== "## Unreleased") continue;
    return { raw: part.split("\n").slice(1).join("\n").trim() };
  }
  return null;
}

/**
 * @param {string} markdown
 * @returns {string | null} A problem sentence, or null when Unreleased is usable.
 */
export function unreleasedProblem(markdown) {
  const section = findUnreleased(markdown);
  if (!section) return "CHANGELOG.md needs an ## Unreleased section before the numbered releases.";
  const raw = section.raw.trim();
  if (!meaningfulChangelogBody(raw) && raw !== UNRELEASED_PLACEHOLDER) {
    return `CHANGELOG.md Unreleased is empty. When nothing is pending, that section is ${UNRELEASED_PLACEHOLDER}.`;
  }
  return null;
}

/**
 * Move pending Unreleased notes into this version when that heading is not
 * there yet, then leave Unreleased as the empty-state line. Notes that do
 * not belong to an existing version section stay where they are.
 *
 * @param {string} markdown
 * @param {{ version: string, codename: string, date: string }} release
 */
export function cutChangelogRelease(markdown, release) {
  const original = String(markdown).replace(/\r\n/g, "\n");
  const parts = original.split(/\n(?=## )/);
  let index = parts.findIndex((part) => (part.split("\n", 1)[0] ?? "").trim() === "## Unreleased");
  if (index < 0) {
    const block = `## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n`;
    if (parts.length === 1 && !original.includes("\n## ")) {
      const preamble = original.replace(/\s*$/, "");
      return `${preamble}\n\n${block}`;
    }
    parts.splice(1, 0, block);
    return `${parts.join("\n").replace(/\s*$/, "")}\n`;
  }
  const raw = parts[index].split("\n").slice(1).join("\n").trim();
  const notes = meaningfulChangelogBody(raw);
  const existing = findChangelogSection(original, release.version);
  const sameAsRelease = Boolean(existing && notes && notes === meaningfulChangelogBody(existing.body));
  if (!existing && notes) {
    parts[index] = `## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n`;
    parts.splice(index + 1, 0, `## ${release.version} "${release.codename}" - ${release.date}\n\n${notes}\n`);
    return `${parts.join("\n").replace(/\s*$/, "")}\n`;
  }
  if (!notes || sameAsRelease) {
    if (raw === UNRELEASED_PLACEHOLDER) return original.endsWith("\n") ? original : `${original}\n`;
    parts[index] = `## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n`;
    return `${parts.join("\n").replace(/\s*$/, "")}\n`;
  }
  return original.endsWith("\n") ? original : `${original}\n`;
}

/**
 * GitHub Release title. The version comes from the tag. The code name comes
 * from the codenames map for that milestone, not from the release title text.
 * @param {string} version
 * @param {string} codename
 */
export function releaseTitle(version, codename) {
  return `v${version} ${codename}`;
}

/**
 * @param {string[]} argv
 */
export function runChangelogNotes(argv, repoRoot = root) {
  let titleOnly = false;
  /** @type {string | null} */
  let file = null;
  /** @type {string[]} */
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--title") {
      titleOnly = true;
      continue;
    }
    if (arg === "--file") {
      const next = argv[index + 1];
      if (!next) return { code: 2, stdout: "", stderr: "--file needs a path.\n" };
      file = next;
      index += 1;
      continue;
    }
    positional.push(arg);
  }

  const tag = positional[0] ?? "";
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match) return { code: 2, stdout: "", stderr: `Tag ${tag} is not a stable vX.Y.Z release.\n` };
  const version = `${match[1]}.${match[2]}.${match[3]}`;

  if (!file) {
    const current = currentCodename(repoRoot);
    if (!current.ok) return { code: 2, stdout: "", stderr: `${current.error}\n` };
    if (current.version !== version) {
      return {
        code: 2,
        stdout: "",
        stderr: `Tag ${tag} does not match package.json v${current.version}.\n`,
      };
    }
  }

  const pkg = readRootPackage(repoRoot);
  const parsed = parseCodenames(pkg.codenames);
  if (!parsed.ok) return { code: 2, stdout: "", stderr: `${parsed.error}\n` };
  const codename = codenameForVersion(version, parsed.map);
  if (!codename) {
    return {
      code: 2,
      stdout: "",
      stderr: `Code name for ${version} has no entry in package.json codenames.\n`,
    };
  }

  const changelogPath = file ?? join(repoRoot, "CHANGELOG.md");
  let changelog = "";
  try {
    changelog = readFileSync(changelogPath, "utf8");
  } catch {
    return { code: 2, stdout: "", stderr: `Could not read ${changelogPath}.\n` };
  }
  const section = findChangelogSection(changelog, version);
  if (!section) return { code: 2, stdout: "", stderr: `CHANGELOG.md has no section for ${version}.\n` };
  if (section.codename && section.codename !== codename) {
    return {
      code: 2,
      stdout: "",
      stderr: `CHANGELOG heading code name ${section.codename} does not match package.json ${codename}.\n`,
    };
  }
  if (!section.body) return { code: 2, stdout: "", stderr: `CHANGELOG.md section ${version} is empty.\n` };

  if (titleOnly) return { code: 0, stdout: `${releaseTitle(version, codename)}\n`, stderr: "" };
  return { code: 0, stdout: `${section.body}\n`, stderr: "" };
}

const invoked = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invoked) {
  const result = runChangelogNotes(process.argv.slice(2));
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.code !== 0) process.exit(result.code);
}
