import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { encodeStorageKey } from "../src/storage.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIAGRAM = "Network Core.mmd";

type Instance = {
  port: number;
  stop: () => Promise<void>;
};

function startInstance(env: NodeJS.ProcessEnv): Promise<Instance> {
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "test/instanceServer.ts"], {
    cwd: serverRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`instance did not start\n${buffer}`));
    }, 20_000);
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        child.kill("SIGKILL");
        reject(err);
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const match = /READY (\d+)/.exec(buffer);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        port: Number(match[1]),
        stop: () =>
          new Promise((done) => {
            if (child.exitCode != null) {
              done();
              return;
            }
            const killTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
            child.once("exit", () => {
              clearTimeout(killTimer);
              done();
            });
            child.kill("SIGTERM");
          }),
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
    });
    child.on("error", (err) => finish(err));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(`instance exited ${code ?? "null"}\n${buffer}`));
    });
  });
}

async function requestInstance(
  port: number,
  pathname: string,
  body?: unknown,
  connectHost = "127.0.0.1",
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`http://${connectHost}:${port}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Host: `${connectHost}:${port}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, json };
}

async function post(port: number, pathname: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return requestInstance(port, pathname, body);
}

describe("two instances, one diagram folder", () => {
  const stops: Array<() => Promise<void>> = [];
  const extraDirs: string[] = [];
  let dir = "";

  afterEach(async () => {
    await Promise.all(stops.splice(0).map((stop) => stop()));
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = "";
    await Promise.all(extraDirs.splice(0).map((extra) => fs.rm(extra, { recursive: true, force: true })));
  });

  it("returns 423 with the holder's identity, then allows takeover once the lock is stale", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-shared-"));
    const instanceDir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-instances-"));
    extraDirs.push(instanceDir);
    await fs.writeFile(path.join(dir, DIAGRAM), "flowchart LR\n  Core-->Edge\n");
    const instanceA = path.join(instanceDir, "instance-a.json");
    const instanceB = path.join(instanceDir, "instance-b.json");
    await fs.writeFile(
      instanceA,
      `${JSON.stringify(
        {
          instanceId: "11111111-1111-4111-8111-111111111111",
          instanceName: "Engineer A",
          hostname: "laptop-a",
        },
        null,
        2,
      )}\n`,
    );
    await fs.writeFile(
      instanceB,
      `${JSON.stringify(
        {
          instanceId: "22222222-2222-4222-8222-222222222222",
          instanceName: "Engineer B",
          hostname: "laptop-b",
        },
        null,
        2,
      )}\n`,
    );
    const baseEnv = { ...process.env, HOST: "", NERDGRAM_INSTALL: "", NERDGRAM_DATA_DIR: dir };
    const first = await startInstance({ ...baseEnv, NERDGRAM_INSTANCE_FILE: instanceA });
    stops.push(first.stop);
    const second = await startInstance({ ...baseEnv, NERDGRAM_INSTANCE_FILE: instanceB });
    stops.push(second.stop);

    const opened = await post(first.port, "/api/lock", { path: DIAGRAM, sessionId: "tab-a" });
    expect(opened.status).toBe(200);

    const blocked = await post(second.port, "/api/lock", { path: DIAGRAM, sessionId: "tab-b" });
    expect(blocked.status).toBe(423);
    expect(blocked.json.code).toBe("locked");
    const lock = blocked.json.lock as {
      instanceId: string;
      instanceName: string;
      hostname: string;
      acquiredAt: string;
      heartbeatAt: string;
      sameInstance: boolean;
    };
    expect(lock.instanceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(lock.instanceName).toBe("Engineer A");
    expect(lock.hostname).toBe(os.hostname());
    expect(lock.sameInstance).toBe(false);
    expect(typeof lock.acquiredAt).toBe("string");
    expect(typeof lock.heartbeatAt).toBe("string");
    expect(blocked.json.error).toMatch(/Network Core is open on Engineer A/);

    await stops.shift()?.();
    const still = await post(second.port, "/api/lock", { path: DIAGRAM, sessionId: "tab-b" });
    expect(still.status).toBe(423);
    expect((still.json.lock as { instanceName: string }).instanceName).toBe("Engineer A");

    const lockPath = path.join(dir, ".meta", "locks", `${encodeStorageKey(DIAGRAM)}.json`);
    const stored = JSON.parse(await fs.readFile(lockPath, "utf8")) as { heartbeatAt: string };
    stored.heartbeatAt = new Date(Date.now() - 120_000).toISOString();
    await fs.writeFile(lockPath, JSON.stringify(stored));

    const takeover = await post(second.port, "/api/lock/takeover", { path: DIAGRAM, sessionId: "tab-b" });
    expect(takeover.status).toBe(200);
    expect(typeof takeover.json.token).toBe("string");
    const held = JSON.parse(await fs.readFile(lockPath, "utf8")) as { instanceId: string; instanceName: string };
    expect(held.instanceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(held.instanceName).toBe("Engineer B");
  }, 40_000);

  it("keeps an independent Host for each instance that shares one folder", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-shared-"));
    const instanceDir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-instances-"));
    extraDirs.push(instanceDir);
    const legacy = path.join(dir, ".meta", "listen-host.json");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, `${JSON.stringify({ host: "10.9.9.9" })}\n`);
    const instanceA = path.join(instanceDir, "instance-a.json");
    const instanceB = path.join(instanceDir, "instance-b.json");
    await fs.writeFile(
      instanceA,
      `${JSON.stringify({ instanceId: "11111111-1111-4111-8111-111111111111", instanceName: "Engineer A" }, null, 2)}\n`,
    );
    await fs.writeFile(
      instanceB,
      `${JSON.stringify({ instanceId: "22222222-2222-4222-8222-222222222222", instanceName: "Engineer B" }, null, 2)}\n`,
    );
    const baseEnv = {
      ...process.env,
      HOST: "",
      NERDGRAM_INSTALL: "",
      NERDGRAM_DATA_DIR: dir,
      NERDGRAM_TEST_FIXED_BIND: "1",
    };

    const first = await startInstance({ ...baseEnv, NERDGRAM_INSTANCE_FILE: instanceA });
    stops.push(first.stop);
    const second = await startInstance({ ...baseEnv, NERDGRAM_INSTANCE_FILE: instanceB });
    stops.push(second.stop);

    expect((await requestInstance(first.port, "/api/host")).json.saved).toBe("10.9.9.9");
    expect((await requestInstance(second.port, "/api/host")).json.saved).toBe("10.9.9.9");

    expect((await post(first.port, "/api/host", { host: "127.0.0.2" })).status).toBe(200);
    expect((await post(second.port, "/api/host", { host: "127.0.0.3" })).status).toBe(200);
    expect((await requestInstance(first.port, "/api/host")).json.saved).toBe("127.0.0.2");
    expect((await requestInstance(second.port, "/api/host")).json.saved).toBe("127.0.0.3");
    expect(JSON.parse(await fs.readFile(legacy, "utf8"))).toEqual({ host: "10.9.9.9" });

    await fs.writeFile(legacy, `${JSON.stringify({ host: "10.8.8.8" })}\n`);
    await stops.shift()?.();
    await stops.shift()?.();
    const againA = await startInstance({ ...baseEnv, NERDGRAM_INSTANCE_FILE: instanceA });
    stops.push(againA.stop);
    const againB = await startInstance({ ...baseEnv, NERDGRAM_INSTANCE_FILE: instanceB });
    stops.push(againB.stop);
    expect((await requestInstance(againA.port, "/api/host")).json.saved).toBe("127.0.0.2");
    expect((await requestInstance(againB.port, "/api/host")).json.saved).toBe("127.0.0.3");
    expect(JSON.parse(await fs.readFile(legacy, "utf8"))).toEqual({ host: "10.8.8.8" });
    const fileA = JSON.parse(await fs.readFile(instanceA, "utf8")) as { listenHost?: string };
    const fileB = JSON.parse(await fs.readFile(instanceB, "utf8")) as { listenHost?: string };
    expect(fileA.listenHost).toBe("127.0.0.2");
    expect(fileB.listenHost).toBe("127.0.0.3");
  }, 40_000);

  it("applies a new Host and a new Diagram folder after one restart", async () => {
    const current = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-current-"));
    const next = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-next-"));
    extraDirs.push(current, next);
    const instanceDir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-instances-"));
    extraDirs.push(instanceDir);
    const instanceFile = path.join(instanceDir, "instance.json");
    await fs.writeFile(
      instanceFile,
      `${JSON.stringify(
        {
          instanceId: "33333333-3333-4333-8333-333333333333",
          instanceName: "Engineer A",
          NERDGRAM_DATA_DIR: current,
        },
        null,
        2,
      )}\n`,
    );
    const env = { ...process.env, NERDGRAM_INSTANCE_FILE: instanceFile, NERDGRAM_TEST_FIXED_BIND: "1" };
    delete env.HOST;
    delete env.NERDGRAM_INSTALL;
    delete env.NERDGRAM_DATA_DIR;

    const first = await startInstance(env);
    stops.push(first.stop);
    expect((await requestInstance(first.port, "/api/data-dir")).json.running).toBe(current);
    expect((await post(first.port, "/api/host", { host: "127.0.0.2" })).status).toBe(200);
    const savedDir = await post(first.port, "/api/data-dir", { path: next });
    expect(savedDir.status).toBe(200);
    expect(savedDir.json.restartNotice).toBe(true);
    expect(savedDir.json.running).toBe(current);
    await expect(fs.access(path.join(current, ".meta", "listen-host.json"))).rejects.toThrow();
    await stops.shift()?.();

    const restarted = await startInstance({ ...env, NERDGRAM_TEST_FIXED_BIND: "0" });
    stops.push(restarted.stop);
    const host = await requestInstance(restarted.port, "/api/host", undefined, "127.0.0.2");
    expect(host.status).toBe(200);
    expect(host.json.saved).toBe("127.0.0.2");
    expect(host.json.running).toBe("127.0.0.2");
    expect(host.json.restartNotice).toBe(false);
    expect(host.json.effectiveHosts).toEqual(["127.0.0.2"]);
    const folder = await requestInstance(restarted.port, "/api/data-dir", undefined, "127.0.0.2");
    expect(folder.status).toBe(200);
    expect(folder.json.running).toBe(next);
    expect(folder.json.saved).toBe(next);
    expect(folder.json.restartNotice).toBe(false);
    await expect(fs.access(path.join(next, ".meta", "listen-host.json"))).rejects.toThrow();
  }, 40_000);
});
