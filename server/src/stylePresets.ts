import { randomBytes } from "node:crypto";
import { getStylePresetsPath } from "./paths.js";
import { atomicWriteJson, httpFail, readJsonFile } from "./storage.js";
import {
  MAX_PRESETS,
  STYLE_PRESET_VERSION,
  emptyStyleDocument,
  isPresetId,
  parseCreateBody,
  parseImportBody,
  parseStyleDocument,
  parseUpdateBody,
  stylePresetError,
  type StylePreset,
  type StylePresetDocument,
  type StyleSnapshot,
} from "./stylePresetModel.js";

/**
 * Named style presets live in `<data>/.meta/style-presets.json`.
 * The diagram tree, search, lint, and trash skip `.meta`. Editing or
 * deleting a preset does not read or write any `.mmd` file.
 */

let pending: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = pending.then(fn, fn);
  pending = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function newPresetId(): string {
  return `sp${randomBytes(8).toString("hex")}`;
}

function failFrom(err: unknown): never {
  if (err && typeof err === "object" && "status" in err) throw err;
  throw httpFail(500, "Style presets could not be read.", "invalid");
}

async function readDocument(): Promise<StylePresetDocument> {
  let parsed: unknown;
  try {
    parsed = await readJsonFile<unknown>(getStylePresetsPath());
  } catch {
    throw httpFail(500, "Style presets could not be read.", "invalid");
  }
  if (parsed == null) return emptyStyleDocument();
  try {
    return parseStyleDocument(parsed);
  } catch (err) {
    failFrom(err);
  }
}

async function writeDocument(doc: StylePresetDocument): Promise<StylePresetDocument> {
  const next = normalizeDocument(doc);
  await atomicWriteJson(getStylePresetsPath(), {
    version: STYLE_PRESET_VERSION,
    defaultId: next.defaultId,
    presets: next.presets,
  });
  return next;
}

function normalizeDocument(doc: StylePresetDocument): StylePresetDocument {
  return parseStyleDocument({
    version: STYLE_PRESET_VERSION,
    defaultId: doc.defaultId,
    presets: doc.presets,
  });
}

function nameTaken(presets: readonly StylePreset[], name: string, exceptId?: string): boolean {
  const key = name.toLowerCase();
  return presets.some((preset) => preset.id !== exceptId && preset.name.toLowerCase() === key);
}

function requirePreset(doc: StylePresetDocument, id: string): StylePreset {
  if (!isPresetId(id)) throw httpFail(400, "preset id is not valid.", "invalid");
  const preset = doc.presets.find((item) => item.id === id);
  if (!preset) throw httpFail(404, "That style preset was not found.", "not_found");
  return preset;
}

export async function listStylePresets(): Promise<StylePresetDocument> {
  return readDocument();
}

export async function createStylePreset(input: unknown): Promise<StylePresetDocument & { preset: StylePreset }> {
  return exclusive(async () => {
    const body = parseCreateBody(input);
    const doc = await readDocument();
    if (doc.presets.length >= MAX_PRESETS) throw httpFail(400, "The preset list is full.", "invalid");
    if (nameTaken(doc.presets, body.name)) {
      throw httpFail(409, `A preset named "${body.name}" already exists.`, "exists");
    }
    const preset: StylePreset = { id: newPresetId(), name: body.name, style: body.style };
    const next = await writeDocument({
      version: STYLE_PRESET_VERSION,
      defaultId: body.setDefault ? preset.id : doc.defaultId,
      presets: [...doc.presets, preset],
    });
    return { ...next, preset };
  });
}

export async function updateStylePreset(
  id: string,
  input: unknown,
): Promise<StylePresetDocument & { preset: StylePreset }> {
  return exclusive(async () => {
    const patch = parseUpdateBody(input);
    const doc = await readDocument();
    const current = requirePreset(doc, id);
    if (patch.name && nameTaken(doc.presets, patch.name, id)) {
      throw httpFail(409, `A preset named "${patch.name}" already exists.`, "exists");
    }
    const preset: StylePreset = {
      id: current.id,
      name: patch.name ?? current.name,
      style: patch.style ?? current.style,
    };
    let defaultId = doc.defaultId;
    if (patch.setDefault === true) defaultId = preset.id;
    if (patch.setDefault === false && defaultId === preset.id) defaultId = null;
    const next = await writeDocument({
      version: STYLE_PRESET_VERSION,
      defaultId,
      presets: doc.presets.map((item) => (item.id === id ? preset : item)),
    });
    return { ...next, preset };
  });
}

export async function deleteStylePreset(id: string): Promise<StylePresetDocument> {
  return exclusive(async () => {
    const doc = await readDocument();
    requirePreset(doc, id);
    return writeDocument({
      version: STYLE_PRESET_VERSION,
      defaultId: doc.defaultId === id ? null : doc.defaultId,
      presets: doc.presets.filter((item) => item.id !== id),
    });
  });
}

export async function importStylePresets(input: unknown): Promise<StylePresetDocument> {
  return exclusive(async () => {
    const body = parseImportBody(input);
    const doc = await readDocument();
    if (body.mode === "replace") return writeDocument(assignImported(body.presets, body.defaultId, true));
    if (doc.presets.length + body.presets.length > MAX_PRESETS) {
      throw httpFail(400, "The preset list is full.", "invalid");
    }
    const names = new Set(doc.presets.map((preset) => preset.name.toLowerCase()));
    for (const preset of body.presets) {
      if (names.has(preset.name.toLowerCase())) {
        throw httpFail(409, `A preset named "${preset.name}" already exists.`, "exists");
      }
      names.add(preset.name.toLowerCase());
    }
    const added = assignImported(body.presets, body.defaultId, false);
    return writeDocument({
      version: STYLE_PRESET_VERSION,
      defaultId: body.defaultId ? added.defaultId : doc.defaultId,
      presets: [...doc.presets, ...added.presets],
    });
  });
}

function assignImported(
  presets: { id: string | null; name: string; style: StyleSnapshot }[],
  defaultId: string | null,
  keepIds: boolean,
): StylePresetDocument {
  const used = new Set<string>();
  const assigned: StylePreset[] = [];
  const originalToAssigned = new Map<string, string>();
  for (const preset of presets) {
    let id = keepIds && preset.id && !used.has(preset.id) ? preset.id : newPresetId();
    while (used.has(id)) id = newPresetId();
    used.add(id);
    if (preset.id) originalToAssigned.set(preset.id, id);
    assigned.push({ id, name: preset.name, style: preset.style });
  }
  let nextDefault: string | null = null;
  if (defaultId) {
    nextDefault = originalToAssigned.get(defaultId) ?? null;
    if (!nextDefault) throw stylePresetError("defaultId does not match a preset in the file.");
  }
  return { version: STYLE_PRESET_VERSION, defaultId: nextDefault, presets: assigned };
}

export function publicDocument(doc: StylePresetDocument): StylePresetDocument {
  return {
    version: doc.version,
    defaultId: doc.defaultId,
    presets: doc.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      style: preset.style,
    })),
  };
}
