/**
 * Sidebar width, stored in this browser only.
 * The editor/preview split uses a different key and is not written here.
 */

export const SIDEBAR_WIDTH_KEY = "nerdgram.sidebarWidth";
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const SIDEBAR_MIN_PX = 200;
export const SIDEBAR_MAX_PX = 560;
export const SIDEBAR_STEP = 16;
export const SIDEBAR_NARROW_QUERY = "(max-width: 960px)";

export function sidebarBounds(viewport: number): { min: number; max: number } {
  const half = Number.isFinite(viewport) ? Math.floor(viewport * 0.5) : SIDEBAR_MAX_PX;
  const max = Math.max(0, Math.min(SIDEBAR_MAX_PX, half));
  const min = Math.min(SIDEBAR_MIN_PX, max);
  return { min, max };
}

export function clampSidebarWidth(width: number, viewport: number): number {
  const { min, max } = sidebarBounds(viewport);
  const fallback = Math.min(max, Math.max(min, DEFAULT_SIDEBAR_WIDTH));
  if (!Number.isFinite(width)) return fallback;
  return Math.min(max, Math.max(min, width));
}

export function readSidebarWidth(storage: { getItem(key: string): string | null } | null): number {
  try {
    const raw = storage?.getItem(SIDEBAR_WIDTH_KEY);
    if (raw == null || raw.trim() === "") return DEFAULT_SIDEBAR_WIDTH;
    const value = Number(raw);
    return Number.isFinite(value) ? value : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function writeSidebarWidth(storage: { setItem(key: string, value: string): void } | null, width: number): void {
  if (!Number.isFinite(width)) return;
  try {
    storage?.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // The width still applies for this view when storage is blocked.
  }
}
