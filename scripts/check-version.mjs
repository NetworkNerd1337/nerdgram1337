import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChangelogSection, unreleasedProblem } from "./changelog-notes.mjs";
import { currentCodename } from "./codenames.mjs";

/** Releases named in README prose that are not the package.json pin. */
const POLICY_VERSIONS = new Set(["1.0.5", "1.0.6", "2.0.0"]);

export const CLI_PACKAGE_NAME = "nerdgram1337";

export const VERSIONED_PACKAGES = ["package.json", "client/package.json", "server/package.json", "cli/package.json"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {{ file: string, version: string }[]} versions
 */
export function driftedVersions(versions) {
  const expected = versions[0]?.version;
  return versions.filter((item) => item.version !== expected);
}

/**
 * The published CLI has to stay the unscoped package nerdgram1337, with the
 * nerdgram command. version:sync copies the version. It does not rename it.
 *
 * @param {Record<string, any>} pkg
 * @param {string} expectedVersion
 * @returns {string | null}
 */
export function cliPackageError(pkg, expectedVersion) {
  if (!pkg || typeof pkg !== "object") return "cli/package.json could not be read.";
  if (pkg.name !== CLI_PACKAGE_NAME) {
    return `cli/package.json name must be ${CLI_PACKAGE_NAME}. Found ${pkg.name ?? "(missing)"}.`;
  }
  if (pkg.private === true) return "cli/package.json is private, so npm will not publish it.";
  const bin = pkg.bin && pkg.bin.nerdgram;
  if (typeof bin !== "string" || bin.length === 0) {
    return "cli/package.json must map the nerdgram command to a bin file.";
  }
  if (!pkg.publishConfig || pkg.publishConfig.access !== "public") {
    return "cli/package.json publishConfig.access must be public.";
  }
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  if (!files.includes("bin") || !files.includes("dist")) {
    return "cli/package.json files must include bin and dist so the registry tarball can run.";
  }
  if (pkg.version !== expectedVersion) {
    return `cli/package.json version ${pkg.version ?? "(missing)"} does not match ${expectedVersion}. Run npm run version:sync from the project root.`;
  }
  return null;
}

function checkTree() {
const versions = VERSIONED_PACKAGES.map((file) => {
  const json = JSON.parse(readFileSync(join(root, file), "utf8"));
  return { file, version: json.version };
});

const expected = versions[0]?.version;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (typeof expected !== "string" || !semver.test(expected)) {
  console.error(`Root package.json version must be a stable X.Y.Z. Got ${expected}.`);
  process.exit(1);
}

const named = currentCodename(root);
if (!named.ok) {
  console.error(named.error);
  process.exit(1);
}
const codename = named.codename;

const drifted = driftedVersions(versions);
if (drifted.length > 0) {
  console.error("package.json versions differ. The root package.json version is the source of truth.");
  console.error("Run npm run version:sync from the project root.");
  for (const item of versions) console.error(`  ${item.file}: ${item.version}`);
  process.exit(1);
}

const cliPkg = JSON.parse(readFileSync(join(root, "cli/package.json"), "utf8"));
const cliError = cliPackageError(cliPkg, expected);
if (cliError) {
  console.error(cliError);
  process.exit(1);
}
const cliLicensePath = join(root, "cli/LICENSE");
if (!existsSync(cliLicensePath) || readFileSync(cliLicensePath, "utf8") !== readFileSync(join(root, "LICENSE"), "utf8")) {
  console.error("cli/LICENSE must be a copy of the root LICENSE.");
  process.exit(1);
}

const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
const versionArgs = [...dockerfile.matchAll(/^ARG NERDGRAM_VERSION=(\S+)\s*$/gm)].map((match) => match[1]);
if (versionArgs.length === 0 || versionArgs.some((version) => version !== expected)) {
  console.error(`Dockerfile ARG NERDGRAM_VERSION must be ${expected}. Found ${versionArgs.join(", ") || "none"}.`);
  process.exit(1);
}
const codenameArgs = [...dockerfile.matchAll(/^ARG NERDGRAM_CODENAME=(\S+)\s*$/gm)].map((match) => match[1]);
if (codenameArgs.length === 0 || codenameArgs.some((name) => name !== codename)) {
  console.error(`Dockerfile ARG NERDGRAM_CODENAME must be ${codename}. Found ${codenameArgs.join(", ") || "none"}.`);
  process.exit(1);
}
if (!dockerfile.includes('org.opencontainers.image.codename="${NERDGRAM_CODENAME}"')) {
  console.error("Dockerfile must label org.opencontainers.image.codename from NERDGRAM_CODENAME.");
  process.exit(1);
}
if (!dockerfile.includes("NERDGRAM_CODENAME=${NERDGRAM_CODENAME}")) {
  console.error("Dockerfile must bake NERDGRAM_CODENAME into the image environment.");
  process.exit(1);
}

const compose = readFileSync(join(root, "compose.yaml"), "utf8");
const image = `ghcr.io/networknerd1337/nerdgram1337:v${expected}`;
if (!compose.includes(image)) {
  console.error(`compose.yaml must pin ${image} for docker compose pull.`);
  process.exit(1);
}
if (/^\s*build\s*:/m.test(compose)) {
  console.error("compose.yaml must not build an image. A local build belongs in compose.build.yaml as nerdgram1337:local.");
  process.exit(1);
}
const buildCompose = readFileSync(join(root, "compose.build.yaml"), "utf8");
if (!buildCompose.includes("image: nerdgram1337:local") || !buildCompose.includes(`NERDGRAM_VERSION: "${expected}"`)) {
  console.error(`compose.build.yaml must tag nerdgram1337:local and pin NERDGRAM_VERSION ${expected}.`);
  process.exit(1);
}
if (!buildCompose.includes(`NERDGRAM_CODENAME: "${codename}"`)) {
  console.error(`compose.build.yaml must pin NERDGRAM_CODENAME ${codename}.`);
  process.exit(1);
}

for (const file of ["package-lock.json", "client/package-lock.json", "server/package-lock.json"]) {
  const lock = JSON.parse(readFileSync(join(root, file), "utf8"));
  const top = lock.version;
  const nested = lock.packages?.[""]?.version;
  if (top !== expected || nested !== expected) {
    console.error(`${file} version must be ${expected}. Found ${top} and ${nested}.`);
    console.error("Run npm run version:sync from the project root.");
    process.exit(1);
  }
}

const changelogPath = join(root, "CHANGELOG.md");
if (!existsSync(changelogPath)) {
  console.error("CHANGELOG.md is missing. The release notes section has to match package.json.");
  process.exit(1);
}
const changelog = readFileSync(changelogPath, "utf8");
const pending = unreleasedProblem(changelog);
if (pending) {
  console.error(pending);
  process.exit(1);
}
const section = findChangelogSection(changelog, expected);
if (!section) {
  console.error(`CHANGELOG.md needs a section for ${expected}, for example ## ${expected} "${codename}" - YYYY-MM-DD.`);
  process.exit(1);
}
if (section.codename !== codename) {
  console.error(
    `CHANGELOG heading for ${expected} must name the code name ${codename}. Found ${section.codename ?? "no code name"}.`,
  );
  process.exit(1);
}
if (!section.body) {
  console.error(`CHANGELOG.md section ${expected} is empty.`);
  process.exit(1);
}

const readmePath = join(root, "README.md");
if (!existsSync(readmePath)) {
  console.error("README.md is missing. Version examples in the README are checked against package.json.");
  process.exit(1);
}
for (const file of versionedMarkdown(root)) {
  assertReadmeVersions(readFileSync(file, "utf8"), expected, relative(root, file));
}
assertMarkdownLinks(root);

console.log(
  `Version ${expected} "${codename}" matches in root, client, server, cli (${CLI_PACKAGE_NAME}), Dockerfile, compose.yaml, compose.build.yaml, CHANGELOG.md, README.md, and the docs. Markdown links resolve.`,
);
}

/**
 * Install commands use a vX.Y.Z placeholder so a release does not have to edit
 * every example. An image tag, `nerdgram1337@`, or NERDGRAM_VERSION pin has to
 * match the root package.json. `npm run version:sync` does not rewrite the README.
 *
 * The versioning section also names planned releases. Those are not the
 * package that is checked out today, so they are allowed in prose only.
 */
function versionedMarkdown(repoRoot) {
  const files = [join(repoRoot, "README.md")];
  const docs = join(repoRoot, "docs");
  if (existsSync(docs)) {
    for (const name of readdirSync(docs)) {
      if (name.endsWith(".md")) files.push(join(docs, name));
    }
  }
  return files;
}

function assertReadmeVersions(markdown, version, label = "README.md") {
  const pinPatterns = [
    /ghcr\.io\/networknerd1337\/nerdgram1337:v(\d+\.\d+\.\d+)/g,
    /nerdgram1337@(\d+\.\d+\.\d+)/g,
    /NERDGRAM_VERSION(?:=|:)\s*"?(\d+\.\d+\.\d+)/g,
  ];
  const bad = new Set();
  for (const pattern of pinPatterns) {
    for (const match of markdown.matchAll(pattern)) {
      if (match[1] !== version) bad.add(match[0]);
    }
  }
  for (const match of markdown.matchAll(/(?<![A-Za-z0-9.])v(\d+\.\d+\.\d+)\b/g)) {
    if (match[1] !== version && !POLICY_VERSIONS.has(match[1])) bad.add(match[0]);
  }
  if (bad.size > 0) {
    console.error(`${label} version examples must match package.json ${version}, or use the vX.Y.Z placeholder.`);
    console.error("Prose may also name v1.0.5, v1.0.6, and v2.0.0 (Meridian).");
    for (const item of bad) console.error(`  ${item}`);
    process.exit(1);
  }
}

/**
 * The image build copies README.md and leaves out `docs/` and `screenshots/`
 * (see .dockerignore). A link into a directory this tree does not have is
 * skipped. A missing file whose parent directory is here still fails.
 *
 * @param {string} fromFile
 * @param {string} decodedPath
 * @returns {boolean}
 */
export function linkPointsOutsideThisTree(fromFile, decodedPath) {
  const parts = decodedPath.split("/");
  let dir = dirname(fromFile);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "" || part === ".") continue;
    const next = join(dir, part);
    const hasMore = parts.slice(i + 1).some((item) => item !== "" && item !== ".");
    if (!existsSync(next)) return hasMore;
    dir = next;
  }
  return false;
}

/**
 * Relative links and anchors in project Markdown. `reference/` is the upstream
 * Mermaid syntax mirror. Its heading ids belong to that site, so it is not
 * part of this check.
 */
function assertMarkdownLinks(repoRoot) {
  const files = markdownFiles(repoRoot);
  const anchors = new Map();
  const problems = [];
  let skipped = 0;

  function anchorsOf(file) {
    const cached = anchors.get(file);
    if (cached) return cached;
    const text = readFileSync(file, "utf8");
    const { headings, headingIds } = markdownOutsideFences(text);
    const slugs = githubSlugs(headings);
    for (const id of headingIds) slugs.add(id);
    anchors.set(file, slugs);
    return slugs;
  }

  for (const file of files) {
    const { links } = markdownOutsideFences(readFileSync(file, "utf8"));
    for (const target of links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("/")) continue;
      const hashAt = target.indexOf("#");
      const pathPart = hashAt >= 0 ? target.slice(0, hashAt) : target;
      const hash = hashAt >= 0 ? target.slice(hashAt + 1) : "";
      const where = relative(repoRoot, file);
      if (!pathPart) {
        if (!hash) continue;
        const id = decodeURIComponent(hash);
        if (!anchorsOf(file).has(id)) problems.push(`${where}: missing anchor #${id}`);
        continue;
      }
      let decoded = pathPart;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        problems.push(`${where}: bad link ${target}`);
        continue;
      }
      const resolved = resolve(dirname(file), decoded);
      if (!existsSync(resolved)) {
        if (linkPointsOutsideThisTree(file, decoded)) {
          skipped += 1;
          continue;
        }
        problems.push(`${where}: missing file ${target}`);
        continue;
      }
      if (!hash) continue;
      if (!statSync(resolved).isFile() || !resolved.endsWith(".md")) {
        problems.push(`${where}: anchor on a non-markdown path ${target}`);
        continue;
      }
      const id = decodeURIComponent(hash);
      if (!anchorsOf(resolved).has(id)) problems.push(`${where}: missing anchor ${target}`);
    }
  }

  if (problems.length > 0) {
    console.error("Markdown links do not resolve.");
    for (const item of problems) console.error(`  ${item}`);
    process.exit(1);
  }
  if (skipped > 0) {
    console.log(`Markdown links skipped: ${skipped} (those directories are not in this tree).`);
  }
}

function markdownFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "reference" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) markdownFiles(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

function markdownOutsideFences(markdown) {
  const headings = [];
  const headingIds = [];
  const links = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = /^(```+|~~~+)/.exec(line.trim());
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      headings.push(headingText(heading[2]));
      for (const id of line.matchAll(/\]\(#([^)\s]+)\)/g)) headingIds.push(decodeURIComponent(id[1]));
    }
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      links.push(match[1]);
    }
  }
  return { headings, headingIds, links };
}

function headingText(raw) {
  return raw
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .trim();
}

function githubSlugs(headings) {
  const seen = new Map();
  const slugs = new Set();
  for (const text of headings) {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

const invoked = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invoked) checkTree();
