export const APP_NAME = "NerdGram1337";

/** "Dashboard · NerdGram1337", or "Present · Campus · NerdGram1337". */
export function pageTitle(...parts: readonly string[]): string {
  const cleaned = parts.map((part) => part.trim()).filter((part) => part.length > 0);
  return [...cleaned, APP_NAME].join(" · ");
}

export function presentTitle(name: string): string {
  return pageTitle("Present", name);
}
