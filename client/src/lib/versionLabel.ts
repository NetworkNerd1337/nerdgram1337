/** Same shape as the server label: `v2.1.13 Azimuth`. */
const CODENAME_RE = /^[A-Z][A-Za-z0-9]{1,31}$/;

export function knownCodeName(codename: string | null | undefined): string | null {
  if (!codename || !CODENAME_RE.test(codename)) return null;
  return codename;
}

export function formatVersionLabel(version: string, codename: string | null | undefined): string {
  const trimmed = version.trim();
  const base = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  const name = knownCodeName(codename);
  if (!name) return base;
  return `${base} ${name}`;
}
