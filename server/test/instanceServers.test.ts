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

async function post(port: number, pathname: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: `127.0.0.1:${port}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, json };
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
});
