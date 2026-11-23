import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { bundledMermaidVersion, mermaidEngineLabel, mermaidEngineReleaseUrl } from "../src/lib/mermaidVersion";

const require = createRequire(import.meta.url);

describe("mermaid engine version", () => {
  it("reads the installed mermaid package and hides a missing version", () => {
    const installed = (require("mermaid/package.json") as { version: string }).version;
    expect(bundledMermaidVersion()).toBe(installed);
    expect(mermaidEngineLabel()).toBe(`Mermaid ${installed}`);
    expect(mermaidEngineReleaseUrl()).toBe(
      `https://github.com/mermaid-js/mermaid/releases/tag/${encodeURIComponent(`mermaid@${installed}`)}`,
    );
    expect(mermaidEngineLabel("12.3.0-beta.1")).toBe("Mermaid 12.3.0-beta.1");
    expect(mermaidEngineLabel("")).toBeNull();
    expect(mermaidEngineLabel("   ")).toBeNull();
    expect(mermaidEngineLabel(null)).toBeNull();
    expect(mermaidEngineLabel("unknown")).toBeNull();
    expect(mermaidEngineReleaseUrl("not a version")).toBeNull();

    const about = readFileSync(new URL("../src/components/UpdateHost.tsx", import.meta.url), "utf8");
    expect(about).not.toContain(`Mermaid ${installed}`);
    expect(about).toContain("mermaidEngineLabel()");
  });
});
