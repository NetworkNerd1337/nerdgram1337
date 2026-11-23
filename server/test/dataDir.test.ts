import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  clearInstanceIdentityCache,
  instanceFilePath,
  readStartupDataDir,
  resetStartupDataDirForTests,
  saveStartupDataDir,
  setExternalDataDirForTests,
} from "../src/instanceConfig.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

describe("diagram folder setting", () => {
  let cleanup = async () => {};
  let previousInstall: string | undefined;
  let previousInstance: string | undefined;
  let previousData: string | undefined;
  const extraDirs: string[] = [];

  afterEach(async () => {
    setExternalDataDirForTests(undefined);
    resetStartupDataDirForTests();
    clearInstanceIdentityCache();
    if (previousInstall === undefined) delete process.env.NERDGRAM_INSTALL;
    else process.env.NERDGRAM_INSTALL = previousInstall;
    if (previousInstance === undefined) delete process.env.NERDGRAM_INSTANCE_FILE;
    else process.env.NERDGRAM_INSTANCE_FILE = previousInstance;
    if (previousData === undefined) delete process.env.NERDGRAM_DATA_DIR;
    else process.env.NERDGRAM_DATA_DIR = previousData;
    await cleanup();
    cleanup = async () => {};
    await Promise.all(extraDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    previousInstall = process.env.NERDGRAM_INSTALL;
    previousInstance = process.env.NERDGRAM_INSTANCE_FILE;
    previousData = process.env.NERDGRAM_DATA_DIR;
    delete process.env.NERDGRAM_INSTALL;
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const instanceDir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-instance-"));
    extraDirs.push(instanceDir);
    process.env.NERDGRAM_INSTANCE_FILE = path.join(instanceDir, "instance.json");
    clearInstanceIdentityCache();
    resetStartupDataDirForTests();
    setExternalDataDirForTests(undefined);
    return temp;
  }

  function app() {
    return createApp({ mode: "production", port: 8787 });
  }

  it("hides the restart notice when nothing was saved", async () => {
    await setup();
    const status = await request(app()).get("/api/data-dir").set("Host", HOST);
    expect(status.status).toBe(200);
    expect(status.body.persisted).toBe(false);
    expect(status.body.restartNotice).toBe(false);
    expect(status.body.readOnly).toBe(false);
    expect(status.body.envManaged).toBe(false);
    expect(status.body.source).toBe("default");
  });

  it("shows the notice after a save that differs and hides it once the process is using that folder", async () => {
    const temp = await setup();
    const next = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-diagrams-"));
    extraDirs.push(next);
    const saved = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: next });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toBe(next);
    expect(saved.body.running).toBe(temp.dir);
    expect(saved.body.persisted).toBe(true);
    expect(saved.body.restartNotice).toBe(true);
    expect(saved.body.source).toBe("saved");
    const file = JSON.parse(await fs.readFile(instanceFilePath(), "utf8")) as { NERDGRAM_DATA_DIR?: string };
    expect(file.NERDGRAM_DATA_DIR).toBe(next);
    expect(file.NERDGRAM_DATA_DIR).not.toBeUndefined();

    process.env.NERDGRAM_DATA_DIR = next;
    const restarted = await request(app()).get("/api/data-dir").set("Host", HOST);
    expect(restarted.body.running).toBe(next);
    expect(restarted.body.saved).toBe(next);
    expect(restarted.body.restartNotice).toBe(false);
  });

  it("hides the notice when the saved folder is the one already in use", async () => {
    const temp = await setup();
    const saved = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: temp.dir });
    expect(saved.status).toBe(200);
    expect(saved.body.restartNotice).toBe(false);
    expect(saved.body.running).toBe(temp.dir);
  });

  it("keeps an external NERDGRAM_DATA_DIR as the only source of truth", async () => {
    const temp = await setup();
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-external-"));
    extraDirs.push(external);
    await saveStartupDataDir(temp.dir);
    setExternalDataDirForTests(external);
    process.env.NERDGRAM_DATA_DIR = external;
    const status = await request(app()).get("/api/data-dir").set("Host", HOST);
    expect(status.body.envManaged).toBe(true);
    expect(status.body.envSource).toBe("shell");
    expect(status.body.readOnly).toBe(true);
    expect(status.body.saved).toBe(external);
    expect(status.body.running).toBe(external);
    expect(status.body.restartNotice).toBe(false);
    expect(status.body.source).toBe("env");
    expect(readStartupDataDir()).toBe(temp.dir);

    const denied = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: temp.dir });
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe("read_only");
    expect(readStartupDataDir()).toBe(temp.dir);
  });

  it("is read-only in Docker and tells you to change the volume", async () => {
    const temp = await setup();
    process.env.NERDGRAM_INSTALL = "docker";
    setExternalDataDirForTests(temp.dir);
    const status = await request(app()).get("/api/data-dir").set("Host", HOST);
    expect(status.body.docker).toBe(true);
    expect(status.body.readOnly).toBe(true);
    expect(status.body.envSource).toBe("docker");
    expect(status.body.saved).toBe(temp.dir);
    expect(status.body.restartNotice).toBe(false);

    const denied = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "/elsewhere" });
    expect(denied.status).toBe(409);
    expect(denied.body.error).toMatch(/volume/i);
  });

  it("rejects a file, a missing parent, and accepts a folder it can create", async () => {
    const temp = await setup();
    const filePath = path.join(temp.dir, "not-a-folder");
    await fs.writeFile(filePath, "nope");
    const file = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: filePath });
    expect(file.status).toBe(400);
    expect(file.body.error).toMatch(/file/i);

    const missing = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: path.join(temp.dir, "missing-parent", "diagrams") });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/cannot be created/i);

    const relative = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "relative/path" });
    expect(relative.status).toBe(400);
    expect(relative.body.error).toMatch(/absolute path is required/i);

    const created = path.join(temp.dir, "new-diagrams");
    const ok = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: created });
    expect(ok.status).toBe(200);
    expect(ok.body.saved).toBe(created);
    const stat = await fs.stat(created);
    expect(stat.isDirectory()).toBe(true);
  });

  it("disables the folder while GitHub sync is the storage mode", async () => {
    const temp = await setup();
    await fs.mkdir(path.join(temp.dir, ".meta"), { recursive: true });
    await fs.writeFile(
      path.join(temp.dir, ".meta", "github-sync.json"),
      `${JSON.stringify({ version: 1, enabled: true })}\n`,
    );
    const status = await request(app()).get("/api/data-dir").set("Host", HOST);
    expect(status.body.githubSync).toBe(true);
    expect(status.body.readOnly).toBe(true);
    const denied = await request(app())
      .post("/api/data-dir")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: temp.dir });
    expect(denied.status).toBe(409);
    expect(denied.body.error).toMatch(/GitHub sync/i);
  });

  it("saves an instance name on this install and defaults to the hostname", async () => {
    await setup();
    const initial = await request(app()).get("/api/instance").set("Host", HOST);
    expect(initial.status).toBe(200);
    expect(initial.body.nameIsDefault).toBe(true);
    expect(initial.body.instanceName).toBe(initial.body.hostname);
    expect(initial.body.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const saved = await request(app())
      .post("/api/instance")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ name: "Ryan's laptop" });
    expect(saved.status).toBe(200);
    expect(saved.body.instanceName).toBe("Ryan's laptop");
    expect(saved.body.configuredName).toBe("Ryan's laptop");
    expect(saved.body.instanceId).toBe(initial.body.instanceId);
    const stored = JSON.parse(await fs.readFile(instanceFilePath(), "utf8")) as { instanceId: string };
    expect(instanceFilePath().includes(`${path.sep}.meta${path.sep}`)).toBe(false);
    expect(stored.instanceId).toBe(initial.body.instanceId);

    const cleared = await request(app())
      .post("/api/instance")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ name: "  " });
    expect(cleared.body.nameIsDefault).toBe(true);
    expect(cleared.body.instanceName).toBe(cleared.body.hostname);
  });

  it("keeps a hostname longer than 32 characters and rejects a typed name over that cap", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const instanceFile = path.join(temp.dir, "instance.json");
    process.env.NERDGRAM_INSTANCE_FILE = instanceFile;
    clearInstanceIdentityCache();
    const hostname = "h".repeat(50);
    const spy = vi.spyOn(os, "hostname").mockReturnValue(hostname);
    try {
      const status = await request(app()).get("/api/instance").set("Host", HOST);
      expect(status.status).toBe(200);
      expect(status.body.configuredName).toBeNull();
      expect(status.body.hostname).toBe(hostname);
      expect(status.body.instanceName).toBe(hostname);
      const saved = await request(app())
        .post("/api/instance")
        .set("Host", HOST)
        .set("Content-Type", "application/json")
        .send({ name: "n".repeat(33) });
      expect(saved.status).toBe(400);
      expect(saved.body.error).toMatch(/32 characters/);
    } finally {
      spy.mockRestore();
      delete process.env.NERDGRAM_INSTANCE_FILE;
      clearInstanceIdentityCache();
    }
  });
});
