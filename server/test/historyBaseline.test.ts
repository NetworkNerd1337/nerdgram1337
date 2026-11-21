import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { main } from "../src/cli.js";
import { closeRenderer } from "../src/renderDiagram.js";
import { REVISION_RETENTION, encodeStorageKey, getVersionsRoot } from "../src/storage.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function makeApp() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

const json = {
  Host: HOST,
  "Content-Type": "application/json",
};

type Saved = { path: string; mtimeMs: number; hash: string; content: string };

describe("named baselines and revision diffs", () => {
  let dir = "";
  let cleanup = async () => {};
  const app = makeApp();

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    delete process.env.NERDGRAM_BASELINE_CAP;
    await cleanup();
  });

  async function writeNew(filePath: string, content: string): Promise<Saved> {
    const res = await request(app).put("/api/file").set(json).send({ path: filePath, content });
    expect(res.status).toBe(200);
    return { path: res.body.path, mtimeMs: res.body.mtimeMs, hash: res.body.hash, content };
  }

  async function writeNext(saved: Saved, content: string): Promise<Saved> {
    const res = await request(app).put("/api/file").set(json).send({
      path: saved.path,
      content,
      expectedMtimeMs: saved.mtimeMs,
      expectedHash: saved.hash,
    });
    expect(res.status).toBe(200);
    return { path: res.body.path, mtimeMs: res.body.mtimeMs, hash: res.body.hash, content };
  }

  it("names, renames, and removes a baseline, and can save the current diagram", async () => {
    let saved = await writeNew("Net.mmd", "flowchart LR\n  A[One] --> B[Two]\n");
    saved = await writeNext(saved, "flowchart LR\n  A[One] --> B[Two]\n  B --> C[Three]\n");
    const listed = await request(app).get("/api/history").query({ path: "Net.mmd" }).set("Host", HOST);
    expect(listed.body.baselineCap).toBe(20);
    expect(listed.body.revisions).toHaveLength(1);
    expect(listed.body.revisions[0].name).toBeNull();
    expect(listed.body.revisions[0].note).toBeNull();

    const named = await request(app).post("/api/history/baseline").set(json).send({
      path: "Net.mmd",
      id: listed.body.revisions[0].id,
      name: "Baseline - pre-change CHG-1234",
      note: "Before the cutover",
    });
    expect(named.status).toBe(201);
    expect(named.body.name).toBe("Baseline - pre-change CHG-1234");
    expect(named.body.note).toBe("Before the cutover");

    const renamed = await request(app).patch("/api/history/baseline").set(json).send({
      path: "Net.mmd",
      id: named.body.id,
      name: "Baseline - after review",
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Baseline - after review");
    expect(renamed.body.note).toBe("Before the cutover");

    const current = await request(app).post("/api/history/baseline").set(json).send({
      path: "Net.mmd",
      name: "Current snapshot",
    });
    expect(current.status).toBe(201);
    const live = await fs.readFile(path.join(dir, "Net.mmd"), "utf8");
    expect(live).toBe(saved.content);
    const read = await request(app)
      .get("/api/history/revision")
      .query({ path: "Net.mmd", id: current.body.id })
      .set("Host", HOST);
    expect(read.body.content).toBe(saved.content);
    expect(read.body.name).toBe("Current snapshot");

    const removed = await request(app).delete("/api/history/baseline").set(json).send({
      path: "Net.mmd",
      id: renamed.body.id,
    });
    expect(removed.status).toBe(200);
    expect(removed.body.pruned).toBe(false);
    expect(removed.body.revision.name).toBeNull();

    const bare = await request(app)
      .post("/api/history/baseline")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("{\"path\":\"Net.mmd\",\"name\":\"Nope\"}");
    expect(bare.status).toBe(415);
  });

  it("reads an older revision index that has no baseline fields", async () => {
    await writeNew("Old.mmd", "flowchart LR\n  A --> B\n");
    const versionDir = path.join(getVersionsRoot(), encodeStorageKey("Old.mmd"));
    await fs.mkdir(versionDir, { recursive: true });
    await fs.writeFile(path.join(versionDir, "legacy.mmd"), "flowchart LR\n  A --> B\n");
    await fs.writeFile(
      path.join(versionDir, "index.json"),
      JSON.stringify({
        path: "Old.mmd",
        revisions: [{ id: "legacy", createdAt: "2020-01-01T00:00:00.000Z", mtimeMs: 1, size: 22, hash: "abc" }],
      }),
    );
    const history = await request(app).get("/api/history").query({ path: "Old.mmd" }).set("Host", HOST);
    expect(history.status).toBe(200);
    const legacy = history.body.revisions.find((revision: { id: string }) => revision.id === "legacy");
    expect(legacy).toMatchObject({ name: null, note: null, namedAt: null });
    const read = await request(app).get("/api/history/revision").query({ path: "Old.mmd", id: "legacy" }).set("Host", HOST);
    expect(read.status).toBe(200);
    expect(read.body.content).toContain("A --> B");
    expect(read.body.name).toBeNull();
  });

  it("keeps named baselines when unnamed revisions are pruned and states the cap", async () => {
    let saved = await writeNew("Cap.mmd", "flowchart LR\n  A --> B\n");
    const first = await request(app).post("/api/history/baseline").set(json).send({
      path: "Cap.mmd",
      name: "Keep me",
    });
    expect(first.status).toBe(201);
    for (let n = 1; n <= REVISION_RETENTION + 2; n += 1) {
      saved = await writeNext(saved, `flowchart LR\n  A --> B\n  %% ${n}\n`);
    }
    const history = await request(app).get("/api/history").query({ path: "Cap.mmd" }).set("Host", HOST);
    expect(history.body.revisions.some((revision: { id: string; name: string | null }) => revision.id === first.body.id && revision.name === "Keep me")).toBe(true);
    const unnamed = history.body.revisions.filter((revision: { name: string | null }) => !revision.name);
    expect(unnamed.length).toBeLessThanOrEqual(REVISION_RETENTION);

    process.env.NERDGRAM_BASELINE_CAP = "1";
    const blocked = await request(app).post("/api/history/baseline").set(json).send({
      path: "Cap.mmd",
      name: "Second",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("baseline_limit");
    expect(blocked.body.error).toMatch(/already has 1 named baseline/);
    expect(blocked.body.error).toMatch(/limit/);
    expect(blocked.body.baselineCap).toBe(1);

    const still = await request(app).get("/api/history").query({ path: "Cap.mmd" }).set("Host", HOST);
    expect(still.body.baselineCount).toBe(1);
    expect(still.body.revisions.filter((revision: { name: string | null }) => revision.name === "Second")).toHaveLength(0);
  });

  it("follows a baseline across rename, move, and trash, and deletes it permanently", async () => {
    await writeNew("Lab/Core.mmd", "flowchart LR\n  A --> B\n");
    const baseline = await request(app).post("/api/history/baseline").set(json).send({
      path: "Lab/Core.mmd",
      name: "Site baseline",
      note: "Keep",
    });
    expect(baseline.status).toBe(201);

    const renamed = await request(app).patch("/api/rename").set(json).send({
      from: "Lab/Core.mmd",
      to: "Lab/Edge.mmd",
    });
    expect(renamed.status).toBe(200);
    const afterRename = await request(app).get("/api/history").query({ path: "Lab/Edge.mmd" }).set("Host", HOST);
    expect(afterRename.body.revisions[0]).toMatchObject({ name: "Site baseline", note: "Keep" });
    const old = await request(app).get("/api/history").query({ path: "Lab/Core.mmd" }).set("Host", HOST);
    expect(old.body.revisions).toEqual([]);

    const moved = await request(app).post("/api/move").set(json).send({ from: "Lab/Edge.mmd", toFolder: "" });
    expect(moved.status).toBe(200);
    const afterMove = await request(app).get("/api/history").query({ path: "Edge.mmd" }).set("Host", HOST);
    expect(afterMove.body.revisions[0].name).toBe("Site baseline");

    const copy = await request(app).post("/api/duplicate").set(json).send({ path: "Edge.mmd" });
    expect(copy.status).toBe(201);
    const copyHistory = await request(app).get("/api/history").query({ path: copy.body.path }).set("Host", HOST);
    expect(copyHistory.body.revisions).toEqual([]);

    const trashed = await request(app).delete("/api/item").query({ path: "Edge.mmd" }).set(json);
    expect(trashed.status).toBe(204);
    const hidden = await request(app).get("/api/history").query({ path: "Edge.mmd" }).set("Host", HOST);
    expect(hidden.body.revisions).toEqual([]);
    const trash = await request(app).get("/api/trash").set("Host", HOST);
    const item = trash.body.items.find((entry: { originalPath: string }) => entry.originalPath === "Edge.mmd");
    const restored = await request(app).post("/api/trash/restore").set(json).send({ id: item.id });
    expect(restored.status).toBe(200);
    const back = await request(app).get("/api/history").query({ path: "Edge.mmd" }).set("Host", HOST);
    expect(back.body.revisions[0].name).toBe("Site baseline");

    await request(app).delete("/api/item").query({ path: "Edge.mmd" }).set(json);
    const again = await request(app).get("/api/trash").set("Host", HOST);
    const doomed = again.body.items.find((entry: { originalPath: string }) => entry.originalPath === "Edge.mmd");
    const purged = await request(app).delete("/api/trash/item").query({ id: doomed.id }).set(json);
    expect(purged.status).toBe(204);
    const versions = path.join(getVersionsRoot(), encodeStorageKey("Edge.mmd"));
    await expect(fs.access(versions)).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".meta", "trash", "items", doomed.id))).rejects.toThrow();
  });

  it("diffs through /api and /api/v1 without changing the file", async () => {
    let saved = await writeNew("Diff.mmd", "flowchart LR\n  old-fw[Old FW]\n  core1 --> dist2[Dist-2]\n");
    saved = await writeNext(saved, "flowchart LR\n  core1 --> dist2[\"Dist-2 (new)\"]\n  core1 --> dist3\n");
    const history = await request(app).get("/api/history").query({ path: "Diff.mmd" }).set("Host", HOST);
    const fromId = history.body.revisions[0].id as string;
    const named = await request(app).post("/api/history/baseline").set(json).send({
      path: "Diff.mmd",
      id: fromId,
      name: "Before",
    });
    expect(named.status).toBe(201);

    const beforeHash = saved.hash;
    const diff = await request(app).get("/api/history/diff").query({ path: "Diff.mmd", from: "Before", to: "current" }).set("Host", HOST);
    expect(diff.status).toBe(200);
    expect(diff.body.summary).toEqual(
      expect.arrayContaining([
        "Removed node old-fw.",
        "Relabeled dist2 from `Dist-2` to `Dist-2 (new)`.",
        "Added link core1 to dist3.",
      ]),
    );
    expect(diff.body.visualSource).toContain("classDef ngRemoved");
    expect(diff.body.from.label).toBe("Before");
    expect(diff.body.from.createdAt).toBe(history.body.revisions[0].createdAt);
    expect(diff.body.to.label).toBe("Current");
    expect(diff.body.to.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const after = await request(app).get("/api/file").query({ path: "Diff.mmd" }).set("Host", HOST);
    expect(after.body.hash).toBe(beforeHash);
    expect(after.body.content).toBe(saved.content);

    const token = await request(app).post("/api/tokens").set(json).send({ name: "diff", scope: "read-write" });
    const auth = { Authorization: `Bearer ${token.body.token}`, Host: HOST };
    const v1 = await request(app).get("/api/v1/history/diff").query({ path: "Diff.mmd", from: fromId, to: "current" }).set(auth);
    expect(v1.status).toBe(200);
    expect(v1.body.nodes.removed.map((node: { id: string }) => node.id)).toContain("old-fw");
    const listed = await request(app).get("/api/v1/history").query({ path: "Diff.mmd" }).set(auth);
    expect(listed.status).toBe(200);
    expect(listed.body.revisions[0].name).toBe("Before");

    const readOnly = await request(app).post("/api/tokens").set(json).send({ name: "read", scope: "read" });
    const denied = await request(app)
      .post("/api/v1/history/baseline")
      .set({ ...auth, Authorization: `Bearer ${readOnly.body.token}`, "Content-Type": "application/json" })
      .send({ path: "Diff.mmd", name: "Nope" });
    expect(denied.status).toBe(403);

    const missing = await request(app)
      .get("/api/v1/history/diff")
      .query({ path: "Diff.mmd", from: "current", to: "current" })
      .set("Host", HOST);
    expect(missing.status).toBe(401);
  });

  it("serves diff and baseline from the CLI", async () => {
    const server = makeApp();
    const created = await request(server).post("/api/tokens").set(json).send({ name: "cli", scope: "read-write" });
    const token = created.body.token as string;
    const running = await listen(server);
    const io = {
      stdout: (chunk: string) => stdout.push(chunk),
      stderr: (chunk: string) => stderr.push(chunk),
      env: {} as NodeJS.ProcessEnv,
    };
    const stdout: string[] = [];
    const stderr: string[] = [];
    const flags = ["--url", `http://127.0.0.1:${running.port}`, "--token", token];
    try {
      await writeOn(server, "Cli.mmd", "flowchart LR\n  A[One] --> B[Two]\n");
      await writeOn(server, "Cli.mmd", "flowchart LR\n  A[One] --> C[Three]\n", true);
      stdout.length = 0;
      expect(await main(["baseline", "Cli.mmd", "--name", "Morning", ...flags, "--json"], io)).toBe(0);
      const saved = JSON.parse(stdout.join("")) as { ok: boolean; name: string; id: string };
      expect(saved.ok).toBe(true);
      expect(saved.name).toBe("Morning");

      stdout.length = 0;
      expect(await main(["diff", "Cli.mmd", "--from", "Morning", "--to", "current", "--format", "md", ...flags], io)).toBe(0);
      expect(stdout.join("")).toContain("# Diagram changes");
      expect(stdout.join("")).toContain("From: Morning");

      stdout.length = 0;
      expect(await main(["diff", "Cli.mmd", "--from", saved.id, "--format", "json", ...flags], io)).toBe(0);
      const body = JSON.parse(stdout.join("")) as { ok: boolean; semantic: boolean; summary: string[] };
      expect(body.ok).toBe(true);
      expect(body.semantic).toBe(true);

      const svg = path.join(dir, "cli-diff.svg");
      stdout.length = 0;
      expect(await main(["diff", "Cli.mmd", "--from", "Morning", "--format", "svg", "-o", svg, ...flags], io)).toBe(0);
      expect(await fs.readFile(svg, "utf8")).toContain("<svg");
      expect(await fs.readFile(path.join(dir, "Cli.mmd"), "utf8")).toContain("C[Three]");
    } finally {
      await running.close();
      await closeRenderer();
    }
  }, 60_000);
});

async function writeOn(server: ReturnType<typeof makeApp>, filePath: string, content: string, update = false) {
  if (!update) {
    const res = await request(server).put("/api/file").set(json).send({ path: filePath, content });
    expect(res.status).toBe(200);
    return;
  }
  const current = await request(server).get("/api/file").query({ path: filePath }).set("Host", HOST);
  const res = await request(server).put("/api/file").set(json).send({
    path: filePath,
    content,
    expectedHash: current.body.hash,
    expectedMtimeMs: current.body.mtimeMs,
  });
  expect(res.status).toBe(200);
}

function listen(app: ReturnType<typeof makeApp>): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({
        port: address.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
