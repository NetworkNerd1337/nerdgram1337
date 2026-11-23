export function sectionIsOpen(
  category: string,
  filtering: boolean,
  overrides: Record<string, boolean>,
  storedOpen: boolean,
): boolean {
  if (category in overrides) return overrides[category] !== false;
  if (filtering) return true;
  return storedOpen;
}

/** Open or close the categories currently shown. Other categories keep their state. */
export function foldSections(
  categories: readonly string[],
  open: boolean,
  current: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...current };
  for (const category of categories) next[category] = open;
  return next;
}

export function writeSectionOpen(category: string, open: boolean) {
  try {
    localStorage.setItem(`nerdgram.templateSection.${category}`, open ? "1" : "0");
  } catch {
    // The section still toggles for this visit.
  }
}
