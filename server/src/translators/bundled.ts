import type { TranslatorModule } from "./types.js";

/**
 * The CLI bundle replaces this file with static imports of every translator.
 * The server and the tests leave it null and discover the directory instead.
 */
export const bundledTranslators: readonly TranslatorModule[] | null = null;
