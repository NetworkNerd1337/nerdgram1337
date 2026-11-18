import type { ExporterModule } from "./types.js";

/**
 * The CLI bundle replaces this file with static imports of every exporter.
 * The server and the tests leave it null and discover the directory instead.
 */
export const bundledExporters: readonly ExporterModule[] | null = null;
