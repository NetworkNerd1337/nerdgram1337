/**
 * Files in `server/src/translators/` that are not translators.
 * A new source is any other `*.ts` file. Do not give a translator one of these names.
 */
export const TRANSLATOR_INFRA = ["bundled", "helpers", "index", "infra", "limits", "registry", "request", "run", "types"] as const;

declare global {
  interface ImportMeta {
    /** Vite replaces this call in tests. Node throws, and the registry reads the directory. */
    glob(pattern: string): Record<string, () => Promise<Record<string, unknown>>>;
  }
}
