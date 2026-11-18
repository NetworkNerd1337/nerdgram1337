import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/paths.js";
import { EXPORTER_INFRA } from "../../src/exporters/infra.js";
import { exporterBasenames, exporterDirectory, loadExporters } from "../../src/exporters/registry.js";

const CORE = [
  "server/src/cli.ts",
  "server/src/v1.ts",
  "server/src/app.ts",
  "server/src/openapi.ts",
  "server/src/openapiShapes.ts",
  "server/src/exporters/registry.ts",
  "server/src/exporters/index.ts",
  "server/src/exporters/run.ts",
  "server/src/exporters/request.ts",
  "server/src/exporters/resolve.ts",
  "server/src/exporters/helpers.ts",
  "server/src/exporters/bundled.ts",
  "server/src/exporters/limits.ts",
  "server/src/exporters/infra.ts",
  "server/src/exporters/types.ts",
  "scripts/build-cli-package.mjs",
];

describe("exporter registry", () => {
  it("discovers one module per file and ignores infrastructure", async () => {
    const modules = await loadExporters();
    const names = fs.readdirSync(exporterDirectory());
    const bases = exporterBasenames(names);
    expect(modules.map((item) => item.id).sort()).toEqual([...bases].sort());
    for (const item of modules) {
      expect(bases).toContain(item.id);
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(item.description.trim().length).toBeGreaterThan(0);
      expect(item.mimeType.trim().length).toBeGreaterThan(0);
      expect(EXPORTER_INFRA).not.toContain(item.id);
    }
    expect(bases.length).toBeGreaterThan(0);
  });

  it("keeps the CLI bundle skip list aligned with the registry", () => {
    const plugin = fs.readFileSync(path.join(REPO_ROOT, "scripts/build-cli-package.mjs"), "utf8");
    const match = /const EXPORTER_INFRA = (\[[^\]]+\])/.exec(plugin);
    expect(match, plugin).toBeTruthy();
    expect(JSON.parse(match?.[1] ?? "[]")).toEqual([...EXPORTER_INFRA]);
  });

  it("does not name an exporter in the core export path", async () => {
    const ids = (await loadExporters()).map((item) => item.id);
    expect(ids.length).toBeGreaterThan(2);
    for (const file of CORE) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const id of ids) {
        expect(text, `${file} names ${id}`).not.toContain(id);
      }
    }
  });
});
