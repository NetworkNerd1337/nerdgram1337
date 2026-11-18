/**
 * The editor/preview split, stored in this browser only.
 * 42 matches the previous fixed column, `minmax(280px, 42%)`.
 */

export const EDITOR_SPLIT_KEY = "nerdgram.editorSplit";
export const DEFAULT_EDITOR_SPLIT = 42;
export const CODE_MIN_PX = 280;
export const CODE_MIN_WITH_INFO_PX = 220;
export const PREVIEW_MIN_PX = 280;
export const SPLIT_DIVIDER_PX = 8;
export const SPLIT_STEP = 2;

export function clampEditorSplit(percent: number, available: number, codeMin: number, previewMin: number): number {
  if (!Number.isFinite(available) || available <= 0 || !Number.isFinite(percent)) return DEFAULT_EDITOR_SPLIT;
  if (available <= codeMin + previewMin) return (codeMin / (codeMin + previewMin)) * 100;
  const minPct = (codeMin / available) * 100;
  const maxPct = ((available - previewMin) / available) * 100;
  return Math.min(maxPct, Math.max(minPct, percent));
}

export function readEditorSplit(storage: { getItem(key: string): string | null } | null): number {
  try {
    const raw = storage?.getItem(EDITOR_SPLIT_KEY);
    if (raw == null || raw.trim() === "") return DEFAULT_EDITOR_SPLIT;
    const value = Number(raw);
    return Number.isFinite(value) ? value : DEFAULT_EDITOR_SPLIT;
  } catch {
    return DEFAULT_EDITOR_SPLIT;
  }
}

export function writeEditorSplit(storage: { setItem(key: string, value: string): void } | null, percent: number): void {
  if (!Number.isFinite(percent)) return;
  try {
    storage?.setItem(EDITOR_SPLIT_KEY, String(Math.round(percent * 10) / 10));
  } catch {
    // The split still applies for this view when storage is blocked.
  }
}
