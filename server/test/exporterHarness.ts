import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { expect } from "vitest";
import { REPO_ROOT } from "../src/paths.js";
import { runExport } from "../src/exporters/run.js";
import { parseNetworkDocument } from "../src/exporters/resolve.js";
import type { DesignExport } from "../src/exporters/run.js";
import type { NetworkDocument } from "../src/network/types.js";

export function campusDocument(): NetworkDocument {
  const file = path.join(REPO_ROOT, "docs/samples/network/campus.network.json");
  return parseNetworkDocument(fs.readFileSync(file, "utf8"));
}

export function exportCampus(target: string, label = "campus"): Promise<DesignExport> {
  return runExport(target, campusDocument(), { label, mapping: null });
}

export function yamlDoc(text: string): unknown {
  const stripped = text.replace(/^#.*\n/gm, "").replace(/<!--[\s\S]*?-->/g, "");
  return parseYaml(stripped);
}

export function commandExists(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function expectNoSecrets(text: string): void {
  expect(text).not.toMatch(/password:\s*(?!CHANGE_ME)\S+/i);
  expect(text).not.toContain("lab\n");
  expect(text.toLowerCase()).not.toContain("secret123");
}

export function offlineExport(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = execFileSync(process.execPath, ["--import", "tsx", "server/src/cli.ts", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NERDGRAM_TOKEN: "" },
  });
  return { status: 0, stdout: result, stderr: "" };
}
