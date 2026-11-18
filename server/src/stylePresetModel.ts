import {
  ELK_NODE_PLACEMENTS,
  FLOWCHART_CURVES,
  MERMAID_LAYOUTS,
  MERMAID_LOOKS,
  MERMAID_THEMES,
  applyDiagramPatch,
  parseDiagram,
  type ApplyResult,
  type DiagramDocument,
  type Scalar,
} from "./frontMatter.js";

/**
 * A style preset is a named copy of the style fields in Diagram info.
 * Applying one writes those values into the diagram file. The file does not
 * store the preset id, so the diagram still renders after the preset is
 * edited or deleted.
 */

export const STYLE_PRESET_VERSION = 1;
export const MAX_PRESETS = 100;
export const MAX_PRESET_NAME = 80;
export const MAX_FONT_FAMILY = 300;
export const MAX_THEME_CSS = 20_000;
export const MAX_THEME_VARIABLES = 80;
export const MAX_VARIABLE_VALUE = 200;

const PRESET_ID = /^sp[a-f0-9]{16}$/;
const VARIABLE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,80}$/;
const TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;

const DOCUMENT_KEYS = new Set(["version", "defaultId", "presets"]);
const PRESET_KEYS = new Set(["id", "name", "style"]);
const STYLE_KEYS = new Set([
  "theme",
  "look",
  "handDrawnSeed",
  "layout",
  "fontFamily",
  "themeVariables",
  "themeCSS",
  "flowchartCurve",
  "elk",
  "displayMode",
]);
const ELK_KEYS = new Set(["mergeEdges", "nodePlacementStrategy"]);
const CREATE_KEYS = new Set(["name", "style", "default"]);
const UPDATE_KEYS = new Set(["name", "style", "default"]);
const IMPORT_KEYS = new Set(["version", "defaultId", "presets", "mode"]);

const THEMES = new Set<string>(MERMAID_THEMES);
const LOOKS = new Set<string>(MERMAID_LOOKS);
const LAYOUTS = new Set<string>(MERMAID_LAYOUTS);
const CURVES = new Set<string>(FLOWCHART_CURVES);
const PLACEMENTS = new Set<string>(ELK_NODE_PLACEMENTS);

const NAMED_COLORS = new Set(
  `black white red blue green gray grey orange yellow purple navy teal silver maroon olive lime aqua fuchsia cyan magenta brown pink gold beige coral crimson indigo khaki lavender magenta midnightblue seagreen skyblue slategray tomato turquoise violet wheat transparent`
    .split(/\s+/),
);

export type ElkStyle = {
  mergeEdges: boolean | null;
  nodePlacementStrategy: string | null;
};

export type StyleSnapshot = {
  theme: string | null;
  look: string | null;
  handDrawnSeed: number | null;
  layout: string | null;
  fontFamily: string | null;
  themeVariables: Record<string, Exclude<Scalar, null>>;
  themeCSS: string | null;
  flowchartCurve: string | null;
  elk: ElkStyle;
  displayMode: string | null;
};

export type StylePreset = {
  id: string;
  name: string;
  style: StyleSnapshot;
};

export type StylePresetDocument = {
  version: 1;
  defaultId: string | null;
  presets: StylePreset[];
};

export type StyleChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type WorkspaceColor = {
  color: string;
  count: number;
};

export type Swatch = {
  color: string;
  count: number;
  source: "workspace" | "recent";
};

export function emptyStyle(): StyleSnapshot {
  return {
    theme: null,
    look: null,
    handDrawnSeed: null,
    layout: null,
    fontFamily: null,
    themeVariables: {},
    themeCSS: null,
    flowchartCurve: null,
    elk: { mergeEdges: null, nodePlacementStrategy: null },
    displayMode: null,
  };
}

export function emptyStyleDocument(): StylePresetDocument {
  return { version: STYLE_PRESET_VERSION, defaultId: null, presets: [] };
}

export function stylePresetError(message: string, status = 400, code = "invalid"): Error {
  return Object.assign(new Error(message), { status, code });
}

export function isPresetId(value: string): boolean {
  return PRESET_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw stylePresetError(`Unknown field "${key}" on ${label}.`);
  }
}

function optionalString(value: unknown, name: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw stylePresetError(`${name} must be a string or null.`);
  if (value.length > max) throw stylePresetError(`${name} is too long.`);
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function oneOf(value: unknown, allowed: Set<string>, name: string): string | null {
  const text = optionalString(value, name, 80);
  if (text == null) return null;
  if (!allowed.has(text)) throw stylePresetError(`${name} "${text}" is not one of the accepted values.`);
  return text;
}

function readSeed(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw stylePresetError("handDrawnSeed must be an integer or null.");
  }
  if (Math.abs(value) > 1_000_000_000) throw stylePresetError("handDrawnSeed is out of range.");
  return value;
}

function readThemeVariables(value: unknown): Record<string, Exclude<Scalar, null>> {
  if (value == null) return {};
  if (!isRecord(value)) throw stylePresetError("themeVariables must be an object.");
  const keys = Object.keys(value);
  if (keys.length > MAX_THEME_VARIABLES) throw stylePresetError("themeVariables has too many fields.");
  const out: Record<string, Exclude<Scalar, null>> = {};
  for (const key of keys) {
    if (!VARIABLE_KEY.test(key)) throw stylePresetError(`Theme variable "${key}" is not a valid name.`);
    const item = value[key];
    if (item == null || item === "") continue;
    if (typeof item === "string") {
      if (item.length > MAX_VARIABLE_VALUE) throw stylePresetError(`Theme variable "${key}" is too long.`);
      out[key] = item;
      continue;
    }
    if (typeof item === "boolean") {
      out[key] = item;
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      out[key] = item;
      continue;
    }
    throw stylePresetError(`Theme variable "${key}" must be a string, number, or boolean.`);
  }
  return out;
}

function readElk(value: unknown): ElkStyle {
  if (value == null) return { mergeEdges: null, nodePlacementStrategy: null };
  if (!isRecord(value)) throw stylePresetError("elk must be an object.");
  rejectUnknown(value, ELK_KEYS, "elk");
  let mergeEdges: boolean | null = null;
  if (value.mergeEdges != null) {
    if (typeof value.mergeEdges !== "boolean") throw stylePresetError("elk.mergeEdges must be a boolean or null.");
    mergeEdges = value.mergeEdges;
  }
  return {
    mergeEdges,
    nodePlacementStrategy: oneOf(value.nodePlacementStrategy, PLACEMENTS, "elk.nodePlacementStrategy"),
  };
}

function readToken(value: unknown, name: string): string | null {
  const text = optionalString(value, name, 40);
  if (text == null) return null;
  if (!TOKEN.test(text)) throw stylePresetError(`${name} "${text}" is not one of the accepted values.`);
  return text;
}

export function parseStyleSnapshot(value: unknown): StyleSnapshot {
  if (!isRecord(value)) throw stylePresetError("style must be an object.");
  rejectUnknown(value, STYLE_KEYS, "style");
  const fontFamily = optionalString(value.fontFamily, "fontFamily", MAX_FONT_FAMILY);
  const themeCSS = value.themeCSS == null ? null : optionalString(value.themeCSS, "themeCSS", MAX_THEME_CSS);
  return {
    theme: oneOf(value.theme, THEMES, "theme"),
    look: oneOf(value.look, LOOKS, "look"),
    handDrawnSeed: readSeed(value.handDrawnSeed),
    layout: oneOf(value.layout, LAYOUTS, "layout"),
    fontFamily,
    themeVariables: readThemeVariables(value.themeVariables),
    themeCSS,
    flowchartCurve: oneOf(value.flowchartCurve, CURVES, "flowchartCurve"),
    elk: readElk(value.elk),
    displayMode: readToken(value.displayMode, "displayMode"),
  };
}

export function readPresetName(value: unknown): string {
  if (typeof value !== "string") throw stylePresetError("name must be a string.");
  const name = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) throw stylePresetError("name is required.");
  if (name.length > MAX_PRESET_NAME) throw stylePresetError("name is too long.");
  if (/[<>:"|?*\\/]/.test(name)) throw stylePresetError("name cannot include : \\ * ? \" < > |.");
  return name;
}

export function parseCreateBody(value: unknown): { name: string; style: StyleSnapshot; setDefault: boolean } {
  if (!isRecord(value)) throw stylePresetError("JSON object required.");
  rejectUnknown(value, CREATE_KEYS, "preset");
  if (!("name" in value) || !("style" in value)) throw stylePresetError("name and style are required.");
  let setDefault = false;
  if ("default" in value) {
    if (typeof value.default !== "boolean") throw stylePresetError("default must be a boolean.");
    setDefault = value.default;
  }
  return { name: readPresetName(value.name), style: parseStyleSnapshot(value.style), setDefault };
}

export function parseUpdateBody(value: unknown): { name?: string; style?: StyleSnapshot; setDefault?: boolean } {
  if (!isRecord(value)) throw stylePresetError("JSON object required.");
  rejectUnknown(value, UPDATE_KEYS, "preset");
  const patch: { name?: string; style?: StyleSnapshot; setDefault?: boolean } = {};
  if ("name" in value) patch.name = readPresetName(value.name);
  if ("style" in value) patch.style = parseStyleSnapshot(value.style);
  if ("default" in value) {
    if (typeof value.default !== "boolean") throw stylePresetError("default must be a boolean.");
    patch.setDefault = value.default;
  }
  if (!("name" in patch) && !("style" in patch) && !("setDefault" in patch)) {
    throw stylePresetError("name, style, or default is required.");
  }
  return patch;
}

export type ImportPreset = {
  id: string | null;
  name: string;
  style: StyleSnapshot;
};

export function parseImportBody(value: unknown): {
  mode: "add" | "replace";
  defaultId: string | null;
  presets: ImportPreset[];
} {
  if (!isRecord(value)) throw stylePresetError("JSON object required.");
  rejectUnknown(value, IMPORT_KEYS, "import");
  if (value.version !== STYLE_PRESET_VERSION) throw stylePresetError("version must be 1.");
  if (!Array.isArray(value.presets)) throw stylePresetError("presets must be an array.");
  if (value.presets.length > MAX_PRESETS) throw stylePresetError("That file has too many presets.");
  let mode: "add" | "replace" = "add";
  if ("mode" in value && value.mode != null) {
    if (value.mode !== "add" && value.mode !== "replace") throw stylePresetError("mode must be add or replace.");
    mode = value.mode;
  }
  let defaultId: string | null = null;
  if ("defaultId" in value && value.defaultId != null) {
    if (typeof value.defaultId !== "string" || !isPresetId(value.defaultId)) {
      throw stylePresetError("defaultId must be a preset id or null.");
    }
    defaultId = value.defaultId;
  }
  const presets: ImportPreset[] = value.presets.map((item) => {
    if (!isRecord(item)) throw stylePresetError("Each preset must be an object.");
    rejectUnknown(item, PRESET_KEYS, "preset");
    if (!("name" in item) || !("style" in item)) throw stylePresetError("Each preset needs a name and a style.");
    let id: string | null = null;
    if ("id" in item && item.id != null) {
      if (typeof item.id !== "string" || !isPresetId(item.id)) throw stylePresetError("preset id is not valid.");
      id = item.id;
    }
    return { id, name: readPresetName(item.name), style: parseStyleSnapshot(item.style) };
  });
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const preset of presets) {
    const key = preset.name.toLowerCase();
    if (names.has(key)) throw stylePresetError(`The name "${preset.name}" is used more than once.`);
    names.add(key);
    if (preset.id) {
      if (ids.has(preset.id)) throw stylePresetError("That preset id is used more than once.");
      ids.add(preset.id);
    }
  }
  return { mode, defaultId, presets };
}

export function parseStyleDocument(value: unknown): StylePresetDocument {
  if (!isRecord(value)) throw stylePresetError("Style presets could not be read.", 500);
  rejectUnknown(value, DOCUMENT_KEYS, "style presets");
  if (value.version !== STYLE_PRESET_VERSION) throw stylePresetError("Style presets could not be read.", 500);
  if (!Array.isArray(value.presets)) throw stylePresetError("Style presets could not be read.", 500);
  const parsed = parseImportBody({
    version: STYLE_PRESET_VERSION,
    defaultId: value.defaultId ?? null,
    presets: value.presets,
    mode: "replace",
  });
  const presets: StylePreset[] = [];
  const ids = new Set<string>();
  for (const preset of parsed.presets) {
    if (!preset.id || ids.has(preset.id)) throw stylePresetError("Style presets could not be read.", 500);
    ids.add(preset.id);
    presets.push({ id: preset.id, name: preset.name, style: preset.style });
  }
  if (parsed.defaultId && !ids.has(parsed.defaultId)) {
    throw stylePresetError("Style presets could not be read.", 500);
  }
  return { version: STYLE_PRESET_VERSION, defaultId: parsed.defaultId, presets };
}

function finiteSeed(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value) ? value : null;
}

function storedVariables(value: Record<string, Scalar>): Record<string, Exclude<Scalar, null>> {
  const out: Record<string, Exclude<Scalar, null>> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!VARIABLE_KEY.test(key) || item == null || item === "") continue;
    if (typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) {
      out[key] = item;
    }
  }
  return out;
}

/** The style fields currently stored on a diagram. Invalid values are kept so a save can reject them. */
export function styleFromDiagram(doc: DiagramDocument): StyleSnapshot {
  const mergeEdges = doc.elk.mergeEdges;
  const placement = doc.elk.nodePlacementStrategy;
  return {
    theme: doc.theme,
    look: doc.look,
    handDrawnSeed: finiteSeed(doc.handDrawnSeed),
    layout: doc.layout,
    fontFamily: doc.fontFamily?.trim() ? doc.fontFamily.trim() : null,
    themeVariables: storedVariables(doc.themeVariables),
    themeCSS: doc.themeCSS?.trim() ? doc.themeCSS : null,
    flowchartCurve: doc.flowchartCurve,
    elk: {
      mergeEdges: typeof mergeEdges === "boolean" ? mergeEdges : null,
      nodePlacementStrategy: typeof placement === "string" ? placement : null,
    },
    displayMode: doc.displayMode,
  };
}

/**
 * Copy every style field into the file. Fields the preset leaves unset are
 * cleared, so the diagram matches the preset. Title, description, notes,
 * tags, and the diagram body stay as they are.
 */
export function applyStyleToSource(source: string, style: StyleSnapshot): ApplyResult {
  const parsed = parseDiagram(source);
  if (parsed.malformed) {
    return {
      ok: false,
      error: parsed.error || "The YAML header could not be parsed.",
      source,
    };
  }
  const themeVariables: Record<string, Scalar | null> = {};
  for (const key of Object.keys(parsed.themeVariables)) themeVariables[key] = null;
  for (const [key, value] of Object.entries(style.themeVariables)) themeVariables[key] = value;
  // Deleting a nested key whose parent map is absent throws. Only clear keys
  // the file already has, and only set the ones the preset names.
  const elk: Record<string, Scalar | null> = {};
  for (const key of Object.keys(parsed.elk)) elk[key] = null;
  if (style.elk.mergeEdges != null) elk.mergeEdges = style.elk.mergeEdges;
  if (style.elk.nodePlacementStrategy) elk.nodePlacementStrategy = style.elk.nodePlacementStrategy;
  return applyDiagramPatch(source, {
    theme: style.theme,
    look: style.look,
    handDrawnSeed: style.handDrawnSeed,
    layout: style.layout,
    fontFamily: style.fontFamily,
    themeCSS: style.themeCSS,
    displayMode: style.displayMode,
    themeVariables,
    ...(style.flowchartCurve || parsed.flowchartCurve ? { flowchartCurve: style.flowchartCurve } : {}),
    ...(Object.keys(elk).length > 0 ? { elk } : {}),
  });
}

/** `null` leaves the source byte for byte unchanged. */
export function contentWithStyle(source: string, style: StyleSnapshot | null): string {
  if (!style) return source;
  const result = applyStyleToSource(source, style);
  if (!result.ok) throw stylePresetError(result.error);
  return result.source;
}

function show(value: unknown): string {
  if (value == null || value === "") return "default";
  if (typeof value === "boolean") return value ? "on" : "off";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "default";
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

function pushChange(changes: StyleChange[], field: string, label: string, before: unknown, after: unknown): void {
  const from = show(before);
  const to = show(after);
  if (from === to) return;
  changes.push({ field, label, before: from, after: to });
}

/** What Apply will change. The list is empty when the file already matches the preset. */
export function styleChanges(current: DiagramDocument, next: StyleSnapshot): StyleChange[] {
  const changes: StyleChange[] = [];
  pushChange(changes, "theme", "Theme", current.theme, next.theme);
  pushChange(changes, "look", "Look", current.look, next.look);
  pushChange(changes, "handDrawnSeed", "Hand-drawn seed", current.handDrawnSeed, next.handDrawnSeed);
  pushChange(changes, "layout", "Layout", current.layout, next.layout);
  pushChange(changes, "fontFamily", "Font family", current.fontFamily, next.fontFamily);
  pushChange(changes, "displayMode", "Gantt display", current.displayMode, next.displayMode);
  pushChange(changes, "flowchartCurve", "Flowchart curve", current.flowchartCurve, next.flowchartCurve);
  pushChange(changes, "themeCSS", "Theme CSS", current.themeCSS, next.themeCSS);
  pushChange(
    changes,
    "elk.mergeEdges",
    "Merge edges",
    typeof current.elk.mergeEdges === "boolean" ? current.elk.mergeEdges : null,
    next.elk.mergeEdges,
  );
  pushChange(
    changes,
    "elk.nodePlacementStrategy",
    "Node placement",
    typeof current.elk.nodePlacementStrategy === "string" ? current.elk.nodePlacementStrategy : null,
    next.elk.nodePlacementStrategy,
  );
  const variableKeys = new Set([...Object.keys(current.themeVariables), ...Object.keys(next.themeVariables)]);
  for (const key of [...variableKeys].sort((a, b) => a.localeCompare(b))) {
    pushChange(changes, `themeVariables.${key}`, key, current.themeVariables[key] ?? null, next.themeVariables[key] ?? null);
  }
  return changes;
}

const COLOR_KEY = /color|bkg|background|fill|stroke|border/i;

export function canonicalColor(value: string): string | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex) {
    const digits = hex[1].toLowerCase();
    const full = digits.length <= 4 ? digits.split("").map((char) => char + char).join("") : digits;
    return `#${full}`;
  }
  const fn = /^(rgba?|hsla?)\(\s*([^)]{1,80})\s*\)$/i.exec(text);
  if (fn) {
    const body = fn[2].replace(/\s+/g, "");
    if (!/^[\d.%/,]+$/.test(body)) return null;
    return `${fn[1].toLowerCase()}(${body})`;
  }
  const named = text.toLowerCase();
  if (NAMED_COLORS.has(named)) return named;
  return null;
}

export function isColorField(key: string, value: Scalar | undefined): boolean {
  if (typeof value === "boolean" || typeof value === "number") return false;
  if (COLOR_KEY.test(key)) return true;
  if (typeof value === "string" && canonicalColor(value)) return true;
  return false;
}

const STYLE_COLOR =
  /(?:fill|stroke|color|background)\s*[:=]\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)\n]{1,40}\)|hsla?\([^)\n]{1,40}\)|[A-Za-z]{3,20})/g;

/** Colors in theme variables and in fill, stroke, color, and background assignments. */
export function colorsInDiagram(doc: DiagramDocument): string[] {
  const found = new Set<string>();
  for (const value of Object.values(doc.themeVariables)) {
    if (typeof value !== "string") continue;
    const color = canonicalColor(value);
    if (color) found.add(color);
  }
  const body = `${doc.body}\n${doc.themeCSS ?? ""}`;
  for (const match of body.matchAll(STYLE_COLOR)) {
    const color = canonicalColor(match[1] ?? "");
    if (color) found.add(color);
  }
  return [...found];
}

export function swatchColors(
  workspace: readonly WorkspaceColor[],
  recent: readonly string[],
  limit = 12,
): Swatch[] {
  const rows: Swatch[] = [];
  const seen = new Set<string>();
  for (const item of workspace) {
    if (rows.length >= limit) break;
    const color = canonicalColor(item.color);
    if (!color || seen.has(color)) continue;
    seen.add(color);
    rows.push({ color, count: item.count, source: "workspace" });
  }
  let added = 0;
  for (const item of recent) {
    if (added >= 8) break;
    const color = canonicalColor(item);
    if (!color || seen.has(color)) continue;
    seen.add(color);
    rows.push({ color, count: 0, source: "recent" });
    added += 1;
  }
  return rows;
}

export function initialPresetId(
  mode: "create" | "template",
  doc: { defaultId: string | null; presets: readonly { id: string }[] },
): string {
  if (mode === "template") return "";
  if (doc.defaultId && doc.presets.some((preset) => preset.id === doc.defaultId)) return doc.defaultId;
  return "";
}

export function copyPresetName(name: string, taken: readonly string[]): string {
  const base = `Copy of ${name}`.slice(0, MAX_PRESET_NAME);
  const used = new Set(taken.map((item) => item.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let index = 2; index < 100; index += 1) {
    const suffix = ` ${index}`;
    const candidate = `${base.slice(0, MAX_PRESET_NAME - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}
