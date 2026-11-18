import path from "node:path";
import type { NetworkDocument } from "../network/types.js";
import {
  assertExportShape,
  fileName,
  mappingForTarget,
  safeLabel,
  sortWarnings,
  zipStore,
} from "./helpers.js";
import { exporterFail } from "./limits.js";
import { exporterById, listExporterInfo, loadExporters } from "./registry.js";
import type { ExportContext, ExporterInfo, ExportFile, ExportWarning } from "./types.js";

export type DesignExport = {
  target: string;
  filename: string;
  text: string;
  files: ExportFile[];
  warnings: ExportWarning[];
  mimeType: string;
  extension: string;
  bytes: number;
  /** Present when the target writes more than one file. */
  archive?: { filename: string; mimeType: string; base64: string };
};

export async function installedExporters(): Promise<ExporterInfo[]> {
  return listExporterInfo();
}

export async function runExport(
  id: string,
  document: NetworkDocument,
  context: ExportContext,
  mappingDocument: unknown = null,
): Promise<DesignExport> {
  const target = id.trim().toLowerCase();
  const exporter = await exporterById(target);
  if (!exporter) {
    const installed = (await loadExporters()).map((item) => item.id);
    const known = installed.length > 0 ? installed.join(", ") : "(none)";
    throw exporterFail(404, `Unknown exporter "${target}". Installed exporters: ${known}.`, "not_found");
  }
  assertExportShape(document);
  const mapping = context.mapping ?? mappingForTarget(mappingDocument, exporter.id);
  let result;
  try {
    result = exporter.export(document, { label: safeLabel(context.label), mapping });
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    const message = err instanceof Error ? err.message : "Export failed.";
    throw exporterFail(400, message);
  }
  if (!result || !Array.isArray(result.files) || result.files.length === 0 || !Array.isArray(result.warnings)) {
    throw exporterFail(500, `Exporter "${exporter.id}" did not return a file.`);
  }
  const files = result.files.map((file) => {
    if (!file || typeof file.name !== "string" || !file.name.trim() || typeof file.text !== "string") {
      throw exporterFail(500, `Exporter "${exporter.id}" returned a file without a name or text.`);
    }
    const name = file.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name || name.split("/").some((part) => part === ".." || part === "")) {
      throw exporterFail(500, `Exporter "${exporter.id}" returned an unsafe file name.`);
    }
    return { name, text: file.text };
  });
  const primary = files[0]!;
  const filename = files.length === 1 ? primary.name : fileName(context.label, "zip");
  const text = primary.text;
  const bytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0);
  const archive =
    files.length > 1
      ? {
          filename,
          mimeType: "application/zip",
          base64: zipStore(files).toString("base64"),
        }
      : undefined;
  return {
    target: exporter.id,
    filename: files.length === 1 ? primary.name : filename,
    text,
    files,
    warnings: sortWarnings(result.warnings),
    mimeType: files.length === 1 ? exporter.mimeType : "application/zip",
    extension: exporter.extension,
    bytes,
    ...(archive ? { archive } : {}),
  };
}

export function outputDirectory(output: string, multiple: boolean): { dir: string; zip: boolean } {
  if (output.toLowerCase().endsWith(".zip")) return { dir: path.dirname(output), zip: true };
  if (multiple) return { dir: output, zip: false };
  return { dir: path.dirname(output), zip: false };
}
