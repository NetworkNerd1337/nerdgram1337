import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Same rule as server/src/updates/codename.ts. A code name is one capitalized word. */
export const CODENAME_RE = /^[A-Z][A-Za-z0-9]{1,31}$/;

/**
 * `"1.5"` or `"1.6"`: the major and the minor where a code name starts.
 * A name applies to every patch of that minor. It also applies to later minors
 * of the same major until the next key. The last key of a major covers only
 * its own minor, so an unnamed later minor stays unnamed.
 */
const MILESTONE_KEY = /^[1-9]\d*\.(0|[1-9]\d*)$/;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {unknown} value
 * @returns {{ ok: true, map: Record<string, string> } | { ok: false, error: string }}
 */
export function parseCodenames(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error: 'Root package.json needs a codenames map, for example { "1.0": "Atlas", "1.5": "Compass", "1.6": "Galileo" }.',
    };
  }
  /** @type {Record<string, string>} */
  const map = {};
  for (const [key, name] of Object.entries(value)) {
    if (!MILESTONE_KEY.test(key)) {
      return { ok: false, error: `codenames key ${key} must be a major and a minor, such as 1.5 or 1.6.` };
    }
    if (typeof name !== "string" || !CODENAME_RE.test(name)) {
      return { ok: false, error: `codenames[${key}] must be a code name like Atlas.` };
    }
    map[key] = name;
  }
  return { ok: true, map };
}

/**
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseVersion(version) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(version).trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * @param {string} key
 * @returns {{ major: number, minor: number } | null}
 */
function parseKey(key) {
  const match = /^([1-9]\d*)\.(0|[1-9]\d*)$/.exec(key);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Code name for a version, or null when that milestone is not in the map.
 * 1.0 covers 1.0.y through 1.4.y because the next key is 1.5. 1.5.y is only
 * Compass. The last named minor of a major does not cover a later minor.
 * @param {string} version
 * @param {Record<string, string>} map
 */
export function codenameForVersion(version, map) {
  const parsed = parseVersion(version);
  if (!parsed) return null;
  /** @type {{ minor: number, name: string }[]} */
  const sameMajor = [];
  for (const [key, name] of Object.entries(map)) {
    const milestone = parseKey(key);
    if (!milestone || milestone.major !== parsed.major) continue;
    if (typeof name !== "string" || !CODENAME_RE.test(name)) continue;
    sameMajor.push({ minor: milestone.minor, name });
  }
  sameMajor.sort((a, b) => a.minor - b.minor);
  let chosen = null;
  for (const entry of sameMajor) {
    if (entry.minor <= parsed.minor) chosen = entry;
  }
  if (!chosen) return null;
  if (chosen.minor === parsed.minor) return chosen.name;
  const later = sameMajor.some((entry) => entry.minor > chosen.minor);
  return later ? chosen.name : null;
}

/**
 * Minors from 0 through this version that do not resolve, plus the current
 * minor when it has no key of its own. A missing milestone fails CI.
 * @param {string} version
 * @param {Record<string, string>} map
 */
export function missingMilestones(version, map) {
  const parsed = parseVersion(version);
  if (!parsed) return [];
  /** @type {string[]} */
  const missing = [];
  const own = `${parsed.major}.${parsed.minor}`;
  if (!map[own]) missing.push(own);
  for (let minor = 0; minor <= parsed.minor; minor += 1) {
    const key = `${parsed.major}.${minor}`;
    if (!codenameForVersion(`${parsed.major}.${minor}.0`, map) && !missing.includes(key)) missing.push(key);
  }
  return missing;
}

export function readRootPackage(repoRoot = root) {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
}

/**
 * Code name for the root package.json version, or an error string.
 * @returns {{ ok: true, version: string, codename: string, map: Record<string, string> } | { ok: false, error: string }}
 */
export function currentCodename(repoRoot = root) {
  const pkg = readRootPackage(repoRoot);
  const version = pkg.version;
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    return { ok: false, error: `Root package.json version must be a stable X.Y.Z. Got ${version}.` };
  }
  const parsed = parseCodenames(pkg.codenames);
  if (!parsed.ok) return parsed;
  const missing = missingMilestones(version, parsed.map);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Code name ${missing.join(", ")} has no entry in package.json codenames.`,
    };
  }
  const codename = codenameForVersion(version, parsed.map);
  if (!codename) return { ok: false, error: `Code name ${version} has no entry in package.json codenames.` };
  return { ok: true, version, codename, map: parsed.map };
}

const invoked = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invoked) {
  const current = currentCodename();
  if (!current.ok) {
    console.error(current.error);
    process.exit(1);
  }
  process.stdout.write(`${current.codename}\n`);
}
