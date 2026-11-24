import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { main } from "../src/cli.js";
import {
  backupDirForId,
  dataHealthReport,
  ensureDataPrepared,
  resetDataHealthForTests,
  restoreQuarantineSet,
  safeReadState,
} from "../src/dataHealth.js";
import { backgroundWritersPaused, refreshInstanceLockForTests } from "../src/instanceLock.js";
import { setBookmarks } from "../src/favorites.js";
import { makeTempDataDir } from "./helpers.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "data-v2.1");
const HOST = "127.0.0.1:8787";

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

describe("data folder phase 2", () => {
  let cleanup = async () => {};
  let dir = "";
  const previousStrict = process.env.NERDGRAM_STRICT_INSTANCE;

  afterEach(async () => {
    if (previousStrict === undefined) delete process.env.NERDGRAM_STRICT_INSTANCE;
    else process.env.NERDGRAM_STRICT_INSTANCE = previousStrict;
    resetDataHealthForTests();
    await cleanup();
  });

  async function tempDir(): Promise<void> {
    resetDataHealthForTests();
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  }

  it("migrates a previous-minor data folder after a backup and leaves diagrams alone", async () => {
    await tempDir();
    await fs.cp(fixture, dir, { recursive: true });
    const before = await fs.readFile(path.join(dir, "Welcome.mmd"), "utf8");
    await ensureDataPrepared();
    const favorites = JSON.parse(await fs.readFile(path.join(dir, ".meta", "favorites.json"), "utf8")) as { schemaVersion?: number };
    const updates = JSON.parse(await fs.readFile(path.join(dir, ".meta", "updates.json"), "utf8")) as { schemaVersion?: number };
    expect(favorites.schemaVersion).toBe(1);
    expect(updates.schemaVersion).toBe(1);
    expect(await fs.readFile(path.join(dir, "Welcome.mmd"), "utf8")).toBe(before);
    const backups = await fs.readdir(path.join(dir, ".meta", "backups"));
    expect(backups.some((name) => name.startsWith("0-"))).toBe(true);
    const backupFavorites = await fs.readFile(path.join(dir, ".meta", "backups", backups[0] ?? "", "favorites.json"), "utf8");
    expect(backupFavorites).not.toContain("schemaVersion");
  });

  it("does not overwrite a newer schemaVersion", async () => {
    await tempDir();
    const file = path.join(dir, ".meta", "favorites.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const body = `${JSON.stringify({ schemaVersion: 99, version: 1, folders: [], items: [{ path: "Welcome.mmd", folderId: null }] })}\n`;
    await fs.writeFile(file, body);
    await fs.writeFile(path.join(dir, "Welcome.mmd"), "flowchart LR\n  A[keep]\n");
    await ensureDataPrepared();
    expect(await fs.readFile(file, "utf8")).toBe(body);
    expect(await fs.readFile(path.join(dir, "Welcome.mmd"), "utf8")).toContain("keep");
    const report = dataHealthReport();
    expect(report.issues.some((issue) => issue.code === "newer-schema" && issue.file === "favorites.json")).toBe(true);
    expect(report.blockers.some((blocker) => blocker.code === "newer-schema")).toBe(true);
    await expect(setBookmarks({ folders: [], items: [] })).rejects.toThrow(/newer NerdGram/);
    expect(await fs.readFile(file, "utf8")).toBe(body);
  });

  it("warns when another instance holds a fresh heartbeat and strict mode refuses to start", async () => {
    await tempDir();
    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
    const fresh = {
      instanceId: "22222222-2222-4222-8222-222222222222",
      hostname: "other-host",
      pid: 4242,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(dir, ".meta", "instance-lock.json"), `${JSON.stringify(fresh)}\n`);
    await ensureDataPrepared();
    expect(backgroundWritersPaused()).toBe(true);
    expect(dataHealthReport().instanceConflict?.hostname).toBe("other-host");
    expect(dataHealthReport().issues.some((issue) => issue.code === "instance-conflict")).toBe(true);
    expect(dataHealthReport().blockers.some((blocker) => blocker.code === "instance-conflict")).toBe(true);

    resetDataHealthForTests();
    process.env.NERDGRAM_DATA_DIR = dir;
    process.env.NERDGRAM_STRICT_INSTANCE = "1";
    await fs.writeFile(path.join(dir, ".meta", "instance-lock.json"), `${JSON.stringify(fresh)}\n`);
    await expect(ensureDataPrepared()).rejects.toThrow(/refused to start/);
  });

  it("takes the lock when the other heartbeat is stale", async () => {
    await tempDir();
    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
    const stale = {
      instanceId: "22222222-2222-4222-8222-222222222222",
      hostname: "other-host",
      pid: 4242,
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
    };
    await fs.writeFile(path.join(dir, ".meta", "instance-lock.json"), `${JSON.stringify(stale)}\n`);
    await ensureDataPrepared();
    expect(backgroundWritersPaused()).toBe(false);
    const lock = JSON.parse(await fs.readFile(path.join(dir, ".meta", "instance-lock.json"), "utf8")) as { hostname: string };
    expect(lock.hostname).toBe(os.hostname());
    await refreshInstanceLockForTests();
    expect(backgroundWritersPaused()).toBe(false);
  });

  it("prints doctor --json and repairs without touching diagrams", async () => {
    await tempDir();
    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(dir, ".meta", "updates.json"), "");
    await fs.writeFile(path.join(dir, ".meta", ".ng-99-dead.tmp"), "stale");
    const old = new Date(Date.now() - 20 * 60 * 1000);
    await fs.utimes(path.join(dir, ".meta", ".ng-99-dead.tmp"), old, old);
    await fs.writeFile(path.join(dir, "Welcome.mmd"), "flowchart LR\n  A[stay]\n");
    const stdout: string[] = [];
    const code = await main(["doctor", "--json"], { stdout: (chunk) => stdout.push(chunk) });
    expect(code).not.toBe(0);
    const report = JSON.parse(stdout.join("")) as { ok: boolean; status: string; issues: { file?: string }[] };
    expect(report.ok).toBe(true);
    expect(report.issues.some((issue) => issue.file === "updates.json")).toBe(true);
    const repaired: string[] = [];
    const repairCode = await main(["doctor", "--repair"], { stdout: (chunk) => repaired.push(chunk) });
    expect(repairCode).not.toBe(2);
    expect(repaired.join("")).toContain("Repair finished");
    expect(await fs.readFile(path.join(dir, "Welcome.mmd"), "utf8")).toContain("stay");
    await expect(fs.access(path.join(dir, ".meta", ".ng-99-dead.tmp"))).rejects.toThrow();
    const updates = JSON.parse(await fs.readFile(path.join(dir, ".meta", "updates.json"), "utf8")) as { schemaVersion?: number };
    expect(updates.schemaVersion).toBe(1);
  });

  it("restores a quarantine set from doctor and from localhost", async () => {
    await tempDir();
    const file = path.join(dir, ".meta", "favorites.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const body = '{"not":"favorites"}\n';
    await fs.writeFile(file, body);
    const stdout: string[] = [];
    await main(["doctor", "--json"], { stdout: (chunk) => stdout.push(chunk) });
    const report = JSON.parse(stdout.join("")) as { quarantineSets: { id: string }[] };
    const id = report.quarantineSets[0]?.id;
    expect(id).toBeTruthy();
    const restored: string[] = [];
    const code = await main(["doctor", "--restore", id ?? ""], { stdout: (chunk) => restored.push(chunk) });
    expect(code).toBe(0);
    expect(await fs.readFile(file, "utf8")).toBe(body);
    expect(restored.join("")).toContain("Diagrams were not changed");

    await fs.writeFile(file, '{"version":1,"folders":[],"items":[]}\n');
    resetDataHealthForTests();
    process.env.NERDGRAM_DATA_DIR = dir;
    const response = await request(app())
      .post("/api/data/quarantine/restore")
      .set("Host", HOST)
      .set("Origin", "http://127.0.0.1:8787")
      .send({ id });
    expect(response.status).toBe(200);
    expect(await fs.readFile(file, "utf8")).toBe(body);
  });

  it("reads doctor --url from a running server", async () => {
    await tempDir();
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, status: "warn", writable: true, issues: [{ message: "low disk" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const stdout: string[] = [];
      const code = await main(["doctor", "--url", "http://127.0.0.1:8787", "--json"], {
        stdout: (chunk) => stdout.push(chunk),
      });
      expect(code).toBe(1);
      expect(stdout.join("")).toContain("low disk");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reports case collisions and conflict copies without deleting either file", async () => {
    await tempDir();
    await fs.writeFile(path.join(dir, "a.mmd"), "flowchart LR\n  A[lower]\n");
    await fs.writeFile(path.join(dir, "A.mmd"), "flowchart LR\n  A[upper]\n");
    await fs.writeFile(path.join(dir, "Welcome.mmd"), "flowchart LR\n  A[one]\n");
    await fs.writeFile(path.join(dir, "Welcome 2.mmd"), "flowchart LR\n  A[two]\n");
    await ensureDataPrepared();
    const report = dataHealthReport();
    expect(report.clashes.some((clash) => clash.kind === "case" && clash.paths.includes("a.mmd") && clash.paths.includes("A.mmd"))).toBe(true);
    expect(report.clashes.some((clash) => clash.kind === "conflict-copy")).toBe(true);
    expect(await fs.readFile(path.join(dir, "a.mmd"), "utf8")).toContain("lower");
    expect(await fs.readFile(path.join(dir, "A.mmd"), "utf8")).toContain("upper");
    expect(await fs.readFile(path.join(dir, "Welcome 2.mmd"), "utf8")).toContain("two");
  });

  it("rejects a restore path that leaves the quarantine directory", async () => {
    await tempDir();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ng-outside-"));
    const marker = path.join(outside, "marker.txt");
    await fs.writeFile(marker, "keep");
    const attacks = ["../etc", "/tmp/passwd", "..%2f..%2fetc", "1700000000000-abcdef/../../etc", "%2e%2e%2f", "1700000000000-abcdef\n"];
    try {
      for (const id of attacks) {
        const response = await request(app())
          .post("/api/data/quarantine/restore")
          .set("Host", HOST)
          .set("Origin", "http://127.0.0.1:8787")
          .send({ id });
        expect(response.status, id).toBe(400);
        await expect(restoreQuarantineSet(id), id).rejects.toThrow();
        await expect(backupDirForId(id), id).rejects.toThrow();
      }
      await fs.mkdir(path.join(dir, ".meta", "quarantine"), { recursive: true });
      await fs.symlink(outside, path.join(dir, ".meta", "quarantine", "1700000000000-abcdef"));
      const linked = await request(app())
        .post("/api/data/quarantine/restore")
        .set("Host", HOST)
        .set("Origin", "http://127.0.0.1:8787")
        .send({ id: "1700000000000-abcdef" });
      expect(linked.status).toBe(400);
      const stderr: string[] = [];
      const code = await main(["doctor", "--restore", "../etc"], { stderr: (chunk) => stderr.push(chunk) });
      expect(code).toBe(2);
      expect(await fs.readFile(marker, "utf8")).toBe("keep");
      const outsideNames = await fs.readdir(outside);
      expect(outsideNames).toEqual(["marker.txt"]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("keeps the 10 most recent quarantine sets", async () => {
    await tempDir();
    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
    for (let index = 0; index < 11; index += 1) {
      const file = path.join(dir, ".meta", `extra-${index}.json`);
      await fs.writeFile(file, "{");
      await safeReadState({
        file,
        name: `extra-${index}.json`,
        fallback: null,
        parse: () => null,
      });
    }
    expect(dataHealthReport().quarantineSets.length).toBe(10);
    const names = await fs.readdir(path.join(dir, ".meta", "quarantine"));
    expect(names.length).toBe(10);
  });
});
