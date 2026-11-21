import {
  diagramFileName,
  recognizeImport,
  type ImportAction,
  type ImportKind,
} from "./importRecognize";

export const MAX_IMPORT_FILE_CHARS = 512 * 1024;
export const MAX_IMPORT_FILES = 25;

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
  dataFormat?: "" | "csv" | "json" | "cdp" | "lldp" | "network";
  suggestFromData?: boolean;
};

export async function draftsFromFiles(files: File[]): Promise<ImportDraft[]> {
  const drafts: ImportDraft[] = [];
  for (const file of files) {
    const id = `${drafts.length}-${file.name}-${file.size}`;
    if (file.size > MAX_IMPORT_FILE_CHARS) {
      drafts.push({
        id,
        sourceName: file.name,
        text: "",
        diagramName: "",
        error: "This file is larger than 512 KB.",
      });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
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
    const found = recognizeImport(file.name, bytes);
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
