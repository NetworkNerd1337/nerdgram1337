import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  clearDiagramLintCache,
  diagramLintFullPassCount,
  diagramLintParsedCount,
  peekDiagramLintCache,
  resetDiagramLintCounters,
  setDiagramLintAfterRead,
  startDiagramLintScan,
} from "../src/diagramLintCache.js";
import { setWarningsMuted } from "../src/warningMute.js";
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

  const loud = "flowchart LR\n  A[One]\n  classDef spare fill:#eee\n";
  const quiet = "flowchart LR\n  A[One] --> B[Two]\n";
  const json = { Host: HOST, "Content-Type": "application/json" };

  async function put(app: ReturnType<typeof createApp>, filePath: string, content: string, force = false) {
    const saved = await request(app)
      .put("/api/file")
      .set(json)
      .send({ path: filePath, content, ...(force ? { force: true } : {}) });
    expect(saved.status).toBe(200);
  }

  it("reflects mute and unmute in the summary without a full lint", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await put(app, "Loud.mmd", setWarningsMuted(loud, true));
    await put(app, "Quiet.mmd", quiet);
    clearDiagramLintCache();
    const cold = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(cold.status).toBe(200);
    expect(cold.body.muted).toContain("Loud.mmd");
    resetDiagramLintCounters();

    const muted = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(muted.body.stale).toBe(false);
    expect(muted.body.muted).toBe(1);
    expect(muted.body.warnings).toBe(0);
    expect(diagramLintParsedCount()).toBe(0);
    expect(diagramLintFullPassCount()).toBe(0);

    await put(app, "Loud.mmd", loud, true);
    const unmuted = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(unmuted.status).toBe(200);
    expect(unmuted.body.stale).toBe(false);
    expect(unmuted.body.muted).toBe(0);
    const row = (unmuted.body.diagrams as { path: string; warnings: number; muted: boolean }[]).find(
      (item) => item.path === "Loud.mmd",
    );
    expect(row?.warnings).toBeGreaterThan(0);
    expect(row?.muted).toBe(false);
    expect(diagramLintParsedCount()).toBe(1);
    expect(diagramLintFullPassCount()).toBe(0);

    await put(app, "Loud.mmd", setWarningsMuted(loud, true), true);
    const again = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(again.body.stale).toBe(false);
    expect(again.body.muted).toBe(1);
    expect(again.body.warnings).toBe(0);
    expect(
      (again.body.diagrams as { path: string }[]).some((item) => item.path === "Loud.mmd"),
    ).toBe(false);
    expect(diagramLintParsedCount()).toBe(2);
    expect(diagramLintFullPassCount()).toBe(0);
  });

  it("refreshes a parse error and a settings error from the edited file only", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await put(app, "Edited.mmd", quiet);
    await put(app, "Other.mmd", quiet);
    clearDiagramLintCache();
    await request(app).get("/api/diagram-lint").set("Host", HOST);
    resetDiagramLintCounters();

    await put(app, "Edited.mmd", "flowchart LR\n  A -->\n", true);
    const parsed = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(parsed.body.stale).toBe(false);
    expect(
      (parsed.body.diagrams as { path: string; errors: number; parse: boolean }[]).find((item) => item.path === "Edited.mmd"),
    ).toMatchObject({ errors: 1, parse: true });
    expect(diagramLintParsedCount()).toBe(1);
    expect(diagramLintFullPassCount()).toBe(0);

    await put(
      app,
      "Edited.mmd",
      "---\ntitle: Ok\nconfig:\n  theme: [\n---\nflowchart LR\n  A --> B\n",
      true,
    );
    const header = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(
      (header.body.diagrams as { path: string; errors: number; parse: boolean }[]).find((item) => item.path === "Edited.mmd"),
    ).toMatchObject({ errors: 1, parse: false });
    expect(diagramLintParsedCount()).toBe(2);
    expect(diagramLintFullPassCount()).toBe(0);
  });

  it("does not publish a pass that started before a mute", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await put(app, "Loud.mmd", loud);
    await put(app, "Other.mmd", loud);
    clearDiagramLintCache();

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened: () => void = () => undefined;
    const openedGate = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let doneResolve: (value: { status: number; body: { muted?: string[] } }) => void = () => undefined;
    let doneReject: (err: unknown) => void = () => undefined;
    const done = new Promise<{ status: number; body: { muted?: string[] } }>((resolve, reject) => {
      doneResolve = resolve;
      doneReject = reject;
    });
    let used = false;
    setDiagramLintAfterRead(async (filePath) => {
      if (filePath !== "Loud.mmd" || used) return;
      used = true;
      opened();
      await gate;
    });

    const pending = request(app)
      .get("/api/diagram-lint")
      .set("Host", HOST)
      .end((err, res) => {
        if (err) doneReject(err);
        else doneResolve(res);
      });
    void pending;
    await openedGate;
    await put(app, "Loud.mmd", setWarningsMuted(loud, true), true);
    release();
    const pass = await done;
    expect(pass.status).toBe(200);
    setDiagramLintAfterRead(null);

    const peeked = peekDiagramLintCache();
    expect(peeked.stale).toBe(true);
    expect(peeked.entryMuted("Loud.mmd")).not.toBe(false);

    const summary = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(summary.status).toBe(200);
    expect(summary.body.stale).toBe(false);
    expect(summary.body.muted).toBe(1);
    const rows = summary.body.diagrams as { path: string; warnings: number }[];
    expect(rows.find((item) => item.path === "Loud.mmd")?.warnings ?? 0).toBe(0);
    expect(rows.find((item) => item.path === "Other.mmd")?.warnings).toBeGreaterThan(0);
  });

  it("updates the summary after rename and delete without a full lint", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await put(app, "Loud.mmd", loud);
    await put(app, "Quiet.mmd", quiet);
    clearDiagramLintCache();
    await request(app).get("/api/diagram-lint").set("Host", HOST);
    resetDiagramLintCounters();

    const renamed = await request(app).patch("/api/rename").set(json).send({ from: "Loud.mmd", to: "Moved.mmd" });
    expect(renamed.status).toBe(200);
    const afterRename = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(afterRename.body.stale).toBe(false);
    const renamedRows = afterRename.body.diagrams as { path: string; warnings: number }[];
    expect(renamedRows.some((item) => item.path === "Loud.mmd")).toBe(false);
    expect(renamedRows.find((item) => item.path === "Moved.mmd")?.warnings).toBeGreaterThan(0);
    expect(afterRename.body.checked).toBe(2);
    expect(diagramLintFullPassCount()).toBe(0);
    expect(diagramLintParsedCount()).toBe(1);

    const removed = await request(app).delete("/api/item").query({ path: "Moved.mmd" }).set(json);
    expect(removed.status).toBe(204);
    const afterDelete = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(afterDelete.body.stale).toBe(false);
    expect((afterDelete.body.diagrams as { path: string }[]).some((item) => item.path === "Moved.mmd")).toBe(false);
    expect(afterDelete.body.warnings).toBe(0);
    expect(afterDelete.body.checked).toBe(1);
    expect(diagramLintFullPassCount()).toBe(0);
    expect(diagramLintParsedCount()).toBe(1);
  });

  it("re-lints only the edited file in a library of 1000 diagrams", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const body = "flowchart LR\n  A[A] --> B[B]\n";
    const count = 1000;
    for (let start = 0; start < count; start += 50) {
      await Promise.all(
        Array.from({ length: Math.min(50, count - start) }, async (_, offset) => {
          const index = start + offset;
          const folder = path.join(root, `site-${index % 20}`);
          await fs.mkdir(folder, { recursive: true });
          await fs.writeFile(path.join(folder, `diagram-${index}.mmd`), body);
        }),
      );
    }
    clearDiagramLintCache();
    resetDiagramLintCounters();
    const cold = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(cold.status).toBe(200);
    expect(cold.body.checked).toBeGreaterThanOrEqual(count);
    expect(diagramLintParsedCount()).toBeGreaterThanOrEqual(count);
    resetDiagramLintCounters();

    const target = "site-0/diagram-0.mmd";
    await put(app, target, `${body}  classDef spare fill:#fff\n`, true);
    const summary = await request(app).get("/api/diagram-lint/summary").set("Host", HOST);
    expect(summary.status).toBe(200);
    expect(summary.body.stale).toBe(false);
    expect(summary.body.checked).toBeGreaterThanOrEqual(count);
    expect(
      (summary.body.diagrams as { path: string; warnings: number }[]).find((item) => item.path === target)?.warnings,
    ).toBeGreaterThan(0);
    expect(diagramLintParsedCount()).toBe(1);
    expect(diagramLintFullPassCount()).toBe(0);
  }, 180_000);

  it("picks up an outside edit on the startup scan and skips it the next time", async () => {
    createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await fs.writeFile(path.join(root, "Outside.mmd"), loud);
    clearDiagramLintCache();
    resetDiagramLintCounters();
    await startDiagramLintScan();
    expect(diagramLintParsedCount()).toBe(1);
    const summary = await request(createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] }))
      .get("/api/diagram-lint/summary")
      .set("Host", HOST);
    expect(summary.body.status).toBe("ready");
    expect(
      (summary.body.diagrams as { path: string; warnings: number }[]).find((item) => item.path === "Outside.mmd")
        ?.warnings,
    ).toBeGreaterThan(0);
    resetDiagramLintCounters();
    await startDiagramLintScan();
    expect(diagramLintParsedCount()).toBe(0);
    expect(diagramLintFullPassCount()).toBe(1);
  });
});
