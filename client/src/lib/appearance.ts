/**
 * App appearance, stored in this browser only.
 *
 * Light and dark are explicit. "system" follows prefers-color-scheme.
 * The default is system. `appearanceBootScript` is the same choice, inlined
 * into the page before first paint so the theme does not flash.
 */

import { APPEARANCE_KEY } from "./appearanceBoot";

export { APPEARANCE_KEY, appearanceBootScript, injectAppearanceBoot } from "./appearanceBoot";

export const APPEARANCE_EVENT = "nerdgram-appearance";

export type Appearance = "light" | "dark" | "system";

export type ResolvedTheme = "light" | "dark";

export function isAppearance(value: unknown): value is Appearance {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(preference: Appearance, systemDark: boolean): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

export function readAppearance(): Appearance {
  try {
    if (typeof localStorage === "undefined") return "system";
    const raw = localStorage.getItem(APPEARANCE_KEY);
    return isAppearance(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyAppearance(preference: Appearance, systemDark = systemPrefersDark()): ResolvedTheme {
  const resolved = resolveTheme(preference, systemDark);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.appearance = preference;
    root.style.colorScheme = resolved;
  }
  return resolved;
}

export function writeAppearance(preference: Appearance): ResolvedTheme {
  const resolved = applyAppearance(preference);
  try {
    localStorage.setItem(APPEARANCE_KEY, preference);
  } catch {
    // The theme still applies for this view when storage is blocked.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(APPEARANCE_EVENT));
  return resolved;
}

/** Keep the document in sync with storage and the system theme. */
export function installAppearance(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const apply = () => {
    applyAppearance(readAppearance());
    window.dispatchEvent(new Event(APPEARANCE_EVENT));
  };
  apply();
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    if (readAppearance() === "system") apply();
  };
  media.addEventListener("change", onMedia);
  window.addEventListener("storage", apply);
  return () => {
    media.removeEventListener("change", onMedia);
    window.removeEventListener("storage", apply);
  };
}
