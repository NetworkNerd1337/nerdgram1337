import { isRecord, mappingRowsFromUnknown } from "./helpers.js";
import { assertExportInputSize, exporterFail } from "./limits.js";
import { labelFromPath, parseNetworkDocument, readDiagramNetwork } from "./resolve.js";
import { runExport, type DesignExport } from "./run.js";
import type { MappingRow } from "./types.js";

export type PreparedExport = DesignExport;

function own(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * The body is the network document, `{ "input": <document> }`, or
 * `{ "path": "Campus-L3.mmd" }` / `{ "path": "campus.network.json" }`.
 * `mapping` is an optional array of rows, or a whole mapping document.
 */
export async function prepareExport(options: {
  target: string;
  body: unknown;
  bytes: number;
  readText?: (filePath: string) => Promise<string>;
}): Promise<PreparedExport> {
  assertExportInputSize(options.bytes);
  const record = isRecord(options.body) ? options.body : null;
  let label = "nerdgram";
  let mapping: MappingRow[] | null = null;
  let mappingDocument: unknown = null;
  if (record && own(record, "mapping")) {
    if (Array.isArray(record.mapping)) mapping = mappingRowsFromUnknown(record.mapping);
    else mappingDocument = record.mapping;
  }
  if (record && typeof record.label === "string" && record.label.trim()) label = record.label.trim();

  let document;
  if (record && typeof record.path === "string" && record.path.trim()) {
    const filePath = record.path.trim();
    if (!options.readText) throw exporterFail(400, "path is only valid for a workspace file.");
    if (filePath.toLowerCase().endsWith(".mmd")) {
      const loaded = await readDiagramNetwork(filePath, options.readText);
      document = loaded.document;
      label = loaded.label;
    } else if (filePath.toLowerCase().endsWith(".network.json")) {
      const text = await options.readText(filePath).catch(() => {
        throw exporterFail(400, `Could not read ${filePath}.`);
      });
      document = parseNetworkDocument(text);
      label = labelFromPath(filePath);
    } else {
      throw exporterFail(400, "path must be a diagram or a .network.json file.");
    }
  } else if (record && own(record, "input")) {
    document = parseNetworkDocument(JSON.stringify(record.input));
  } else {
    document = parseNetworkDocument(JSON.stringify(options.body));
  }

  return runExport(options.target, document, { label, mapping }, mappingDocument);
}
