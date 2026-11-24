import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { resetDataHealthForTests } from "../src/dataHealth.js";
import { makeTempDataDir } from "./helpers.js";

function lockBody(extra: { hostname: string; pid: number; heartbeatAt: string; port?: number }) {
  return `${JSON.stringify({
    instanceId: "22222222-2222-4222-8222-222222222222",
    hostname: extra.hostname,
    pid: extra.pid,
    startedAt: extra.heartbeatAt,
    heartbeatAt: extra.heartbeatAt,
    ...(extra.port ? { port: extra.port } : {}),
  })}\n`;
}

describe("doctor and the instance lock", () => {
  let cleanup = async () => {};

  afterEach(async () => {
    resetDataHealthForTests();
    await cleanup();
    cleanup = async () => {};
  });

  async function writeLock(body: string): Promise<{ dir: string; file: string }> {
    resetDataHealthForTests();
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const file = path.join(temp.dir, ".meta", "instance-lock.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    return { dir: temp.dir, file };
  }

  it("does not report a conflict when a live server on this machine holds the lock", async () => {
    const heartbeatAt = new Date().toISOString();
    const { dir, file } = await writeLock(lockBody({ hostname: os.hostname(), pid: process.ppid, heartbeatAt }));
    await fs.writeFile(path.join(dir, ".meta", "updates.json"), "");
    const before = await fs.readFile(file, "utf8");
    const stdout: string[] = [];
    const code = await main(["doctor"], { stdout: (chunk) => stdout.push(chunk) });
    const text = stdout.join("");
    expect(code).toBe(1);
    expect(text).toContain("updates.json");
    expect(text).toContain(`NerdGram is running (pid ${process.ppid}, heartbeat`);
    expect(text).not.toContain("Two instances");
    expect(text).not.toContain("instance-conflict");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("uses the running server's doctor report when the lock records a port", async () => {
    const heartbeatAt = new Date().toISOString();
    const { file } = await writeLock(lockBody({ hostname: os.hostname(), pid: process.ppid, heartbeatAt, port: 8787 }));
    const before = await fs.readFile(file, "utf8");
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          status: "warn",
          writable: true,
          issues: [{ code: "low-space", message: "Free space is low." }],
          instanceConflict: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const stdout: string[] = [];
      const code = await main(["doctor"], { stdout: (chunk) => stdout.push(chunk) });
      const text = stdout.join("");
      expect(code).toBe(1);
      expect(text).toContain("Free space is low.");
      expect(text).not.toContain("Two instances");
      expect(text).not.toContain("NerdGram is running");
      expect(await fs.readFile(file, "utf8")).toBe(before);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses --repair and --restore while a live server holds the lock", async () => {
    const heartbeatAt = new Date().toISOString();
    const { dir, file } = await writeLock(lockBody({ hostname: os.hostname(), pid: process.ppid, heartbeatAt }));
    await fs.writeFile(path.join(dir, ".meta", "updates.json"), "");
    const before = await fs.readFile(file, "utf8");
    const stderr: string[] = [];
    const repair = await main(["doctor", "--repair"], { stderr: (chunk) => stderr.push(chunk) });
    expect(repair).toBe(2);
    expect(stderr.join("")).toContain("Stop NerdGram");
    expect(await fs.readFile(path.join(dir, ".meta", "updates.json"), "utf8")).toBe("");
    const restoreErr: string[] = [];
    const restore = await main(["doctor", "--restore", "1700000000000-abcdef"], { stderr: (chunk) => restoreErr.push(chunk) });
    expect(restore).toBe(2);
    expect(restoreErr.join("")).toContain("Settings");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("leaves a stale lock in place and does not call it a conflict", async () => {
    const heartbeatAt = new Date(Date.now() - 120_000).toISOString();
    const { file } = await writeLock(lockBody({ hostname: os.hostname(), pid: 999999, heartbeatAt }));
    const before = await fs.readFile(file, "utf8");
    const stdout: string[] = [];
    const code = await main(["doctor"], { stdout: (chunk) => stdout.push(chunk) });
    const text = stdout.join("");
    expect(code).toBe(0);
    expect(text).not.toContain("Two instances");
    expect(text).not.toContain("NerdGram is running");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("still reports a lock held by another host", async () => {
    const heartbeatAt = new Date().toISOString();
    const { file } = await writeLock(lockBody({ hostname: "other-host", pid: 4242, heartbeatAt }));
    const before = await fs.readFile(file, "utf8");
    const stdout: string[] = [];
    const code = await main(["doctor"], { stdout: (chunk) => stdout.push(chunk) });
    expect(code).toBe(1);
    expect(stdout.join("")).toContain("Two instances share this data folder");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
});
