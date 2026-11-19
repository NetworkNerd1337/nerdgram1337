import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { clearDiagramLintCache } from "../src/diagramLintCache.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function diagram(name: string, extra = ""): string {
  return `flowchart LR\n  ${name}[${name}]\n  ${name} --> Next${extra}\n`;
}

describe("diagram lint cache", () => {
  let cleanup = async () => {};
  let root = "";

  beforeEach(async () => {
    clearDiagramLintCache();
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    root = temp.dir;
  });

  afterEach(async () => {
    clearDiagramLintCache();
    await cleanup();
  });

  it("re-parses nothing on a warm pass and only the edited file after a write", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await request(app).put("/api/file").set("Host", HOST).send({ path: "A.mmd", content: diagram("A") });
    await request(app).put("/api/file").set("Host", HOST).send({ path: "B.mmd", content: diagram("B") });
    clearDiagramLintCache();
    const cold = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(cold.status).toBe(200);
    expect(cold.body.relinted).toBe(2);
    const warm = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(warm.body.relinted).toBe(0);
    expect(warm.body.diagrams).toEqual(cold.body.diagrams);
    await request(app).put("/api/file").set("Host", HOST).send({ path: "A.mmd", content: diagram("A", "\n  click A \"nerdgram:Missing.mmd\""), force: true });
    const edited = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(edited.body.relinted).toBe(1);
    expect(JSON.stringify(edited.body.diagrams)).toContain("broken-click");
  });

  it("picks up an edit made outside the app", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await request(app).put("/api/file").set("Host", HOST).send({ path: "Outside.mmd", content: diagram("Outside") });
    clearDiagramLintCache();
    await request(app).get("/api/diagram-lint").set("Host", HOST);
    const file = path.join(root, "Outside.mmd");
    const next = `${diagram("Outside")}\n  click Outside "nerdgram:Gone.mmd"\n`;
    await fs.writeFile(file, next);
    const later = new Date(Date.now() + 2000);
    await fs.utimes(file, later, later);
    const again = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(again.body.relinted).toBe(1);
    expect(JSON.stringify(again.body.diagrams)).toContain("broken-click");
  });

  it("shares one pass across concurrent requests", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await request(app).put("/api/file").set("Host", HOST).send({ path: "Slow.mmd", content: diagram("Slow") });
    clearDiagramLintCache();
    const [first, second] = await Promise.all([
      request(app).get("/api/diagram-lint").set("Host", HOST),
      request(app).get("/api/diagram-lint").set("Host", HOST),
    ]);
    expect(first.body.relinted).toBe(second.body.relinted);
    expect(first.body.cachedAt).toBe(second.body.cachedAt);
  });

  it("marks a syntax error in the summary and leaves a broken header unmarked", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await request(app).put("/api/file").set("Host", HOST).send({ path: "Bad.mmd", content: "flowchart LR\n  A -->\n" });
    await request(app)
      .put("/api/file")
      .set("Host", HOST)
      .send({ path: "Header.mmd", content: "---\ntitle: Ok\nconfig:\n  theme: [\n---\nflowchart LR\n  A --> B\n" });
    clearDiagramLintCache();
    await request(app).get("/api/diagram-lint").set("Host", HOST);
    const summary = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(summary.status).toBe(200);
    const rows = summary.body.diagrams as { path: string; errors: number; parse: boolean; muted: boolean }[];
    expect(rows.find((row) => row.path === "Bad.mmd")).toMatchObject({ errors: 1, parse: true, muted: false });
    expect(rows.find((row) => row.path === "Header.mmd")).toMatchObject({ errors: 1, parse: false, muted: false });
  });

  it("returns not checked yet from the summary until a pass runs", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const before = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(before.body.status).toBe("not-checked");
    expect(before.body.checked).toBeNull();
    expect(before.body.errors).toBeNull();
    await request(app).put("/api/file").set("Host", HOST).send({ path: "One.mmd", content: diagram("One") });
    clearDiagramLintCache();
    await request(app).get("/api/diagram-lint").set("Host", HOST);
    const after = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(after.body.status).toBe("ready");
    expect(after.body.checked).toBeGreaterThan(0);
    expect(typeof after.body.checkedAt).toBe("string");
  });

  it("keeps a warm pass much faster than a cold pass on a generated library", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const body = `flowchart LR\n${Array.from({ length: 40 }, (_, index) => `  n${index}[Node ${index}] --> n${(index + 1) % 40}`).join("\n")}\n`;
    await Promise.all(
      Array.from({ length: 300 }, (_, index) => {
        const folder = `site-${index % 12}`;
        return request(app)
          .put("/api/file")
          .set("Host", HOST)
          .send({ path: `${folder}/diagram-${index}.mmd`, content: body });
      }),
    );
    clearDiagramLintCache();
    const cold = await request(app).get("/api/diagram-lint").set("Host", HOST);
    const warm = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(cold.body.checked).toBeGreaterThanOrEqual(300);
    expect(warm.body.relinted).toBe(0);
    expect(warm.body.diagrams).toEqual(cold.body.diagrams);
    const line = `lint timings cold=${cold.body.durationMs}ms warm=${warm.body.durationMs}ms relinted=${warm.body.relinted}`;
    console.info(line);
    await fs.writeFile(path.join(os.tmpdir(), "nerdgram-lint-timings.txt"), `${line}\n`);
    if (cold.body.durationMs >= 50) {
      expect(warm.body.durationMs * 10).toBeLessThanOrEqual(cold.body.durationMs);
    }
  });
});
