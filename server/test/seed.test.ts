import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDataPrepared, resetDataHealthForTests } from "../src/dataHealth.js";
import { bundledSampleFiles, seedEmptyDataDir } from "../src/seed.js";
import { makeTempDataDir } from "./helpers.js";

describe("sample seed", () => {
  let cleanup = async () => {};

  afterEach(async () => {
    resetDataHealthForTests();
    await cleanup();
    cleanup = async () => {};
  });

  it("copies the samples into an empty data directory and does not overwrite later", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    expect(await seedEmptyDataDir()).toBe(true);
    const welcome = path.join(temp.dir, "Welcome.mmd");
    const original = await fs.readFile(welcome, "utf8");
    expect(original.length).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(temp.dir, "Examples", "Sequence.mmd"), "utf8")).toContain("sequence");
    expect(await fs.readFile(path.join(temp.dir, "WAN.mmd"), "utf8")).toContain("nerdgram:Sites/Atlanta.mmd");
    expect(await fs.readFile(path.join(temp.dir, "Sites", "Atlanta.mmd"), "utf8")).toContain("nerdgram:WAN.mmd");
    const samples = await bundledSampleFiles();
    expect(samples.length).toBeGreaterThanOrEqual(5);
    for (const relative of samples) {
      const seeded = await fs.readFile(path.join(temp.dir, relative), "utf8");
      expect(seeded.length, relative).toBeGreaterThan(0);
    }
    await fs.writeFile(welcome, "flowchart LR\n  Edited\n");
    expect(await seedEmptyDataDir()).toBe(false);
    expect(await fs.readFile(welcome, "utf8")).toContain("Edited");
  });

  it("still seeds when the only entry is an empty .meta from the startup probe", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    await fs.mkdir(path.join(temp.dir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(temp.dir, ".meta", ".ng-1-abcd.tmp"), "probe");
    expect(await seedEmptyDataDir()).toBe(true);
    expect(await fs.readFile(path.join(temp.dir, "Welcome.mmd"), "utf8")).toBeTruthy();
  });

  it("seeds a brand-new directory after the Phase 2 startup check", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    resetDataHealthForTests();
    await ensureDataPrepared();
    expect(await fs.readFile(path.join(temp.dir, ".meta", "instance-lock.json"), "utf8")).toContain("instanceId");
    expect(await seedEmptyDataDir()).toBe(true);
    expect((await fs.readFile(path.join(temp.dir, "Welcome.mmd"), "utf8")).length).toBeGreaterThan(0);
  });

  it("seeds when .meta holds only the instance lock, backups, or quarantine", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const meta = path.join(temp.dir, ".meta");
    await fs.mkdir(path.join(meta, "backups", "0-1700000000000"), { recursive: true });
    await fs.mkdir(path.join(meta, "quarantine", "1700000000000-abcdef"), { recursive: true });
    await fs.writeFile(
      path.join(meta, "instance-lock.json"),
      `${JSON.stringify({ instanceId: "x", hostname: "h", pid: 1, startedAt: "t", heartbeatAt: "t" })}\n`,
    );
    expect(await seedEmptyDataDir()).toBe(true);
    expect(await fs.readFile(path.join(temp.dir, "Welcome.mmd"), "utf8")).toBeTruthy();
  });

  it("does not seed when .meta already has saved state", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    await fs.mkdir(path.join(temp.dir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(temp.dir, ".meta", "updates.json"), "{}\n");
    expect(await seedEmptyDataDir()).toBe(false);
    await expect(fs.access(path.join(temp.dir, "Welcome.mmd"))).rejects.toThrow();
  });
});
