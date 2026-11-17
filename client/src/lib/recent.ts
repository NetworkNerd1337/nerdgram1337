export const RECENT_KEY = "nerdgram.recent";
export const RECENT_OPEN_KEY = "nerdgram.sidebar.recentOpen";
export const RECENT_LIMIT = 10;

export type RecentEntry = {
  path: string;
  at: number;
};

export function readRecent(storage: Pick<Storage, "getItem"> | null): RecentEntry[] {
  try {
    const raw = storage?.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: RecentEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const path = (item as { path?: unknown }).path;
      const at = (item as { at?: unknown }).at;
      if (typeof path !== "string" || !path.trim()) continue;
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      entries.push({ path, at });
    }
    return entries.sort((a, b) => b.at - a.at).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function writeRecent(storage: Pick<Storage, "setItem"> | null, entries: readonly RecentEntry[]): void {
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_LIMIT)));
  } catch {
    // Ignore storage failures.
  }
}

/** Newest first, one row per path, capped at 10. */
export function touchRecent(entries: readonly RecentEntry[], path: string, at = Date.now()): RecentEntry[] {
  const trimmed = path.trim();
  if (!trimmed) return [...entries];
  const next = [{ path: trimmed, at }, ...entries.filter((item) => item.path !== trimmed)];
  return next.sort((a, b) => b.at - a.at).slice(0, RECENT_LIMIT);
}

/** Keep a renamed or moved diagram on the list. */
export function rewriteRecent(entries: readonly RecentEntry[], from: string, to: string, isDir = false): RecentEntry[] {
  const next = entries.map((item) => {
    if (item.path === from) return { ...item, path: to };
    if (isDir && item.path.startsWith(`${from}/`)) {
      return { ...item, path: `${to}${item.path.slice(from.length)}` };
    }
    return item;
  });
  const seen = new Set<string>();
  const unique: RecentEntry[] = [];
  for (const item of [...next].sort((a, b) => b.at - a.at)) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    unique.push(item);
  }
  return unique.slice(0, RECENT_LIMIT);
}

/** Drop diagrams that are gone or in the trash. Missing files are skipped. */
export function pruneRecent(entries: readonly RecentEntry[], existing: ReadonlySet<string>): RecentEntry[] {
  return entries.filter((item) => existing.has(item.path)).slice(0, RECENT_LIMIT);
}
