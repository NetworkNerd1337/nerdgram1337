import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { main } from "../src/cli.js";
import { clearInstanceIdentityCache, getInstanceIdentity } from "../src/instanceConfig.js";
import { acquireLock, lockIsStale, type LockRecord } from "../src/locks.js";
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
    await fs.writeFile(
      lockPath,
      JSON.stringify(
        record({
          instanceId: OTHER_ID,
          instanceName: "Engineer A",
          hostname: "laptop-a",
          heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
          pid: process.pid,
        }),
      ),
    );
    const taken = await acquireLock("Network Core.mmd", "tab-two");
    expect(taken.sessionId).toBe("tab-two");
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
