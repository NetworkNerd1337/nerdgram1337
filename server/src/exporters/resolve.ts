import fs from "node:fs/promises";
import path from "node:path";
import { readDataSource } from "../diagramData.js";
import { validateNetwork } from "../network/validate.js";
import type { NetworkDocument } from "../network/types.js";
import { assertExportInputSize, exporterFail } from "./limits.js";
import { parseMappingText } from "./helpers.js";

export function labelFromPath(filePath: string): string {
  const base = path.basename(filePath);
  return base.replace(/\.network\.json$/i, "").replace(/\.mmd$/i, "") || "nerdgram";
}

export function parseNetworkDocument(text: string): NetworkDocument {
  assertExportInputSize(Buffer.byteLength(text));
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw exporterFail(400, "The network document is empty.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw exporterFail(400, "The network document is not valid JSON.");
  }
  const validated = validateNetwork(parsed);
  if (!validated.document) {
    const first = validated.issues[0];
    const where = first?.path ? `${first.path}: ` : "";
    throw exporterFail(400, `${where}${first?.message ?? "The network document does not match the schema."}`);
  }
  return validated.document;
}

/**
 * Prefer `nerdgram.source` when that path is a `.network.json`.
 * Otherwise the same stem beside the diagram. CSV, generic JSON, CDP, and
 * LLDP are not enough.
 */
export function siblingNetworkPath(diagramPath: string, content: string): { kind: "recorded" | "stem"; path: string } {
  const source = readDataSource(content);
  if (source?.file && source.file.toLowerCase().endsWith(".network.json")) {
    return { kind: "recorded", path: source.file };
  }
  const stem = labelFromPath(diagramPath);
  const dir = path.posix.dirname(diagramPath.split(path.sep).join("/"));
  const name = `${stem}.network.json`;
  const next = !dir || dir === "." ? name : `${dir}/${name}`;
  return { kind: "stem", path: next };
}

export async function readNetworkFile(filePath: string): Promise<{ document: NetworkDocument; label: string }> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    throw exporterFail(400, `Could not read ${filePath}.`);
  }
  return { document: parseNetworkDocument(text), label: labelFromPath(filePath) };
}

export async function readDiagramNetwork(
  diagramPath: string,
  readText: (filePath: string) => Promise<string>,
): Promise<{ document: NetworkDocument; label: string }> {
  let content: string;
  try {
    content = await readText(diagramPath);
  } catch {
    throw exporterFail(400, `Could not read ${diagramPath}.`);
  }
  const sibling = siblingNetworkPath(diagramPath, content);
  let text: string;
  try {
    text = await readText(sibling.path);
  } catch {
    if (sibling.kind === "recorded") {
      throw exporterFail(400, `The diagram records network JSON at ${sibling.path}, and that file is not there.`);
    }
    throw exporterFail(400, "This diagram has no network JSON.");
  }
  return { document: parseNetworkDocument(text), label: labelFromPath(diagramPath) };
}

export async function readMappingFile(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, "utf8");
  return parseMappingText(text);
}
