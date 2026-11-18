import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/paths.js";

const PHRASES = [
  "Nerd",
  "Gram",
  "If it isn't diagrammed,",
  "it's just a rumor.",
  "Code-first network diagrams in Mermaid. Local, versioned, and fed by your real data.",
  "Local-first",
  "NetBox · LibreNMS · pyATS",
  "Docker · npm",
  "github.com/NetworkNerd1337/NerdGram1337",
];

describe("social preview", () => {
  it("is a 1280 by 640 PNG under 1 MB, and the generator is not shipped", () => {
    const file = path.join(REPO_ROOT, "docs/images/social-preview.png");
    const bytes = fs.readFileSync(file);
    expect(bytes.length).toBeGreaterThan(8);
    expect(bytes.length).toBeLessThan(1_000_000);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(1280);
    expect(bytes.readUInt32BE(20)).toBe(640);

    const script = fs.readFileSync(path.join(REPO_ROOT, "scripts/make-social-preview.py"), "utf8");
    for (const phrase of PHRASES) expect(script).toContain(phrase);
    expect(script).toContain("networknerd1337.jpg");

    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).not.toContain("make-social-preview.py");
    const ignore = fs.readFileSync(path.join(REPO_ROOT, ".dockerignore"), "utf8");
    expect(ignore).toContain("scripts/make-social-preview.py");
    const cli = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "cli/package.json"), "utf8")) as { files?: string[] };
    expect(cli.files ?? []).not.toContain("scripts");
    expect((cli.files ?? []).join("\n")).not.toContain("make-social-preview");
  });
});
