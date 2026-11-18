import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";
import { parseSemver } from "./semver.js";

/**
 * Same rule as scripts/codenames.mjs. A code name is a single capitalized
 * word, so a release title cannot smuggle markup or a second sentence.
 */
export const CODENAME_RE = /^[A-Z][A-Za-z0-9]{1,31}$/;

const TITLE_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\s+"([A-Z][A-Za-z0-9]{1,31})"$/;

/** `"1.5"` or `"1.6"`: major and the minor where that code name starts. */
const MILESTONE_KEY = /^[1-9]\d*\.(0|[1-9]\d*)$/;

export type CodenameMap = Record<string, string>;

export function readCodenames(repoRoot = REPO_ROOT): CodenameMap {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { codenames?: unknown };
    return sanitizeCodenames(parsed.codenames);
  } catch {
    return {};
  }
}

export function sanitizeCodenames(value: unknown): CodenameMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map: CodenameMap = {};
  for (const [key, name] of Object.entries(value)) {
    if (!MILESTONE_KEY.test(key)) continue;
    if (typeof name !== "string" || !CODENAME_RE.test(name)) continue;
    map[key] = name;
  }
  return map;
}

type Milestone = { minor: number; name: string };

function milestonesForMajor(major: number, map: CodenameMap): Milestone[] {
  const found: Milestone[] = [];
  for (const [key, name] of Object.entries(map)) {
    const match = /^([1-9]\d*)\.(0|[1-9]\d*)$/.exec(key);
    if (!match || Number(match[1]) !== major) continue;
    if (!CODENAME_RE.test(name)) continue;
    found.push({ minor: Number(match[2]), name });
  }
  found.sort((a, b) => a.minor - b.minor);
  return found;
}

/**
 * A code name starts at its `major.minor` key and covers every patch of that
 * minor. It also covers later minors of the same major until the next key.
 * The last key of a major covers only its own minor. 1.5.y stays Compass.
 * 1.9.y and 2.0.y stay unnamed until a key is added.
 */
export function codenameForVersion(version: string, map: CodenameMap = readCodenames()): string | null {
  const parsed = parseSemver(version);
  if (!parsed) return null;
  const milestones = milestonesForMajor(parsed.major, map);
  let chosen: Milestone | null = null;
  for (const entry of milestones) {
    if (entry.minor <= parsed.minor) chosen = entry;
  }
  if (!chosen) return null;
  if (chosen.minor === parsed.minor) return chosen.name;
  const later = milestones.some((entry) => entry.minor > chosen.minor);
  return later ? chosen.name : null;
}

/**
 * A release title may supply a code name only when the map has no entry for
 * that version, and only when the title is exactly `vX.Y.Z "Name"` for the
 * same version the tag already parsed.
 */
export function codenameFromReleaseTitle(version: string, title: string): string | null {
  const parsed = parseSemver(version);
  if (!parsed) return null;
  const match = TITLE_RE.exec(title.trim());
  if (!match) return null;
  if (Number(match[1]) !== parsed.major || Number(match[2]) !== parsed.minor || Number(match[3]) !== parsed.patch) {
    return null;
  }
  return match[4] ?? null;
}

export function releaseCodename(
  version: string,
  title: string | null | undefined,
  map: CodenameMap = readCodenames(),
): string | null {
  const fromMap = codenameForVersion(version, map);
  if (fromMap) return fromMap;
  if (!title) return null;
  return codenameFromReleaseTitle(version, title);
}

/** `v1.8.6 "Meridian"`, or `v1.8.6` when this version has no code name. */
export function formatVersionLabel(version: string, codename: string | null | undefined): string {
  const trimmed = version.trim();
  const base = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  if (!codename || !CODENAME_RE.test(codename)) return base;
  return `${base} "${codename}"`;
}
