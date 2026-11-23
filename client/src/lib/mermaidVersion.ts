declare const __NERDGRAM_MERMAID_VERSION__: string | undefined;

const MERMAID_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Version string Vite injected from the installed `mermaid` package, or null. */
export function bundledMermaidVersion(): string | null {
  if (typeof __NERDGRAM_MERMAID_VERSION__ !== "string") return null;
  const version = __NERDGRAM_MERMAID_VERSION__.trim();
  return MERMAID_VERSION.test(version) ? version : null;
}

function cleanMermaidVersion(version: string | null | undefined): string | null {
  const cleaned = version?.trim() ?? "";
  return MERMAID_VERSION.test(cleaned) ? cleaned : null;
}

/** `Mermaid 12.3.0`, or null when this build has no usable engine version. */
export function mermaidEngineLabel(version: string | null = bundledMermaidVersion()): string | null {
  const cleaned = cleanMermaidVersion(version);
  return cleaned ? `Mermaid ${cleaned}` : null;
}

/** GitHub release for the `mermaid` package tag, such as `mermaid@12.3.0`. */
export function mermaidEngineReleaseUrl(version: string | null = bundledMermaidVersion()): string | null {
  const cleaned = cleanMermaidVersion(version);
  if (!cleaned) return null;
  return `https://github.com/mermaid-js/mermaid/releases/tag/${encodeURIComponent(`mermaid@${cleaned}`)}`;
}
