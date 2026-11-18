import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundledExporters } from "./bundled.js";
import { EXPORTER_INFRA } from "./infra.js";
import type { ExporterInfo, ExporterModule } from "./types.js";

const INFRA = new Set<string>(EXPORTER_INFRA);
const ID_RE = /^[a-z][a-z0-9-]*$/;

const here = path.dirname(fileURLToPath(import.meta.url));

export function exporterBasenames(fileNames: readonly string[]): string[] {
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

export function assertExporterModule(value: unknown, label: string): ExporterModule {
  if (!value || typeof value !== "object") throw new Error(`${label} must default-export an exporter.`);
  const item = value as Partial<ExporterModule>;
  if (typeof item.id !== "string" || !ID_RE.test(item.id)) {
    throw new Error(`${label} needs an id of lowercase letters, numbers, and hyphens.`);
  }
  if (typeof item.name !== "string" || !item.name.trim()) throw new Error(`${label} needs a display name.`);
  if (typeof item.extension !== "string") throw new Error(`${label} needs an extension.`);
  if (typeof item.mimeType !== "string" || !item.mimeType.trim()) throw new Error(`${label} needs a mimeType.`);
  if (typeof item.description !== "string" || !item.description.trim()) throw new Error(`${label} needs a description.`);
  if (typeof item.export !== "function") throw new Error(`${label} needs an export function.`);
  return {
    id: item.id,
    name: item.name.trim(),
    extension: item.extension.trim().replace(/^\./, ""),
    mimeType: item.mimeType.trim(),
    description: item.description.trim(),
    export: item.export,
  };
}

function sortModules(modules: ExporterModule[]): ExporterModule[] {
  const seen = new Set<string>();
  const sorted = [...modules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const item of sorted) {
    if (seen.has(item.id)) throw new Error(`Exporter id "${item.id}" is registered more than once.`);
    seen.add(item.id);
  }
  return sorted;
}

/**
 * Vite (tests) replaces `import.meta.glob`. Node and tsx throw, then the
 * directory is read and each sibling is imported. The CLI bundle does neither:
 * `bundledExporters` is already the list.
 */
async function loadFromDirectory(): Promise<ExporterModule[]> {
  let loaders: Record<string, () => Promise<Record<string, unknown>>> | null = null;
  try {
    loaders = import.meta.glob("./*.ts");
  } catch {
    loaders = null;
  }
  const modules: ExporterModule[] = [];
  if (loaders && typeof loaders === "object") {
    for (const [key, load] of Object.entries(loaders)) {
      if (exporterBasenames([key]).length === 0) continue;
      const loaded = await load();
      modules.push(assertExporterModule(loaded.default, key));
    }
    if (modules.length > 0 || Object.keys(loaders).length > 0) return sortModules(modules);
  }

  const names = await readdir(here);
  // A direct import() of a computed path is rewritten by the CLI bundler.
  // The bundle fills bundledExporters instead and does not run this loop.
  const load = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>;
  for (const base of exporterBasenames(names)) {
    const specifier = new URL(`./${base}.js`, import.meta.url).href;
    const loaded = await load(specifier);
    modules.push(assertExporterModule(loaded.default, `${base}.js`));
  }
  return sortModules(modules);
}

let cache: readonly ExporterModule[] | null = null;
let pending: Promise<readonly ExporterModule[]> | null = null;

export function loadedExporterIds(): string[] {
  return cache ? cache.map((item) => item.id) : [];
}

export function loadExporters(): Promise<readonly ExporterModule[]> {
  if (cache) return Promise.resolve(cache);
  if (bundledExporters) {
    cache = sortModules(bundledExporters.map((item) => assertExporterModule(item, item.id)));
    return Promise.resolve(cache);
  }
  pending ??= loadFromDirectory().then((modules) => {
    cache = modules;
    return modules;
  });
  return pending;
}

export async function exporterById(id: string): Promise<ExporterModule | undefined> {
  const modules = await loadExporters();
  return modules.find((item) => item.id === id);
}

export async function listExporterInfo(): Promise<ExporterInfo[]> {
  const modules = await loadExporters();
  return modules.map((item) => ({
    id: item.id,
    name: item.name,
    extension: item.extension,
    mimeType: item.mimeType,
    description: item.description,
  }));
}

export function exporterDirectory(): string {
  return here;
}
