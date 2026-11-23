import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  classifyFreeBytes,
  cleanupOrphanTemps,
  dataHealthReport,
  ensureDataPrepared,
  isConflictCopyName,
  resetDataHealthForTests,
  safeReadState,
  syncReasonForPath,
  tempPid,
} from "../src/dataHealth.js";
import { buildTree } from "../src/fsStore.js";
import { getBookmarks, setBookmarks } from "../src/favorites.js";
import { atomicWriteJson } from "../src/storage.js";
import { main } from "../src/cli.js";
import { createToken } from "../src/tokens.js";
import { makeTempDataDir } from "./helpers.js";

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

describe("data folder health", () => {
  let cleanup = async () => {};
  let dir = "";

  beforeEach(async () => {
    resetDataHealthForTests();
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    resetDataHealthForTests();
    await cleanup();
  });

  it("classifies low space and sync paths", () => {
    expect(classifyFreeBytes(10 * 1024 * 1024)?.severity).toBe("degraded");
    expect(classifyFreeBytes(50 * 1024 * 1024)?.severity).toBe("warn");
    expect(classifyFreeBytes(500 * 1024 * 1024)).toBeNull();
    expect(syncReasonForPath("/Users/me/Library/Mobile Documents/com~apple~CloudDocs/data")).toBe("Mobile Documents");
    expect(syncReasonForPath("/home/me/Dropbox/nerdgram")).toBe("Dropbox");
    expect(syncReasonForPath("/tmp/local")).toBeNull();
    expect(isConflictCopyName("Welcome 2.mmd")).toBe(true);
    expect(isConflictCopyName("Map (conflicted copy).mmd")).toBe(true);
    expect(isConflictCopyName("Welcome.mmd")).toBe(false);
    expect(tempPid(".ng-99-abcdef.tmp")).toBe(99);
    expect(tempPid("Welcome.mmd")).toBeNull();
  });

  it("quarantines a bad state file and does not put its bytes in the report", async () => {
    const file = path.join(dir, ".meta", "favorites.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const secret = "ghp_should_not_appear_in_the_report";
    await fs.writeFile(file, secret);
    const value = await safeReadState({
      file,
      name: "favorites.json",
      fallback: { ok: true },
      restore: { ok: true },
      parse: () => null,
    });
    expect(value).toEqual({ ok: true });
    const report = dataHealthReport();
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.quarantined).toBe(1);
    const sets = await fs.readdir(path.join(dir, ".meta", "quarantine"));
    const copied = await fs.readFile(path.join(dir, ".meta", "quarantine", sets[0], "favorites.json"), "utf8");
    expect(copied).toBe(secret);
    const meta = JSON.parse(await fs.readFile(path.join(dir, ".meta", "quarantine", sets[0], "report.json"), "utf8")) as {
      sha256: string;
      reason: string;
    };
    expect(meta.reason).toBe("invalid JSON");
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(meta)).not.toContain(secret);
  });

  it("does not overwrite favorites until the corrupt file is copied aside", async () => {
    const file = path.join(dir, ".meta", "favorites.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{");
    expect(await getBookmarks()).toEqual({ folders: [], items: [] });
    await setBookmarks({ folders: [], items: [{ path: "Kept.mmd", folderId: null }] });
    const sets = await fs.readdir(path.join(dir, ".meta", "quarantine"));
    expect(await fs.readFile(path.join(dir, ".meta", "quarantine", sets[0], "favorites.json"), "utf8")).toBe("{");
    const saved = JSON.parse(await fs.readFile(file, "utf8")) as { items: { path: string }[] };
    expect(saved.items.map((item) => item.path)).toEqual(["Kept.mmd"]);
  });

  it("skips a broken symlink and keeps an mmd file while cleaning a dead temp", async () => {
    await fs.writeFile(path.join(dir, "Welcome.mmd"), "flowchart LR\n  A --> B\n");
    await fs.symlink(path.join(dir, "missing-target"), path.join(dir, "broken"));
    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
    const temp = path.join(dir, ".meta", ".ng-99-abcdef.tmp");
    await fs.writeFile(temp, "stale");
    const old = new Date(Date.now() - 20 * 60 * 1000);
    await fs.utimes(temp, old, old);
    const removed = await cleanupOrphanTemps(dir);
    expect(removed).toBe(1);
    expect(await fs.readFile(path.join(dir, "Welcome.mmd"), "utf8")).toContain("flowchart");
    const tree = await buildTree();
    expect(tree.map((node) => node.name)).toContain("Welcome.mmd");
    expect(tree.map((node) => node.name)).not.toContain("broken");
    expect(dataHealthReport().issues.some((issue) => issue.code === "tree-skip")).toBe(true);
  });

  it("keeps a one-step bak of a state file and not of a diagram", async () => {
    const state = path.join(dir, ".meta", "updates.json");
    await fs.mkdir(path.dirname(state), { recursive: true });
    await atomicWriteJson(state, { automatic: true });
    await atomicWriteJson(state, { automatic: false });
    const bak = JSON.parse(await fs.readFile(`${state}.bak`, "utf8")) as { automatic: boolean };
    expect(bak.automatic).toBe(true);
    const diagram = path.join(dir, "Welcome.mmd");
    await atomicWriteJson(diagram.replace(/\.mmd$/, ".json"), { note: "not a diagram" });
    await fs.writeFile(diagram, "flowchart LR\n");
    const { atomicWriteText } = await import("../src/storage.js");
    await atomicWriteText(diagram, "flowchart TD\n");
    await expect(fs.access(`${diagram}.bak`)).rejects.toThrow();
    expect(await fs.readFile(diagram, "utf8")).toBe("flowchart TD\n");
  });

  it("fails closed when api-tokens.json is corrupt", async () => {
    const created = await createToken({ name: "ci", scope: "read" });
    const file = path.join(dir, ".meta", "api-tokens.json");
    await fs.writeFile(file, "{");
    const onDisk = await fs.readFile(file, "utf8");
    const bearer = { Authorization: `Bearer ${created.token}`, Host: HOST };
    const v1 = await request(app()).get("/api/v1/diagrams").set(bearer);
    expect(v1.status, `${onDisk} ${JSON.stringify(v1.body)}`).toBe(401);
    const mcp = await request(app()).post("/mcp").set(bearer).send({});
    expect(mcp.status).not.toBe(500);
    expect(mcp.status).not.toBe(200);
    expect([401, 406]).toContain(mcp.status);
    const open = await request(app()).get("/api/v1/diagrams").set({ Host: HOST });
    expect(open.status).toBe(401);
  });

  it("reports a sync folder and a read-only probe without crashing", async () => {
    const synced = path.join(dir, "Dropbox");
    await fs.mkdir(synced, { recursive: true });
    process.env.NERDGRAM_DATA_DIR = synced;
    resetDataHealthForTests();
    await ensureDataPrepared();
    const report = dataHealthReport();
    expect(report.syncFolder).toBe(true);
    expect(report.issues.some((issue) => issue.code === "sync-folder")).toBe(true);
    const health = await request(app()).get("/api/health").set("Host", HOST);
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.data.syncFolder).toBe(true);
    const doctor = await request(app()).get("/api/doctor").set("Host", HOST);
    expect(doctor.status).toBe(200);
    expect(doctor.body.issues.some((issue: { code: string }) => issue.code === "sync-folder")).toBe(true);
    expect(JSON.stringify(doctor.body)).not.toContain("ghp_");
  });

  it("stores the Docker instance file in the data folder and copies a home file once", async () => {
    const previousInstall = process.env.NERDGRAM_INSTALL;
    const previousInstance = process.env.NERDGRAM_INSTANCE_FILE;
    const previousHome = process.env.HOME;
    delete process.env.NERDGRAM_INSTANCE_FILE;
    process.env.NERDGRAM_INSTALL = "docker";
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "ng-home-"));
    process.env.HOME = home;
    const restoreEnv = () => {
      if (previousInstall === undefined) delete process.env.NERDGRAM_INSTALL;
      else process.env.NERDGRAM_INSTALL = previousInstall;
      if (previousInstance === undefined) delete process.env.NERDGRAM_INSTANCE_FILE;
      else process.env.NERDGRAM_INSTANCE_FILE = previousInstance;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    };
    const { clearInstanceIdentityCache, getInstanceIdentity, instanceFilePath } = await import("../src/instanceConfig.js");
    await fs.mkdir(path.join(home, ".nerdgram"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".nerdgram", "instance.json"),
      `${JSON.stringify({ instanceId: "11111111-1111-4111-8111-111111111111", instanceName: "Lab" })}\n`,
    );
    clearInstanceIdentityCache();
    const identity = await getInstanceIdentity();
    expect(identity.instanceName, `${instanceFilePath()} ${process.env.HOME}`).toBe("Lab");
    expect(instanceFilePath()).toBe(path.join(dir, ".meta", "instance.json"));
    const saved = JSON.parse(await fs.readFile(instanceFilePath(), "utf8")) as { instanceName: string };
    expect(saved.instanceName).toBe("Lab");
    restoreEnv();
    clearInstanceIdentityCache();
    await fs.rm(home, { recursive: true, force: true });
  });

  it("quarantines a wrong-shape state file at startup for every audited file", async () => {
    const cases: { rel: string; body: string; file: string }[] = [
      { rel: "favorites.json", body: '{"not":"favorites"}\n', file: "favorites.json" },
      { rel: "updates.json", body: "[]\n", file: "updates.json" },
      { rel: "api-tokens.json", body: '{"not":"tokens"}\n', file: "api-tokens.json" },
      { rel: "style-presets.json", body: '{"not":"presets"}\n', file: "style-presets.json" },
      { rel: "github-sync.json", body: "[]\n", file: "github-sync.json" },
      { rel: "replace/operations.json", body: '{"not":"operations"}\n', file: "replace/operations.json" },
      { rel: "versions/sample/index.json", body: '{"not":"index"}\n', file: "versions/index.json" },
      { rel: "trash/items/sample/manifest.json", body: '{"not":"trash"}\n', file: "trash/sample/manifest.json" },
      { rel: "locks/sample.json", body: '{"not":"lock"}\n', file: "locks/sample.json" },
    ];
    for (const item of cases) {
      resetDataHealthForTests();
      await fs.rm(path.join(dir, ".meta"), { recursive: true, force: true });
      const file = path.join(dir, ".meta", item.rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, item.body);
      const stdout: string[] = [];
      const code = await main(["doctor"], { stdout: (chunk) => stdout.push(chunk) });
      expect(code, item.rel).not.toBe(0);
      expect(stdout.join(""), item.rel).toContain("wrong shape");
      const stamps = await fs.readdir(path.join(dir, ".meta", "quarantine"));
      const reports = await Promise.all(
        stamps.map(async (stamp) => {
          const folder = path.join(dir, ".meta", "quarantine", stamp);
          const report = JSON.parse(await fs.readFile(path.join(folder, "report.json"), "utf8")) as {
            reason: string;
            file: string;
          };
          const copyName = (await fs.readdir(folder)).find((name) => name !== "report.json");
          const copy = copyName ? await fs.readFile(path.join(folder, copyName), "utf8") : "";
          return { report, copy };
        }),
      );
      const match = reports.find((entry) => entry.report.file === item.file);
      expect(match, item.rel).toBeTruthy();
      expect(match?.report.reason, item.rel).toContain("wrong shape");
      expect(match?.copy, item.rel).toBe(item.body);
      expect(JSON.stringify(match?.report), item.rel).not.toContain(item.body.trim());
    }
  });

  it("refuses a save and exits doctor with 2 when the data folder is not writable", async () => {
    await fs.chmod(dir, 0o555);
    try {
      const stdout: string[] = [];
      const code = await main(["doctor"], { stdout: (chunk) => stdout.push(chunk) });
      expect(code).toBe(2);
      expect(stdout.join("")).toContain("1001:1001");
      const saved = await request(app())
        .put("/api/file")
        .set("Host", HOST)
        .set("Origin", "http://127.0.0.1:8787")
        .send({ path: "Nope.mmd", content: "flowchart LR\n  N[nope]\n" });
      expect(saved.status).not.toBe(200);
      expect(saved.status).not.toBe(500);
      expect(saved.status).toBe(503);
      expect(String(saved.body.error)).toMatch(/1001:1001|not writable|read-only/);
    } finally {
      await fs.chmod(dir, 0o755);
    }
  });
});
