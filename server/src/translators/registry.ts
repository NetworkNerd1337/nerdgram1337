import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundledTranslators } from "./bundled.js";
import { TRANSLATOR_INFRA } from "./infra.js";
import type { TranslatorInfo, TranslatorModule } from "./types.js";

const INFRA = new Set<string>(TRANSLATOR_INFRA);
const ID_RE = /^[a-z][a-z0-9-]*$/;

const here = path.dirname(fileURLToPath(import.meta.url));

export function translatorBasenames(fileNames: readonly string[]): string[] {
  const bases = new Set<string>();
  for (const name of fileNames) {
    const baseName = name.split(/[\\/]/).pop() ?? name;
    if (!baseName || baseName.endsWith(".d.ts")) continue;
    const match = /^(.*)\.(?:ts|js|mjs|cjs)$/.exec(baseName);
    if (!match) continue;
    const base = match[1] ?? "";
    if (!base || base.endsWith(".test") || INFRA.has(base)) continue;
    bases.add(base);
  }
  return [...bases].sort();
}

export function assertTranslatorModule(value: unknown, label: string): TranslatorModule {
  if (!value || typeof value !== "object") throw new Error(`${label} must default-export a translator.`);
  const item = value as Partial<TranslatorModule>;
  if (typeof item.id !== "string" || !ID_RE.test(item.id)) {
    throw new Error(`${label} needs an id of lowercase letters, numbers, and hyphens.`);
  }
  if (typeof item.name !== "string" || !item.name.trim()) throw new Error(`${label} needs a display name.`);
  if (typeof item.formatHint !== "string" || !item.formatHint.trim()) throw new Error(`${label} needs a formatHint.`);
  if (typeof item.placeholder !== "string" || !item.placeholder.trim()) throw new Error(`${label} needs a placeholder.`);
  if (typeof item.convert !== "function") throw new Error(`${label} needs a convert function.`);
  return {
    id: item.id,
    name: item.name.trim(),
    formatHint: item.formatHint.trim(),
    placeholder: item.placeholder,
    convert: item.convert,
  };
}

function sortModules(modules: TranslatorModule[]): TranslatorModule[] {
  const seen = new Set<string>();
  const sorted = [...modules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const item of sorted) {
    if (seen.has(item.id)) throw new Error(`Translator id "${item.id}" is registered more than once.`);
    seen.add(item.id);
  }
  return sorted;
}

/**
 * Vite (tests) replaces `import.meta.glob`. Node and tsx throw, then the
 * directory is read and each sibling is imported. The CLI bundle does neither:
 * `bundledTranslators` is already the list.
 */
async function loadFromDirectory(): Promise<TranslatorModule[]> {
  let loaders: Record<string, () => Promise<Record<string, unknown>>> | null = null;
  try {
    loaders = import.meta.glob("./*.ts");
  } catch {
    loaders = null;
  }
  const modules: TranslatorModule[] = [];
  if (loaders && typeof loaders === "object") {
    for (const [key, load] of Object.entries(loaders)) {
      if (translatorBasenames([key]).length === 0) continue;
      const loaded = await load();
      modules.push(assertTranslatorModule(loaded.default, key));
    }
    if (modules.length > 0 || Object.keys(loaders).length > 0) return sortModules(modules);
  }

  const names = await readdir(here);
  // A direct import() of a computed path is rewritten by the CLI bundler.
  // The bundle fills bundledTranslators instead and does not run this loop.
  const load = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>;
  for (const base of translatorBasenames(names)) {
    const specifier = new URL(`./${base}.js`, import.meta.url).href;
    const loaded = await load(specifier);
    modules.push(assertTranslatorModule(loaded.default, `${base}.js`));
  }
  return sortModules(modules);
}

let cache: readonly TranslatorModule[] | null = null;
let pending: Promise<readonly TranslatorModule[]> | null = null;

export function loadedTranslatorIds(): string[] {
  return cache ? cache.map((item) => item.id) : [];
}

export function loadTranslators(): Promise<readonly TranslatorModule[]> {
  if (cache) return Promise.resolve(cache);
  if (bundledTranslators) {
    cache = sortModules(bundledTranslators.map((item) => assertTranslatorModule(item, item.id)));
    return Promise.resolve(cache);
  }
  pending ??= loadFromDirectory().then((modules) => {
    cache = modules;
    return modules;
  });
  return pending;
}

export async function translatorById(id: string): Promise<TranslatorModule | undefined> {
  const modules = await loadTranslators();
  return modules.find((item) => item.id === id);
}

export async function listTranslatorInfo(): Promise<TranslatorInfo[]> {
  const modules = await loadTranslators();
  return modules.map((item) => ({
    id: item.id,
    name: item.name,
    formatHint: item.formatHint,
    placeholder: item.placeholder,
  }));
}

export function translatorDirectory(): string {
  return here;
}
