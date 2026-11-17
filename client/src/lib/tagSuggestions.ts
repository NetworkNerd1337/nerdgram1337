export type TagCount = {
  tag: string;
  count: number;
};

export type TagSuggestion = {
  kind: "tag";
  tag: string;
  count: number;
  /** Why this row is in the list. Case-only matches are ranked before other prefixes. */
  rank: "case" | "prefix" | "substring" | "popular";
} | {
  kind: "create";
  text: string;
};

const DEFAULT_LIMIT = 8;

function byUse(a: TagCount, b: TagCount): number {
  if (a.count !== b.count) return b.count - a.count;
  return a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" });
}

/**
 * Suggestions for the tag combobox.
 * Prefix matches come before substring matches, and a case-only match of an
 * existing spelling comes before either. Tags already on the diagram are left
 * out. An empty query shows the most-used tags. `Create "..."` is the last
 * row when the typed text is not already that exact spelling.
 */
export function suggestTags(
  catalog: readonly TagCount[],
  query: string,
  exclude: readonly string[],
  limit = DEFAULT_LIMIT,
): TagSuggestion[] {
  const taken = new Set(exclude.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  const available = catalog.filter((item) => item.tag.trim() && !taken.has(item.tag.trim().toLowerCase()));
  const text = query.trim();
  const cap = Math.max(1, limit);

  if (!text) {
    return [...available].sort(byUse).slice(0, cap).map((item) => ({ ...item, kind: "tag", rank: "popular" }));
  }

  const needle = text.toLowerCase();
  const caseHits: TagCount[] = [];
  const prefixHits: TagCount[] = [];
  const substringHits: TagCount[] = [];
  for (const item of available) {
    const lower = item.tag.toLowerCase();
    if (lower === needle) caseHits.push(item);
    else if (lower.startsWith(needle)) prefixHits.push(item);
    else if (lower.includes(needle)) substringHits.push(item);
  }
  caseHits.sort(byUse);
  prefixHits.sort(byUse);
  substringHits.sort(byUse);
  const matches: TagSuggestion[] = [
    ...caseHits.map((item) => ({ ...item, kind: "tag" as const, rank: "case" as const })),
    ...prefixHits.map((item) => ({ ...item, kind: "tag" as const, rank: "prefix" as const })),
    ...substringHits.map((item) => ({ ...item, kind: "tag" as const, rank: "substring" as const })),
  ].slice(0, cap);

  const exact = catalog.some((item) => item.tag === text) || exclude.some((item) => item === text);
  if (!exact) matches.push({ kind: "create", text });
  return matches;
}

/** Split a tag into the parts before, inside, and after the case-insensitive match. */
export function tagMatchParts(tag: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim();
  if (!needle) return [{ text: tag, match: false }];
  const at = tag.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return [{ text: tag, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  if (at > 0) parts.push({ text: tag.slice(0, at), match: false });
  parts.push({ text: tag.slice(at, at + needle.length), match: true });
  if (at + needle.length < tag.length) parts.push({ text: tag.slice(at + needle.length), match: false });
  return parts;
}
