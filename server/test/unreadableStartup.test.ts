import http from "node:http";
import fs from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { closeServers, startServer } from "../src/listen.js";
import { listUserFilesDetailed } from "../src/sync/layout.js";
import { makeTempDataDir } from "./helpers.js";

function httpJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { Host: `127.0.0.1:${port}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("startup with an unreadable diagram", () => {
  const servers: Server[] = [];
  let dir = "";
  let cleanup = async () => {};
  let warn = console.warn;

  afterEach(async () => {
    console.warn = warn;
    await closeServers(servers);
    servers.length = 0;
    if (dir) await fs.chmod(`${dir}/Unreadable.mmd`, 0o644).catch(() => {});
    await cleanup();
    cleanup = async () => {};
    dir = "";
  });

  it("listens and lists the file as unreadable", async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    await fs.writeFile(`${dir}/Readable.mmd`, "flowchart LR\n  A[Core] --> B[Edge]\n", "utf8");
    await fs.writeFile(`${dir}/Unreadable.mmd`, "flowchart LR\n  C --> D\n", "utf8");
    await fs.chmod(`${dir}/Unreadable.mmd`, 0o000);

    const warnings: string[] = [];
    warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };

    const started = await startServer({ port: 0, hosts: ["127.0.0.1"], mode: "production" });
    servers.push(...started);
    const port = (started[0].address() as AddressInfo).port;

    expect(warnings.some((line) => line.includes("Couldn't read Unreadable.mmd (EACCES)"))).toBe(true);

    const health = await httpJson(port, "/api/health");
    expect(health.status).toBe(200);

    const meta = await httpJson(port, "/api/diagram-meta");
    expect(meta.status).toBe(200);
    const body = meta.body as {
      diagrams: { path: string }[];
      unreadable: { path: string; code: string }[];
    };
    expect(body.diagrams.map((item) => item.path)).toContain("Readable.mmd");
    expect(body.unreadable).toEqual([expect.objectContaining({ path: "Unreadable.mmd", code: "EACCES" })]);

    const found = await httpJson(port, "/api/search?q=Core");
    expect(found.status).toBe(200);
    expect(JSON.stringify(found.body)).toContain("Readable.mmd");

    const links = await httpJson(port, "/api/diagram-links?path=Readable.mmd");
    expect(links.status).toBe(200);

    const listed = await listUserFilesDetailed(dir);
    expect([...listed.files.keys()]).toContain("Readable.mmd");
    expect(listed.files.has("Unreadable.mmd")).toBe(false);
    expect(listed.unreadable).toEqual([expect.objectContaining({ path: "Unreadable.mmd", code: "EACCES" })]);
  });
});
