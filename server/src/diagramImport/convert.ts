import { DATA_MAX_CHARS, dataTooLargeMessage } from "../diagramData.js";
import { importLucidCsv, importLucidJson, looksLikeLucidCsv, looksLikeLucidJson } from "./lucid.js";
import { VISIO_BINARY_MESSAGE, type ForeignImport } from "./model.js";
import { importVisio, looksLikeVisioBinary, looksLikeVisioZip } from "./visio.js";

export function convertForeign(name: string, bytes: Uint8Array): ForeignImport {
  if (bytes.length > DATA_MAX_CHARS) return { ok: false, message: dataTooLargeMessage("This file") };
  if (looksLikeVisioBinary(bytes, name)) return { ok: false, message: VISIO_BINARY_MESSAGE };
  if (looksLikeVisioZip(bytes, name)) return importVisio(bytes, name);
  if (hasNull(bytes)) return { ok: false, message: "That file is not a Lucid or Visio diagram." };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (looksLikeLucidJson(value)) return importLucidJson(value);
    } catch {
      return { ok: false, message: "That JSON could not be read." };
    }
  }
  if (looksLikeLucidCsv(text)) return importLucidCsv(text);
  return { ok: false, message: "That file is not a Lucid or Visio diagram." };
}

function hasNull(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 4096);
  for (let index = 0; index < limit; index += 1) if (bytes[index] === 0) return true;
  return false;
}
