import { canonicalColor } from "./stylePresets";

const KEY = "nerdgram.recentColors";
const MAX_RECENT = 12;

export function readRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const colors: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const color = canonicalColor(item);
      if (!color || colors.includes(color)) continue;
      colors.push(color);
      if (colors.length >= MAX_RECENT) break;
    }
    return colors;
  } catch {
    return [];
  }
}

export function rememberColor(colors: readonly string[], value: string): string[] {
  const color = canonicalColor(value);
  if (!color) return [...colors];
  return [color, ...colors.filter((item) => item !== color)].slice(0, MAX_RECENT);
}

export function writeRecentColors(colors: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(colors.slice(0, MAX_RECENT)));
  } catch {
    // The swatch still applies for this edit.
  }
}
