import { parseDiagram } from "./frontMatter";

/** Turn a typed name into a file stem. Empty when nothing usable remains. */
export function sanitizeFileStem(input: string): string {
  const stripped = input.trim().replace(/\.mmd$/i, "");
  let cleaned = "";
  for (const char of stripped) {
    const code = char.charCodeAt(0);
    cleaned += code < 32 || "<>:\"|?*\\/".includes(char) ? " " : char;
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "." || cleaned.startsWith(".")) return "";
  return cleaned.slice(0, 120);
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function commentTitle(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("%%")) break;
    if (/^%%\{/.test(trimmed)) continue;
    const text = trimmed.replace(/^%%\s*/, "").trim();
    const titled = /^(?:title)\s*[:.-]?\s*(.+)$/i.exec(text);
    const value = (titled?.[1] ?? text).trim();
    if (!value || value === "{" ) continue;
    return value;
  }
  return "";
}

function nodeLabel(body: string): string {
  const match = /\[(?:"([^"]*)"|'([^']*)'|([^\]]*))\]/.exec(body);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  return stripHtml(raw);
}

/**
 * A file name guessed from the diagram. Front matter title, then a leading
 * `%%` comment, then the first node label. Empty when none of those exist.
 */
export function suggestFileStem(source: string): string {
  if (!source.trim()) return "";
  const parsed = parseDiagram(source);
  const front = parsed.title?.trim();
  if (front) return sanitizeFileStem(stripHtml(front));
  const comment = commentTitle(parsed.body);
  if (comment) return sanitizeFileStem(stripHtml(comment));
  const label = nodeLabel(parsed.body);
  if (label) return sanitizeFileStem(label);
  return "";
}

export function nextFreeStem(stem: string, taken: readonly string[]): string {
  const names = new Set(taken.map((item) => item.replace(/\.mmd$/i, "").trim().toLowerCase()));
  if (!names.has(stem.toLowerCase())) return stem;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} ${n}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} 2`;
}

export type FileNameIssue = {
  empty: boolean;
  /** Clean stem that already exists in the folder, when the field is not empty. */
  taken: string | null;
  suggestion: string;
};

export function fileNameIssue(value: string, taken: readonly string[]): FileNameIssue {
  const clean = sanitizeFileStem(value);
  if (!clean) return { empty: true, taken: null, suggestion: "" };
  const collision = taken.some((item) => item.replace(/\.mmd$/i, "").trim().toLowerCase() === clean.toLowerCase());
  return {
    empty: false,
    taken: collision ? clean : null,
    suggestion: collision ? nextFreeStem(clean, taken) : clean,
  };
}
