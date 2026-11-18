import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Same rule as server/src/updates/codename.ts. A code name is one capitalized word. */
export const CODENAME_RE = /^[A-Z][A-Za-z0-9]{1,31}$/;

/** `"1.0"` or `"1.5"`: major, then 0 when the minor is below 5 and 5 otherwise. */
const HALF_KEY = /^[1-9]\d*\.(0|5)$/;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {unknown} value
 * @returns {{ ok: true, map: Record<string, string> } | { ok: false, error: string }}
 */
export function parseCodenames(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error: 'Root package.json needs a codenames map, for example { "1.0": "Atlas", "1.5": "Compass" }.',
    };
  }
  /** @type {Record<string, string>} */
  const map = {};
  for (const [key, name] of Object.entries(value)) {
    if (!HALF_KEY.test(key)) {
      return { ok: false, error: `codenames key ${key} must be a major and a half, such as 1.0 or 1.5.` };
    }
    if (typeof name !== "string" || !CODENAME_RE.test(name)) {
      return { ok: false, error: `codenames[${key}] must be a code name like Atlas.` };
    }
    map[key] = name;
  }
  return { ok: true, map };
}

/**
 * Half key for a version. Minor 0–4 is `.0`. Minor 5–9 is `.5`.
 * @param {string} version
 * @returns {string | null}
 */
export function codenameHalfKey(version) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(version).trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return `${major}.${minor < 5 ? 0 : 5}`;
}

/**
 * Half keys from 1.0 through the version's own half. A missing half fails CI.
 * @param {string} version
 * @param {Record<string, string>} map
 */
export function missingHalves(version, map) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(version).trim());
  if (!match) return [];
  const major = Number(match[1]);
  const minor = Number(match[2]);
  /** @type {string[]} */
  const missing = [];
  for (let n = 1; n < major; n += 1) {
    for (const half of [0, 5]) {
      const key = `${n}.${half}`;
      if (!map[key]) missing.push(key);
    }
  }
  const own = minor < 5 ? [0] : [0, 5];
  for (const half of own) {
    const key = `${major}.${half}`;
    if (!map[key]) missing.push(key);
  }
  return missing;
}

/**
 * @param {string} version
 * @param {Record<string, string>} map
 */
export function codenameForVersion(version, map) {
  const key = codenameHalfKey(version);
  if (!key) return null;
  return map[key] ?? null;
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
  const missing = missingHalves(version, parsed.map);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Code name ${missing.join(", ")} has no entry in package.json codenames.`,
    };
  }
  const codename = codenameForVersion(version, parsed.map);
  if (!codename) return { ok: false, error: `Code name ${codenameHalfKey(version)} has no entry in package.json codenames.` };
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
