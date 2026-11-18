import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { expect } from "vitest";
import { importDiagramData } from "../src/diagramData.js";
import { validateNetwork } from "../src/network/validate.js";
import { REPO_ROOT } from "../src/paths.js";
import type { CanonicalDocument } from "../src/translators/types.js";

const require = createRequire(import.meta.url);

export function translatorFixture(source: string, name: string): unknown {
  const file = path.join(REPO_ROOT, "docs/samples/translators", source, name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

export function assertCanonical(document: unknown): void {
  const { default: Ajv2020 } = require("ajv/dist/2020.js") as {
    default: new (options?: { allErrors?: boolean; strict?: boolean }) => {
      compile(schema: unknown): (data: unknown) => boolean;
      errorsText(): string;
    };
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "docs/schema/network.schema.json"), "utf8")) as unknown;
  const validate = ajv.compile(schema);
  expect(validate(document), ajv.errorsText()).toBe(true);
  const issues = validateNetwork(document).issues;
  expect(issues, JSON.stringify(issues)).toEqual([]);
}

export function assertViews(document: CanonicalDocument): { l3: string; l2: string } {
  const text = JSON.stringify(document);
  const l3 = importDiagramData({ text, format: "network", view: "l3", sourceFile: "convert.network.json" });
  const l2 = importDiagramData({ text, format: "network", view: "l2", sourceFile: "convert.network.json" });
  expect(l3.errors, JSON.stringify(l3.errors)).toEqual([]);
  expect(l2.errors, JSON.stringify(l2.errors)).toEqual([]);
  return { l3: l3.mermaid, l2: l2.mermaid };
}
