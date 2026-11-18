import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function app() {
  return createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
}

describe("library routes skip an unreadable diagram", () => {
  let dir = "";
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    await fs.writeFile(path.join(dir, "Readable.mmd"), "flowchart LR\n  A --> B\n", "utf8");
    await fs.writeFile(path.join(dir, "Locked.mmd"), "flowchart LR\n  C --> D\n", "utf8");
    await fs.chmod(path.join(dir, "Locked.mmd"), 0o000);
  });

  afterEach(async () => {
    await fs.chmod(path.join(dir, "Locked.mmd"), 0o644).catch(() => {});
    await cleanup();
  });

  it("lists the file on diagram meta, tags, and link repairs without a 500", async () => {
    const server = app();
    const meta = await request(server).get("/api/diagram-meta").set("Host", HOST);
    expect(meta.status).toBe(200);
    expect(meta.body.diagrams.map((item: { path: string }) => item.path)).toEqual(["Readable.mmd"]);
    expect(meta.body.unreadable).toEqual([
      expect.objectContaining({ path: "Locked.mmd", code: "EACCES" }),
    ]);

    const tags = await request(server).get("/api/tags").set("Host", HOST);
    expect(tags.status).toBe(200);
    expect(Array.isArray(tags.body.tags)).toBe(true);
    expect(tags.body.unreadable).toEqual([
      expect.objectContaining({ path: "Locked.mmd", code: "EACCES" }),
    ]);

    const repairs = await request(server).get("/api/link-repairs").set("Host", HOST);
    expect(repairs.status).toBe(200);
    expect(repairs.body.applied).toBe(false);
    expect(repairs.body.unreadable).toEqual([
      expect.objectContaining({ path: "Locked.mmd", code: "EACCES" }),
    ]);

    const one = await request(server).get("/api/file").query({ path: "Locked.mmd" }).set("Host", HOST);
    expect(one.status).toBe(500);
    expect(one.body.code).toBe("unreadable");
  });
});
