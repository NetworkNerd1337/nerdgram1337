import { importInputFromBody, type CreateGeneratedInput } from "../diagramDataFiles.js";
import { isRecord } from "./helpers.js";
import { assertConvertInputSize, translatorFail } from "./limits.js";
import { convertExport, parseExport, type ConvertedExport } from "./run.js";

const UPSERT_KEYS = ["path", "view", "includeDown", "vlan", "groupBy", "direction", "title", "storeData", "dataName", "grouping"] as const;

export type PreparedConvert = {
  body: ConvertedExport;
  upsert?: CreateGeneratedInput;
};

function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * The body is the export. `input` or `text` wraps it when `path` or `view`
 * asks for an upsert. Query `path` and `view` do the same for a raw file body.
 */
export async function prepareConvert(options: {
  source: string;
  body: unknown;
  query?: Record<string, unknown>;
  bytes: number;
  canWrite: boolean;
}): Promise<PreparedConvert> {
  assertConvertInputSize(options.bytes);
  const query = options.query ?? {};
  const queryPath = queryString(query.path)?.trim();
  const queryView = queryString(query.view)?.trim();
  const record = isRecord(options.body) ? options.body : null;
  const bodySignal = record != null && UPSERT_KEYS.some((key) => hasOwn(record, key) && record[key] != null);
  const signal = Boolean(queryPath || queryView || bodySignal);

  let input: unknown = options.body;
  let fields: Record<string, unknown> = {};
  if (record && signal && hasOwn(record, "input")) {
    input = record.input;
    fields = record;
  } else if (record && signal && typeof record.text === "string") {
    input = parseExport(record.text);
    fields = record;
  }

  const pathValue = queryPath || (typeof fields.path === "string" ? fields.path.trim() : "");
  const view = queryView || (typeof fields.view === "string" ? fields.view.trim() : "");
  if ((pathValue || view) && !options.canWrite) {
    throw translatorFail(403, "This token cannot write.", "forbidden");
  }
  if (pathValue || view) {
    if (!pathValue) throw translatorFail(400, "path is required.");
    if (view !== "l3" && view !== "l2") throw translatorFail(400, "view must be l3 or l2.");
  }

  const converted = await convertExport(options.source, input);
  if (!pathValue) return { body: converted };

  const includeDown = fields.includeDown;
  const vlan = fields.vlan;
  const groupBy = typeof fields.groupBy === "string" ? fields.groupBy : queryString(query.groupBy);
  const direction = typeof fields.direction === "string" ? fields.direction : undefined;
  const title = typeof fields.title === "string" ? fields.title : undefined;
  const storeData = typeof fields.storeData === "boolean" ? fields.storeData : undefined;
  const dataName = typeof fields.dataName === "string" ? fields.dataName : undefined;
  const grouping = typeof fields.grouping === "boolean" ? fields.grouping : undefined;
  const imported = importInputFromBody({
    text: JSON.stringify(converted.document),
    format: "network",
    view,
    ...(includeDown != null ? { includeDown } : {}),
    ...(vlan != null ? { vlan } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(direction ? { direction } : {}),
    ...(title ? { title } : {}),
    ...(grouping != null ? { grouping } : {}),
  });
  const upsert: CreateGeneratedInput = { ...imported, path: pathValue };
  if (storeData != null) upsert.storeData = storeData;
  if (dataName != null) upsert.dataName = dataName;
  return { body: converted, upsert };
}
