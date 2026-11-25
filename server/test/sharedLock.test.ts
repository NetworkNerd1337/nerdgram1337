import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetDataHealthForTests } from "../src/dataHealth.js";
import {
  clearInstanceIdentityCache,
  containerInstanceFilePath,
  getInstanceIdentity,
  saveInstanceName,
} from "../src/instanceConfig.js";
import {
  backgroundWritersPaused,
  claimInstanceLock,
  currentInstanceConflict,
  refreshInstanceLockForTests,
  resetInstanceLockForTests,
} from "../src/instanceLock.js";
import { acquireLock, heartbeatLock, takeoverLock, type LockRecord } from "../src/locks.js";
import { encodeStorageKey } from "../src/storage.js";
import { makeTempDataDir } from "./helpers.js";

const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function lockRecord(overrides: Partial<LockRecord> = {}): LockRecord {
  const now = new Date().toISOString();
  return {
    path: "Network Core.mmd",
    token: "held-token",
    sessionId: "tab-a",
    pid: 2_147_483_646,
    acquiredAt: now,
    heartbeatAt: now,
    ...overrides,
  };
}

describe("shared library locks", () => {
  let cleanup = async () => {};
  const previousInstall = process.env.NERDGRAM_INSTALL;
  const previousInstance = process.env.NERDGRAM_INSTANCE_FILE;

  afterEach(async () => {
    resetInstanceLockForTests();
    resetDataHealthForTests();
    clearInstanceIdentityCache();
    if (previousInstall === undefined) delete process.env.NERDGRAM_INSTALL;
    else process.env.NERDGRAM_INSTALL = previousInstall;
    if (previousInstance === undefined) delete process.env.NERDGRAM_INSTANCE_FILE;
    else process.env.NERDGRAM_INSTANCE_FILE = previousInstance;
    await cleanup();
    cleanup = async () => {};
  });

  async function dirWithDiagram(): Promise<string> {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    await fs.writeFile(path.join(temp.dir, "Network Core.mmd"), "flowchart LR\n  A-->B\n");
    return temp.dir;
  }

  function diagramLock(dir: string): string {
    return path.join(dir, ".meta", "locks", `${encodeStorageKey("Network Core.mmd")}.json`);
  }

  it("keeps two instance ids distinct and does not steal a fresh lock from the other host", async () => {
    const dir = await dirWithDiagram();
    const fileA = path.join(dir, "instance-a.json");
    const fileB = path.join(dir, "instance-b.json");
    await fs.writeFile(
      fileA,
      `${JSON.stringify({ instanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", instanceName: "A" })}\n`,
    );
    await fs.writeFile(
      fileB,
      `${JSON.stringify({ instanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", instanceName: "B" })}\n`,
    );
    process.env.NERDGRAM_INSTANCE_FILE = fileA;
    clearInstanceIdentityCache();
    const first = await getInstanceIdentity();
    process.env.NERDGRAM_INSTANCE_FILE = fileB;
    clearInstanceIdentityCache();
    const second = await getInstanceIdentity();
    expect(first.instanceId).not.toBe(second.instanceId);

    const lockPath = diagramLock(dir);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(
      lockPath,
      `${JSON.stringify(
        lockRecord({
          instanceId: first.instanceId,
          instanceName: first.instanceName,
          hostname: "other-host",
          pid: 2_147_483_646,
        }),
      )}\n`,
    );
    process.env.NERDGRAM_INSTANCE_FILE = fileB;
    clearInstanceIdentityCache();
    await expect(acquireLock("Network Core.mmd", "tab-b")).rejects.toMatchObject({ status: 423, code: "locked" });
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).token).toBe("held-token");
  });

  it("treats a bad lock read as held and does not quarantine it", async () => {
    const dir = await dirWithDiagram();
    const lockPath = diagramLock(dir);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, "{");
    await expect(acquireLock("Network Core.mmd", "tab-b")).rejects.toMatchObject({
      status: 423,
      message: "The lock file could not be read. NerdGram is treating it as held.",
    });
    expect(await fs.readFile(lockPath, "utf8")).toBe("{");
    await expect(fs.access(path.join(dir, ".meta", "quarantine"))).rejects.toThrow();
    await expect(fs.access(`${lockPath}.bak`)).rejects.toThrow();
  });

  it("still takes over a lock whose heartbeat is older than 90 seconds", async () => {
    const dir = await dirWithDiagram();
    const lockPath = diagramLock(dir);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    const staleSince = new Date(Date.now() - 120_000).toISOString();
    await fs.writeFile(
      lockPath,
      `${JSON.stringify(
        lockRecord({
          instanceId: OTHER_ID,
          instanceName: "Engineer A",
          hostname: "laptop-a",
          acquiredAt: staleSince,
          heartbeatAt: staleSince,
          pid: process.pid,
        }),
      )}\n`,
    );
    const taken = await takeoverLock("Network Core.mmd", "tab-b");
    expect(taken.sessionId).toBe("tab-b");
    expect(Date.parse(taken.heartbeatAt)).toBeGreaterThan(Date.parse(staleSince));
    const stored = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockRecord;
    expect(stored.instanceId).not.toBe(OTHER_ID);
  });

  it("keeps a single instance able to replace its own dead pid and refresh in place", async () => {
    const dir = await dirWithDiagram();
    const identity = await getInstanceIdentity();
    const lockPath = diagramLock(dir);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(
      lockPath,
      `${JSON.stringify(
        lockRecord({
          instanceId: identity.instanceId,
          instanceName: identity.instanceName,
          hostname: os.hostname(),
          pid: 2_147_483_646,
        }),
      )}\n`,
    );
    const taken = await acquireLock("Network Core.mmd", "tab-local");
    expect(taken.token).toBeTruthy();
    await heartbeatLock("Network Core.mmd", taken.token);
    const names = await fs.readdir(path.dirname(lockPath));
    expect(names.some((name) => name.endsWith(".bak") || name.endsWith(".tmp"))).toBe(false);
    const stored = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockRecord;
    expect(stored.token).toBe(taken.token);
    expect(stored.pid).toBe(process.pid);
  });

  it("refreshes the instance lock in place", async () => {
    await dirWithDiagram();
    await claimInstanceLock();
    await refreshInstanceLockForTests();
    const { getMetaPath } = await import("../src/paths.js");
    const names = await fs.readdir(getMetaPath());
    expect(names).toContain("instance-lock.json");
    expect(names.some((name) => name === "instance-lock.json.bak" || name.endsWith(".tmp"))).toBe(false);
    expect(backgroundWritersPaused()).toBe(false);
  });

  it("copies a Docker instance file off the volume and does not rewrite it", async () => {
    const dir = await dirWithDiagram();
    const legacy = path.join(dir, ".meta", "instance.json");
    const legacyBody = `${JSON.stringify({
      instanceId: "11111111-1111-4111-8111-111111111111",
      instanceName: "Lab",
      hostname: "old-host",
      listenHost: "127.0.0.1",
    })}\n`;
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, legacyBody);
    const target = containerInstanceFilePath();
    const previousTarget = await fs.readFile(target, "utf8").catch(() => null);
    await fs.rm(target, { force: true });
    delete process.env.NERDGRAM_INSTANCE_FILE;
    process.env.NERDGRAM_INSTALL = "docker";
    clearInstanceIdentityCache();
    try {
      const identity = await getInstanceIdentity();
      expect(identity.instanceName).toBe("Lab");
      expect(identity.instanceId).toBe("11111111-1111-4111-8111-111111111111");
      expect(await fs.readFile(legacy, "utf8")).toBe(legacyBody);
      const saved = JSON.parse(await fs.readFile(target, "utf8")) as { hostname?: string };
      expect(saved.hostname).toBe(os.hostname());
    } finally {
      if (previousTarget == null) await fs.rm(target, { force: true });
      else await fs.writeFile(target, previousTarget);
    }
  });

  it("gives a second Docker process a new id when the shared id is already held", async () => {
    const dir = await dirWithDiagram();
    const legacyId = "11111111-1111-4111-8111-111111111111";
    const legacy = path.join(dir, ".meta", "instance.json");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(
      legacy,
      `${JSON.stringify({ instanceId: legacyId, instanceName: "Lab", hostname: "old-host" })}\n`,
    );
    await fs.writeFile(
      path.join(dir, ".meta", "instance-lock.json"),
      `${JSON.stringify({
        instanceId: legacyId,
        hostname: "other-host",
        pid: 4242,
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        port: null,
      })}\n`,
    );
    const target = containerInstanceFilePath();
    const previousTarget = await fs.readFile(target, "utf8").catch(() => null);
    await fs.rm(target, { force: true });
    delete process.env.NERDGRAM_INSTANCE_FILE;
    process.env.NERDGRAM_INSTALL = "docker";
    clearInstanceIdentityCache();
    try {
      const identity = await getInstanceIdentity();
      expect(identity.instanceName).toBe("Lab");
      expect(identity.instanceId).not.toBe(legacyId);
      expect(await fs.readFile(legacy, "utf8")).toContain(legacyId);
      expect(await fs.readFile(legacy, "utf8")).toContain("old-host");
    } finally {
      if (previousTarget == null) await fs.rm(target, { force: true });
      else await fs.writeFile(target, previousTarget);
    }
  });

  it("writes a saved Docker name onto the volume and does not overwrite a held copy", async () => {
    const dir = await dirWithDiagram();
    const legacy = path.join(dir, ".meta", "instance.json");
    const target = containerInstanceFilePath();
    const previousTarget = await fs.readFile(target, "utf8").catch(() => null);
    await fs.rm(target, { force: true });
    delete process.env.NERDGRAM_INSTANCE_FILE;
    process.env.NERDGRAM_INSTALL = "docker";
    clearInstanceIdentityCache();
    try {
      await saveInstanceName("Lab");
      const saved = JSON.parse(await fs.readFile(legacy, "utf8")) as { instanceName?: string; instanceId?: string };
      expect(saved.instanceName).toBe("Lab");
      const held = await fs.readFile(legacy, "utf8");
      await fs.writeFile(
        path.join(dir, ".meta", "instance-lock.json"),
        `${JSON.stringify({
          instanceId: OTHER_ID,
          hostname: "other-host",
          pid: 4242,
          startedAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        })}\n`,
      );
      clearInstanceIdentityCache();
      await saveInstanceName("Other");
      expect(await fs.readFile(legacy, "utf8")).toBe(held);
      const local = JSON.parse(await fs.readFile(target, "utf8")) as { instanceName?: string };
      expect(local.instanceName).toBe("Other");
    } finally {
      if (previousTarget == null) await fs.rm(target, { force: true });
      else await fs.writeFile(target, previousTarget);
    }
  });

  it("notes a different install and warns when the instance id matches", async () => {
    const dir = await dirWithDiagram();
    const identity = await getInstanceIdentity();
    const lockPath = path.join(dir, ".meta", "instance-lock.json");
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(
      lockPath,
      `${JSON.stringify({
        instanceId: OTHER_ID,
        hostname: "other-host",
        pid: 4242,
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      })}\n`,
    );
    resetInstanceLockForTests();
    await claimInstanceLock();
    expect(backgroundWritersPaused()).toBe(true);
    expect(currentInstanceConflict()?.sameInstall).toBe(false);
    const { dataHealthReport, ensureDataPrepared } = await import("../src/dataHealth.js");
    resetDataHealthForTests();
    await ensureDataPrepared();
    const other = dataHealthReport().issues.find((issue) => issue.code === "instance-conflict");
    expect(other?.severity).toBe("info");
    expect(other?.message).toContain("expected when two installs share one library");

    resetDataHealthForTests();
    resetInstanceLockForTests();
    clearInstanceIdentityCache();
    await fs.writeFile(
      lockPath,
      `${JSON.stringify({
        instanceId: identity.instanceId,
        hostname: "other-host",
        pid: 4242,
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      })}\n`,
    );
    await ensureDataPrepared();
    const same = dataHealthReport().issues.find((issue) => issue.code === "instance-conflict");
    expect(same?.severity).toBe("warn");
    expect(same?.message).toContain("same install");
    const again = await getInstanceIdentity();
    expect(again.instanceId).not.toBe(identity.instanceId);
  });
});
