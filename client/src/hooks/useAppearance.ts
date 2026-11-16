import { useEffect, useState } from "react";
import {
  APPEARANCE_EVENT,
  readAppearance,
  resolveTheme,
  systemPrefersDark,
  type Appearance,
  type ResolvedTheme,
} from "../lib/appearance";

function resolvedNow(): ResolvedTheme {
  if (typeof document !== "undefined") {
    const theme = document.documentElement.dataset.theme;
    if (theme === "light" || theme === "dark") return theme;
  }
  return resolveTheme(readAppearance(), systemPrefersDark());
}

/** The saved appearance and the theme currently applied to the document. */
export function useAppearance(): { preference: Appearance; resolved: ResolvedTheme } {
  const [preference, setPreference] = useState<Appearance>(readAppearance);
  const [resolved, setResolved] = useState<ResolvedTheme>(resolvedNow);

  useEffect(() => {
    const sync = () => {
      setPreference(readAppearance());
      setResolved(resolvedNow());
    };
    window.addEventListener(APPEARANCE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { preference, resolved };
}
