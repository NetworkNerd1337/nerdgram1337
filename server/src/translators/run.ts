import { parse as parseYaml } from "yaml";
import { validateNetwork } from "../network/validate.js";
import { publishDocument, sortWarnings } from "./helpers.js";
import { translatorFail } from "./limits.js";
import { listTranslatorInfo, loadTranslators, translatorById } from "./registry.js";
import type { CanonicalDocument, TranslatorInfo, TranslatorResult, TranslatorWarning } from "./types.js";

export type ConvertedExport = {
  source: string;
  document: CanonicalDocument;
  warnings: TranslatorWarning[];
};

export function parseExport(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw translatorFail(400, "The export is empty.");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // A saved testbed can be YAML. The API body is still JSON.
  }
  try {
    const parsed = parseYaml(trimmed) as unknown;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Fall through to the same error a non-JSON file already gets.
  }
  throw translatorFail(400, "The export is not valid JSON.");
}

export async function convertExport(id: string, input: unknown): Promise<ConvertedExport> {
  const source = id.trim().toLowerCase();
  const translator = await translatorById(source);
  if (!translator) {
    const installed = (await loadTranslators()).map((item) => item.id);
    const known = installed.length > 0 ? installed.join(", ") : "(none)";
    throw translatorFail(404, `Unknown translator "${source}". Installed translators: ${known}.`, "not_found");
  }
  let result: TranslatorResult;
  try {
    result = translator.convert(input);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    const message = err instanceof Error ? err.message : "Convert failed.";
    throw translatorFail(400, message);
  }
  if (!result || typeof result !== "object" || !Array.isArray(result.warnings)) {
    throw translatorFail(500, `Translator "${translator.id}" did not return a document.`);
  }
  const validated = validateNetwork(result.document);
  if (!validated.document) {
    throw translatorFail(500, `Translator "${translator.id}" produced a document that does not match the network schema.`, "invalid");
  }
  return {
    source: translator.id,
    document: publishDocument(validated.document),
    warnings: sortWarnings(result.warnings),
  };
}

export async function installedTranslators(): Promise<TranslatorInfo[]> {
  return listTranslatorInfo();
}
