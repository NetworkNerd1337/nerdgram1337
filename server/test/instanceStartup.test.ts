import fs from "node:fs";
import http from "node:http";
import fsp from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDataHealthForTests } from "../src/dataHealth.js";
import { resetInstanceStartupForTests } from "../src/instanceConfig.js";
import { closeServers, startServer } from "../src/listen.js";
import { makeTempDataDir } from "./helpers.js";

const OLD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function httpJson(port: number, urlPath: string): Promise<{ status: number; body: { issues?: { message: string }[]; ok?: boolean } }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "GET", headers: { Host: `127.0.0.1:${port}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? (JSON.parse(text) as { issues?: { message: string }[] }) : {} });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("startup when the instance file cannot be read", () => {
  const servers: Server[] = [];
  let cleanup = async () => {};
  let dir = "";
  let previousInstance: string | undefined;
  const warn = console.warn;

  afterEach(async () => {
    console.warn = warn;
    vi.restoreAllMocks();
    await closeServers(servers);
    servers.length = 0;
    if (previousInstance === undefined) delete process.env.NERDGRAM_INSTANCE_FILE;
    else process.env.NERDGRAM_INSTANCE_FILE = previousInstance;
    await cleanup();
    cleanup = async () => {};
    dir = "";
    resetInstanceStartupForTests();
    resetDataHealthForTests();
  });

  async function boot(prepare: (instanceFile: string) => void, read?: (file: string) => void): Promise<{ port: number; warnings: string[] }> {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    previousInstance = process.env.NERDGRAM_INSTANCE_FILE;
    const instanceFile = path.join(dir, ".meta", "instance.json");
    await fsp.mkdir(path.dirname(instanceFile), { recursive: true });
    await fsp.writeFile(path.join(dir, "Library.mmd"), "flowchart LR\n  A[Keep] --> B[This]\n", "utf8");
    await fsp.writeFile(path.join(dir, ".meta", "._instance.json"), "appledouble", "utf8");
    prepare(instanceFile);
    process.env.NERDGRAM_INSTANCE_FILE = instanceFile;
    resetInstanceStartupForTests();
    resetDataHealthForTests();
    if (read) {
      const original = fs.readFileSync;
      vi.spyOn(fs, "readFileSync").mockImplementation(((file, options) => {
        if (file === instanceFile) read(file);
        return original(file, options);
      }) as typeof fs.readFileSync);
    }
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };
    const started = await startServer({ port: 0, hosts: ["127.0.0.1"], mode: "production" });
    servers.push(...started);
    return { port: (started[0].address() as AddressInfo).port, warnings };
  }

  async function expectBoot(port: number, warnings: string[]) {
    const warning = warnings.filter((line) => line.startsWith("NerdGram checked"));
    expect(warning).toHaveLength(1);
    expect(warning[0]).toContain("instance.json");
    expect(warning[0]).toContain("not your diagrams");
    expect(warning[0]).toContain("iCloud Drive");
    const health = await httpJson(port, "/api/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    const doctor = await httpJson(port, "/api/doctor");
    expect(doctor.status).toBe(200);
    const messages = (doctor.body.issues ?? []).map((issue) => issue.message).join("\n");
    expect(messages).toContain("iCloud Drive");
    expect(messages).toContain("SMB or NFS share");
    const diagram = await fsp.readFile(path.join(dir, "Library.mmd"), "utf8");
    expect(diagram).toContain("Keep");
    expect(await fsp.readFile(path.join(dir, ".meta", "._instance.json"), "utf8")).toBe("appledouble");
    const names = await fsp.readdir(dir);
    expect(names.some((name) => name.includes(".unreadable-"))).toBe(false);
  }

  it("boots when the instance file read throws EIO", async () => {
    const { port, warnings } = await boot(
      (file) => fs.writeFileSync(file, `${JSON.stringify({ instanceId: OLD_ID })}\n`),
      () => {
        throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO", errno: -5, syscall: "read" });
      },
    );
    await expectBoot(port, warnings);
    const aside = (await fsp.readdir(path.join(dir, ".meta"))).find((name) => name.startsWith("instance.json.unreadable-"));
    expect(aside).toBeTruthy();
  });

  it("boots when the instance file is not readable", async () => {
    const { port, warnings } = await boot((file) => {
      fs.writeFileSync(file, `${JSON.stringify({ instanceId: OLD_ID })}\n`);
      fs.chmodSync(file, 0o000);
    });
    await expectBoot(port, warnings);
  });

  it("boots when a directory is where the instance file should be", async () => {
    const { port, warnings } = await boot((file) => {
      fs.mkdirSync(file);
    });
    await expectBoot(port, warnings);
    const aside = (await fsp.readdir(path.join(dir, ".meta"))).find((name) => name.startsWith("instance.json.unreadable-"));
    expect(aside).toBeTruthy();
    expect(fs.statSync(path.join(dir, ".meta", aside ?? ""))).toBeTruthy();
  });

  it("boots when the instance file is invalid JSON", async () => {
    const { port, warnings } = await boot((file) => {
      fs.writeFileSync(file, "{not json");
    });
    await expectBoot(port, warnings);
  });

  it("boots on an older instance file and keeps that id", async () => {
    const { port } = await boot((file) => {
      fs.writeFileSync(file, `${JSON.stringify({ id: OLD_ID, name: "Studio", host: "127.0.0.1" })}\n`);
    });
    const health = await httpJson(port, "/api/health");
    expect(health.status).toBe(200);
    const instance = await httpJson(port, "/api/instance");
    expect(instance.status).toBe(200);
    expect(JSON.stringify(instance.body)).toContain(OLD_ID);
    expect(JSON.stringify(instance.body)).toContain("Studio");
    const saved = JSON.parse(fs.readFileSync(path.join(dir, ".meta", "instance.json"), "utf8")) as { instanceId?: string };
    expect(saved.instanceId).toBe(OLD_ID);
    expect(fs.readFileSync(path.join(dir, "Library.mmd"), "utf8")).toContain("Keep");
  });
});
