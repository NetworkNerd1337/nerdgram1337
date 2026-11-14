/**
 * Opens the workspace find-and-replace dialog from the dashboard, the command
 * palette, or the editor find bar. The editor's own replace stays on the
 * current diagram; this only opens the dialog.
 */

export type ReplaceMatchWarning = "node-id" | "click-target" | "path";

export type ReplaceMatchPreview = {
  id: string;
  line: number;
  column: number;
  before: string;
  after: string;
  matchStart: number;
  matchLength: number;
  replaceLength: number;
  contextBefore: string | null;
  contextAfter: string | null;
  warnings: ReplaceMatchWarning[];
  selected: boolean;
};

export type ReplaceFilePreview = {
  path: string;
  hash: string;
  mtimeMs: number;
  matchCount: number;
  shownCount: number;
  truncated: boolean;
  selected: boolean;
  generated: boolean;
  dataFile: string | null;
  generatedWarning: string | null;
  lint: { invalid: boolean; newlyInvalid: boolean; messages: string[] };
  matches: ReplaceMatchPreview[];
};

export type ReplacePreview = {
  find: string;
  replace: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeFrontMatter: boolean;
  scope: { folder: string | null; recursive: boolean; paths: string[] | null };
  totals: { replacements: number; diagrams: number; shown: number };
  truncated: boolean;
  message: string | null;
  excluded: { path: string; reason: string }[];
  files: ReplaceFilePreview[];
};

export type ReplaceApplyResult = {
  operationId: string | null;
  changed: { path: string; revisionId: string; hash: string; replacements: number }[];
  skipped: { path: string; reason: string }[];
  errors: { path: string; message: string }[];
  totals: { diagrams: number; replacements: number };
};

export type ReplaceUndoResult = {
  id: string;
  restored: { path: string; hash: string }[];
  skipped: { path: string; reason: string }[];
  errors: { path: string; message: string }[];
};

export type ReplaceSeed = {
  find?: string;
  replace?: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  folder?: string;
};

type Opener = (seed: ReplaceSeed) => void;

let opener: Opener | null = null;
let currentFolder = "";

export function bindWorkspaceReplace(fn: Opener | null): void {
  opener = fn;
}

export function setWorkspaceReplaceFolder(folder: string): void {
  currentFolder = folder;
}

export function workspaceReplaceFolder(): string {
  return currentFolder;
}

export function openWorkspaceReplace(seed: ReplaceSeed = {}): void {
  opener?.({ ...seed, folder: seed.folder ?? currentFolder });
}
