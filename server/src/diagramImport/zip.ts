import { inflateRawSync } from "node:zlib";
import { DATA_MAX_CHARS, dataTooLargeMessage } from "../diagramData.js";

/** Enough for a multi-page drawing with masters, rels, and content types. Not a size cap. */
export const MAX_ZIP_ENTRIES = 512;

export type ZipEntry = { name: string; bytes: Uint8Array };

/**
 * Read a zip from its local file headers and stop at the central directory.
 * A normal Visio file has both. Uncompressed bytes stop at the same 4 MiB
 * limit as other diagram input. Paths that leave the archive are refused.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > DATA_MAX_CHARS) {
    throw new Error(dataTooLargeMessage("This file"));
  }
  const entries: ZipEntry[] = [];
  let offset = 0;
  let uncompressed = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart + compressedSize > bytes.length) {
      throw new Error("This Visio file is not a complete zip archive.");
    }
    if (entries.length >= MAX_ZIP_ENTRIES) {
      throw new Error(`This Visio file has more than ${MAX_ZIP_ENTRIES} entries.`);
    }
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    const name = safeZipName(new TextDecoder("utf-8", { fatal: false }).decode(nameBytes));
    if (!name) throw new Error("This Visio file contains an unsafe path.");
    if ((flags & 0x1) !== 0) throw new Error("This Visio file is encrypted.");
    if ((flags & 0x8) !== 0 && compressedSize === 0) {
      throw new Error("This Visio file stores entry sizes after the data.");
    }
    if (uncompressedSize > DATA_MAX_CHARS || compressedSize > DATA_MAX_CHARS) {
      throw new Error(dataTooLargeMessage("This Visio file"));
    }
    if (uncompressed + uncompressedSize > DATA_MAX_CHARS) {
      throw new Error(dataTooLargeMessage("This Visio file"));
    }
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const inflated = inflateEntry(method, compressed, uncompressedSize);
    if (inflated.length > uncompressedSize && uncompressedSize > 0) {
      throw new Error(dataTooLargeMessage("This Visio file"));
    }
    uncompressed += inflated.length;
    if (uncompressed > DATA_MAX_CHARS) throw new Error(dataTooLargeMessage("This Visio file"));
    entries.push({ name, bytes: inflated });
    offset = dataStart + compressedSize;
  }
  if (entries.length === 0) throw new Error("This Visio file is not a zip archive.");
  return entries;
}

function inflateEntry(method: number, compressed: Uint8Array, uncompressedSize: number): Uint8Array {
  if (method === 0) return compressed;
  if (method !== 8) throw new Error("This Visio file uses a zip compression this importer does not read.");
  const inflated = inflateRawSync(compressed);
  if (uncompressedSize > 0 && inflated.length > uncompressedSize) {
    throw new Error(dataTooLargeMessage("This Visio file"));
  }
  return inflated;
}

export function safeZipName(name: string): string | null {
  const normalized = name.replace(/\\/g, "/").replace(/^\uFEFF/, "");
  if (!normalized || normalized.length > 240) return null;
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === ".." || part === "." || part.includes("\0"))) return null;
  return parts.join("/");
}
