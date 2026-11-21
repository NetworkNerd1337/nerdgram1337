import { DATA_LIMITS } from "../diagramData.js";

/**
 * Design export reads network JSON that already fits a diagram.
 * The ceiling is the generate file cap, plus the node and edge caps.
 */
export const EXPORT_MAX_INPUT_BYTES = DATA_LIMITS.maxChars;
export const EXPORT_MAX_DEVICES = DATA_LIMITS.maxNodes;
export const EXPORT_MAX_LINKS = DATA_LIMITS.maxEdges;

export function exporterFail(status: number, message: string, code = "invalid"): Error {
  return Object.assign(new Error(message), { status, code });
}

export function assertExportInputSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw exporterFail(400, "The network document size is not valid.");
  }
  if (bytes > EXPORT_MAX_INPUT_BYTES) {
    throw exporterFail(413, "The network document is larger than 4 MiB.", "too_large");
  }
}
