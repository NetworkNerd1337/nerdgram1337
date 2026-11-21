import { applyDiagramPatch } from "./frontMatter";
import { api } from "../api";
import {
  diagramFileName,
  recognizeImport,
  type ImportAction,
  type ImportKind,
} from "./importRecognize";

export const MAX_IMPORT_FILE_CHARS = 512 * 1024;
/** Lucid and Visio files use the same 4 MiB cap as From data. */
export const FOREIGN_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_FILES = 25;

export type ImportPageDraft = {
  id: string;
  title: string;
  text: string;
  warnings: string[];
  nodes: number;
};

export type ImportHubLayout = "" | "compact" | "radial";

export type ImportCollisionChoice = "rename" | "skip" | "replace";

export type ImportDraft = {
  id: string;
  sourceName: string;
  text: string;
  diagramName: string;
  error?: string;
  formatLabel?: string;
  kind?: ImportKind;
  route?: Extract<ImportAction, "from-data" | "style-presets">;
  dataFormat?: "" | "csv" | "json" | "cdp" | "lldp" | "network" | "route";
  suggestFromData?: boolean;
  pages?: ImportPageDraft[];
  pageChoice?: "all" | string;
  hubLayout?: ImportHubLayout;
  warnings?: string[];
};

export type ImportUnit = {
  id: string;
  draftId: string;
  sourceName: string;
  diagramName: string;
  text: string;
  warnings: string[];
  nodes: number;
};

export async function draftsFromFiles(files: File[]): Promise<ImportDraft[]> {
  const drafts: ImportDraft[] = [];
  for (const file of files) {
    const id = `${drafts.length}-${file.name}-${file.size}`;
    if (file.size > FOREIGN_IMPORT_MAX_BYTES) {
      drafts.push({
        id,
        sourceName: file.name,
        text: "",
        diagramName: "",
        error: "This file is larger than 4 MiB.",
      });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const found = recognizeImport(file.name, bytes);
    if (found.action === "convert") {
      drafts.push(await draftFromForeign(id, file.name, bytes, found.label, found.kind));
      continue;
    }
    if (bytes.length > MAX_IMPORT_FILE_CHARS) {
      drafts.push({
        id,
        sourceName: file.name,
        text: "",
        diagramName: "",
        error: "This file is larger than 512 KB.",
      });
      continue;
    }
    if (found.action === "diagram") {
      drafts.push({
        id,
        sourceName: file.name,
        text: found.diagramText,
        diagramName: diagramFileName(file.name),
        formatLabel: found.label,
        kind: found.kind,
      });
      continue;
    }
    if (found.action === "from-data" || found.action === "style-presets") {
      drafts.push({
        id,
        sourceName: file.name,
        text: new TextDecoder().decode(bytes),
        diagramName: "",
        formatLabel: found.label,
        kind: found.kind,
        route: found.action,
        dataFormat: found.dataFormat,
      });
      continue;
    }
    drafts.push({
      id,
      sourceName: file.name,
      text: "",
      diagramName: "",
      error: found.message,
      formatLabel: found.kind === "unknown" ? undefined : found.label,
      kind: found.kind,
      suggestFromData: true,
    });
  }
  return drafts;
}

async function draftFromForeign(
  id: string,
  sourceName: string,
  bytes: Uint8Array,
  label: string,
  kind: ImportKind | undefined,
): Promise<ImportDraft> {
  try {
    const converted = await api.importForeign(sourceName, bytes);
    const pages: ImportPageDraft[] = converted.pages.map((page) => ({
      id: page.id,
      title: page.title,
      text: page.mermaid,
      warnings: page.warnings,
      nodes: page.nodes,
    }));
    const only = pages.length === 1 ? pages[0] : undefined;
    return {
      id,
      sourceName,
      text: only?.text ?? "",
      diagramName: only ? diagramFileName(sourceName) : "",
      formatLabel: label,
      kind,
      pages,
      pageChoice: pages.length > 1 ? "all" : only?.id,
      hubLayout: "",
      warnings: only?.warnings ?? [],
    };
  } catch (err) {
    return {
      id,
      sourceName,
      text: "",
      diagramName: "",
      error: err instanceof Error ? err.message : "Could not import that file.",
      formatLabel: label,
      kind,
    };
  }
}

export function unitsFromDraft(draft: ImportDraft): ImportUnit[] {
  if (draft.error || draft.route) return [];
  const pages = draft.pages ?? [];
  if (pages.length === 0) {
    if (!draft.text.trim() || !draft.diagramName) return [];
    return [
      {
        id: draft.id,
        draftId: draft.id,
        sourceName: draft.sourceName,
        diagramName: draft.diagramName,
        text: withHub(draft.text, draft.hubLayout),
        warnings: draft.warnings ?? [],
        nodes: 0,
      },
    ];
  }
  const chosen = draft.pageChoice && draft.pageChoice !== "all" ? pages.filter((page) => page.id === draft.pageChoice) : pages;
  const many = chosen.length > 1;
  return chosen.map((page) => ({
    id: `${draft.id}:${page.id}`,
    draftId: draft.id,
    sourceName: many ? `${draft.sourceName} (${page.title})` : draft.sourceName,
    diagramName: many ? pageDiagramName(draft.sourceName, page.title) : diagramFileName(draft.sourceName),
    text: withHub(page.text, draft.hubLayout),
    warnings: page.warnings,
    nodes: page.nodes,
  }));
}

function pageDiagramName(sourceName: string, title: string): string {
  const base = diagramFileName(sourceName).replace(/\.mmd$/i, "");
  const safeTitle = title.trim() || "Page";
  return diagramFileName(`${base} - ${safeTitle}.txt`);
}

function withHub(text: string, hubLayout: ImportHubLayout | undefined): string {
  if (hubLayout !== "compact" && hubLayout !== "radial") return text;
  const patched = applyDiagramPatch(text, { hubLayout });
  return patched.ok ? patched.source : text;
}
