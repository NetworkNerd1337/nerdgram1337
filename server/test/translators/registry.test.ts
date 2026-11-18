import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/paths.js";
import { TRANSLATOR_INFRA } from "../../src/translators/infra.js";
import { loadTranslators, translatorBasenames, translatorDirectory } from "../../src/translators/registry.js";

const CORE = [
  "server/src/cli.ts",
  "server/src/v1.ts",
  "server/src/app.ts",
  "server/src/openapi.ts",
  "server/src/openapiShapes.ts",
  "server/src/translators/registry.ts",
  "server/src/translators/index.ts",
  "server/src/translators/run.ts",
  "server/src/translators/request.ts",
  "server/src/translators/helpers.ts",
  "server/src/translators/bundled.ts",
  "server/src/translators/limits.ts",
  "server/src/translators/infra.ts",
  "server/src/translators/types.ts",
  "scripts/build-cli-package.mjs",
];

describe("translator registry", () => {
  it("discovers one module per file and ignores infrastructure", async () => {
    const modules = await loadTranslators();
    const names = fs.readdirSync(translatorDirectory());
    const bases = translatorBasenames(names);
    expect(modules.map((item) => item.id)).toEqual(bases);
    for (const item of modules) {
      expect(bases).toContain(item.id);
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(item.formatHint.trim().length).toBeGreaterThan(0);
      expect(item.placeholder.trim().length).toBeGreaterThan(0);
      expect(TRANSLATOR_INFRA).not.toContain(item.id);
    }
    expect(bases.length).toBeGreaterThan(0);
  });

  it("keeps the CLI bundle skip list aligned with the registry", () => {
    const plugin = fs.readFileSync(path.join(REPO_ROOT, "scripts/build-cli-package.mjs"), "utf8");
    const match = /const TRANSLATOR_INFRA = (\[[^\]]+\])/.exec(plugin);
    expect(match, plugin).toBeTruthy();
    expect(JSON.parse(match?.[1] ?? "[]")).toEqual([...TRANSLATOR_INFRA]);
  });

  it("does not name a translator in the core convert path", async () => {
    const ids = (await loadTranslators()).map((item) => item.id);
    expect(ids).toContain("netbox");
    expect(ids).toContain("librenms");
    for (const file of CORE) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const id of ids) {
        expect(text, `${file} names ${id}`).not.toContain(id);
      }
    }
  });
});
