import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { main } from "../src/cli.js";
import { clearInstanceIdentityCache, getInstanceIdentity } from "../src/instanceConfig.js";
import { acquireLock, currentBootId, lockIsStale, lockStorageKey, type LockRecord } from "../src/locks.js";
import { encodeStorageKey } from "../src/storage.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const OTHER_ID = "11111111-1111-4111-8111-111111111111";

function record(overrides: Partial<LockRecord> = {}): LockRecord {
  const now = new Date().toISOString();
  return {
    path: "Network Core.mmd",
    token: "token-1",
    sessionId: "tab-one",
    pid: 2_147_483_646,
    acquiredAt: now,
    heartbeatAt: now,
    ...overrides,
  };
}

describe("lock rules", () => {
  it("treats a same-instance dead pid as stale and another instance by heartbeat alone", () => {
    const now = Date.now();
    const fresh = new Date(now).toISOString();
    const old = new Date(now - 120_000).toISOString();
    const mine = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    expect(lockIsStale(record({ instanceId: mine, pid: 2_147_483_646, heartbeatAt: fresh }), now, mine)).toBe(true);
    expect(
      lockIsStale(
        record({ instanceId: mine, hostname: os.hostname(), pid: 2_147_483_646, heartbeatAt: fresh }),
        now,
        mine,
      ),
    ).toBe(true);
    expect(
      lockIsStale(
        record({ instanceId: mine, hostname: "other-host", pid: 2_147_483_646, heartbeatAt: fresh }),
        now,
        mine,
      ),
    ).toBe(false);
    const previousBoot = record({
      instanceId: mine,
      hostname: "old-container",
      bootId: "previous-boot",
      pid: process.pid,
      heartbeatAt: fresh,
    });
    expect(lockIsStale(previousBoot, now, mine, null)).toBe(true);
    expect(
      lockIsStale(previousBoot, now, mine, { bootId: "previous-boot", heartbeatAt: new Date(now - 120_000).toISOString() }),
    ).toBe(true);
    expect(lockIsStale(previousBoot, now, mine, { bootId: "previous-boot", heartbeatAt: fresh })).toBe(false);
    expect(lockIsStale(previousBoot, now, mine, { bootId: currentBootId(), heartbeatAt: fresh })).toBe(false);
    expect(
      lockIsStale(previousBoot, now, mine, {
        bootId: currentBootId(),
        instanceId: OTHER_ID,
        heartbeatAt: fresh,
      }),
    ).toBe(false);
    const restarted = record({
      instanceId: mine,
      hostname: os.hostname(),
      bootId: "previous-boot",
      pid: process.pid,
      heartbeatAt: fresh,
    });
    expect(
      lockIsStale(restarted, now, mine, {
        bootId: currentBootId(),
        instanceId: mine,
        heartbeatAt: fresh,
      }),
    ).toBe(true);
    expect(
      lockIsStale(restarted, now, mine, {
        bootId: "other-live-boot",
        instanceId: mine,
        heartbeatAt: fresh,
      }),
    ).toBe(false);
    expect(
      lockIsStale(restarted, now, mine, {
        bootId: currentBootId(),
        instanceId: mine,
        heartbeatAt: new Date(now - 120_000).toISOString(),
      }),
    ).toBe(false);
    expect(lockIsStale(restarted, now, mine, "unreadable")).toBe(false);
    expect(lockIsStale(previousBoot, now, mine, "unreadable")).toBe(false);
    expect(
      lockIsStale(
        record({
          instanceId: mine,
          hostname: os.hostname(),
          bootId: "previous-boot",
          pid: 2_147_483_646,
          heartbeatAt: fresh,
        }),
        now,
        mine,
        { bootId: "previous-boot", heartbeatAt: fresh },
      ),
    ).toBe(true);
    expect(
      lockIsStale(
        record({
          instanceId: mine,
          hostname: os.hostname(),
          bootId: currentBootId(),
          pid: process.pid,
          heartbeatAt: fresh,
        }),
        now,
        mine,
      ),
    ).toBe(false);
    expect(
      lockIsStale(
        record({
          instanceId: OTHER_ID,
          hostname: "laptop-a",
          bootId: "other-boot",
          pid: process.pid,
          heartbeatAt: fresh,
        }),
        now,
        mine,
      ),
    ).toBe(false);
    expect(
      lockIsStale(record({ instanceId: OTHER_ID, pid: 2_147_483_646, heartbeatAt: fresh }), now, mine),
    ).toBe(false);
    expect(lockIsStale(record({ instanceId: OTHER_ID, pid: process.pid, heartbeatAt: fresh }), now, mine)).toBe(
      false,
    );
    expect(lockIsStale(record({ instanceId: OTHER_ID, pid: process.pid, heartbeatAt: old }), now, mine)).toBe(true);
    expect(lockIsStale(record({ instanceId: mine, pid: process.pid, heartbeatAt: fresh }), now, mine)).toBe(false);
  });

  it("still reads a legacy lock that has no instance fields", () => {
    const now = Date.now();
    const legacy = record();
    delete legacy.instanceId;
    delete legacy.instanceName;
    delete legacy.hostname;
    expect(lockIsStale({ ...legacy, pid: 2_147_483_646 }, now, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(true);
    expect(lockIsStale({ ...legacy, pid: process.pid }, now, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(false);
    expect(
      lockIsStale(
        { ...legacy, pid: process.pid, heartbeatAt: new Date(now - 120_000).toISOString() },
        now,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    ).toBe(true);
  });

  it("keeps a short lock key and hashes one that would not fit in a filename", () => {
    expect(lockStorageKey("Notes.mmd")).toBe(encodeStorageKey("Notes.mmd"));
    const longName = `${"n".repeat(250)}.mmd`;
    const key = lockStorageKey(longName);
    expect(key.startsWith("h_")).toBe(true);
    expect(Buffer.byteLength(`${key}.json`)).toBeLessThanOrEqual(255);
    expect(lockStorageKey(longName)).toBe(key);
  });
});

describe("lock acquire across instances", () => {
  let cleanup = async () => {};

  afterEach(async () => {
    await cleanup();
    cleanup = async () => {};
    clearInstanceIdentityCache();
  });

  async function setup() {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    clearInstanceIdentityCache();
    await fs.writeFile(path.join(temp.dir, "Network Core.mmd"), "flowchart LR\n  A-->B\n");
    const identity = await getInstanceIdentity();
    const lockPath = path.join(temp.dir, ".meta", "locks", `${encodeStorageKey("Network Core.mmd")}.json`);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    return { dir: temp.dir, identity, lockPath };
  }

  it("keeps a fresh lock held while another live boot shares the instance id", async () => {
    const { dir, identity, lockPath } = await setup();
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(dir, ".meta", "instance-lock.json"),
      JSON.stringify({
        instanceId: identity.instanceId,
        hostname: "old-container",
        pid: 4242,
        startedAt: now,
        heartbeatAt: now,
        port: null,
        bootId: "other-live-boot",
      }),
    );
    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: identity.instanceId,
          hostname: "old-container",
          bootId: "other-live-boot",
          pid: process.pid,
          heartbeatAt: now,
          token: "live-other-boot",
          sessionId: "their-tab",
        }),
      ),
    );
    await expect(acquireLock("Network Core.mmd", "tab-here")).rejects.toMatchObject({
      status: 423,
      message: "This diagram is open in another window.",
    });
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).token).toBe("live-other-boot");
  });

  it("reopens a diagram immediately when this boot rewrote the instance lock", async () => {
    const { dir, identity, lockPath } = await setup();
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(dir, ".meta", "instance-lock.json"),
      JSON.stringify({
        instanceId: identity.instanceId,
        hostname: os.hostname(),
        pid: process.pid,
        startedAt: now,
        heartbeatAt: now,
        port: null,
        bootId: currentBootId(),
      }),
    );
    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: identity.instanceId,
          instanceName: identity.instanceName,
          hostname: os.hostname(),
          bootId: "previous-boot",
          pid: process.pid,
          heartbeatAt: now,
          token: "old-boot",
          sessionId: "tab-before-restart",
        }),
      ),
    );
    const taken = await acquireLock("Network Core.mmd", "tab-after-restart");
    expect(taken.token).not.toBe("old-boot");
    const stored = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockRecord;
    expect(stored.bootId).toBe(currentBootId());
  });

  it("keeps a fresh previous-boot lock held when the instance lock names another boot or cannot be read", async () => {
    const { dir, identity, lockPath } = await setup();
    const now = new Date().toISOString();
    const diagram = record({
      instanceId: identity.instanceId,
      hostname: os.hostname(),
      bootId: "previous-boot",
      pid: process.pid,
      heartbeatAt: now,
      token: "still-held",
      sessionId: "their-tab",
    });
    await fs.writeFile(
      path.join(dir, ".meta", "instance-lock.json"),
      JSON.stringify({
        instanceId: identity.instanceId,
        hostname: os.hostname(),
        pid: process.pid,
        startedAt: now,
        heartbeatAt: now,
        port: null,
        bootId: "other-live-boot",
      }),
    );
    await fs.writeFile(lockPath, JSON.stringify(diagram));
    await expect(acquireLock("Network Core.mmd", "tab-here")).rejects.toMatchObject({
      status: 423,
      message: "This diagram is open in another window.",
    });

    await fs.writeFile(path.join(dir, ".meta", "instance-lock.json"), "{not-json");
    await expect(acquireLock("Network Core.mmd", "tab-here")).rejects.toMatchObject({
      status: 423,
      message: "This diagram is open in another window.",
    });
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).token).toBe("still-held");
  });

  it("reopens a diagram after this install restarts, and still blocks a live tab or another instance", async () => {
    const { dir, identity, lockPath } = await setup();
    const now = new Date().toISOString();
    const staleBeat = new Date(Date.now() - 120_000).toISOString();
    await fs.writeFile(
      path.join(dir, ".meta", "instance-lock.json"),
      JSON.stringify({
        instanceId: identity.instanceId,
        hostname: "old-container",
        pid: 4242,
        startedAt: staleBeat,
        heartbeatAt: staleBeat,
        port: null,
        bootId: "previous-boot",
      }),
    );
    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: identity.instanceId,
          instanceName: identity.instanceName,
          hostname: "old-container",
          bootId: "previous-boot",
          pid: process.pid,
          heartbeatAt: now,
          token: "old-boot",
          sessionId: "tab-before-restart",
        }),
      ),
    );
    const taken = await acquireLock("Network Core.mmd", "tab-after-restart");
    expect(taken.token).not.toBe("old-boot");
    const stored = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockRecord;
    expect(stored.bootId).toBe(currentBootId());

    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: identity.instanceId,
          hostname: os.hostname(),
          bootId: currentBootId(),
          pid: process.pid,
          sessionId: "other-tab",
          token: "live-tab",
          heartbeatAt: new Date().toISOString(),
        }),
      ),
    );
    await expect(acquireLock("Network Core.mmd", "tab-two")).rejects.toMatchObject({
      status: 423,
      message: "This diagram is open in another window.",
    });

    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: OTHER_ID,
          instanceName: "Engineer B",
          hostname: "laptop-b",
          bootId: "their-boot",
          pid: 2_147_483_646,
          token: "held",
          heartbeatAt: new Date().toISOString(),
        }),
      ),
    );
    await expect(acquireLock("Network Core.mmd", "tab-three")).rejects.toMatchObject({
      status: 423,
      message: expect.stringMatching(/Engineer B/),
    });
  });

  it("lets this instance replace its own dead pid and blocks a fresh lock from someone else", async () => {
    const { identity, lockPath } = await setup();
    const now = new Date().toISOString();
    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: identity.instanceId,
          instanceName: identity.instanceName,
          hostname: identity.hostname,
          pid: 2_147_483_646,
          heartbeatAt: now,
        }),
      ),
    );
    const taken = await acquireLock("Network Core.mmd", "tab-two");
    expect(taken.token).toBeTruthy();

    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: OTHER_ID,
          instanceName: "Engineer A",
          hostname: "laptop-a",
          pid: 2_147_483_646,
          heartbeatAt: new Date().toISOString(),
          token: "held",
        }),
      ),
    );
    await expect(acquireLock("Network Core.mmd", "tab-three")).rejects.toMatchObject({
      status: 423,
      code: "locked",
      message: expect.stringMatching(/Network Core is open on Engineer A \(laptop-a\)/),
    });
  });

  it("takes over another instance once the heartbeat is old, and keeps a legacy lock readable", async () => {
    const { identity, lockPath } = await setup();
    const staleSince = new Date(Date.now() - 120_000).toISOString();
    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: OTHER_ID,
          instanceName: "Engineer A",
          hostname: "laptop-a",
          acquiredAt: staleSince,
          heartbeatAt: staleSince,
          pid: process.pid,
        }),
      ),
    );
    const before = Date.now();
    const taken = await acquireLock("Network Core.mmd", "tab-two");
    expect(taken.sessionId).toBe("tab-two");
    expect(taken.acquiredAt).not.toBe(staleSince);
    expect(Date.parse(taken.acquiredAt)).toBeGreaterThanOrEqual(before - 1000);
    const stored = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockRecord;
    expect(stored.instanceId).toBe(identity.instanceId);
    expect(stored.instanceName).toBe(identity.instanceName);
    expect(stored.hostname).toBe(identity.hostname);

    await fs.writeFile(
      lockPath,
      JSON.stringify({
        path: "Network Core.mmd",
        token: "legacy",
        sessionId: "tab-old",
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }),
    );
    await expect(acquireLock("Network Core.mmd", "tab-new")).rejects.toMatchObject({
      status: 423,
      code: "locked",
      message: "This diagram is open in another window.",
      details: { lock: { sameInstance: true, instanceId: null, instanceName: null, hostname: null } },
    });
  });
});

describe("CLI names the lock holder", () => {
  let cleanup = async () => {};

  afterEach(async () => {
    await cleanup();
    cleanup = async () => {};
  });

  it("prints the other instance in the error", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    await fs.writeFile(path.join(temp.dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    const lockPath = path.join(temp.dir, ".meta", "locks", `${encodeStorageKey("Notes.mmd")}.json`);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    const acquiredAt = new Date().toISOString();
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        path: "Notes.mmd",
        token: "held",
        sessionId: "tab-a",
        pid: 2_147_483_646,
        acquiredAt,
        heartbeatAt: acquiredAt,
        instanceId: OTHER_ID,
        instanceName: "Engineer A",
        hostname: "laptop-a",
      }),
    );
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1"] });
    const created = await request(app)
      .post("/api/tokens")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ name: "cli", scope: "read-write" });
    expect(created.status).toBe(201);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const stderr: string[] = [];
    try {
      const code = await main(
        ["put", "Notes.mmd", path.join(temp.dir, "Notes.mmd"), "--url", `http://127.0.0.1:${address.port}`, "--token", created.body.token as string],
        {
          stdout: () => undefined,
          stderr: (chunk: string) => stderr.push(chunk),
          env: {},
        },
      );
      expect(code).toBe(1);
      const text = stderr.join("");
      expect(text).toMatch(/Notes is open on Engineer A \(laptop-a\)/);
      expect(text).toMatch(/Try again when it's closed/);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
