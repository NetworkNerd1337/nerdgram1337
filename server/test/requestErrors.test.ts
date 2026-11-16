import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { lockStorageKey } from "../src/locks.js";
import { captureConsole, makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = { Host: HOST, Origin: "http://127.0.0.1:8787", "Content-Type": "application/json" };

describe("JSON body errors and long names", () => {
  let dir = "";
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns JSON for a malformed body and a body over the limit, and logs one line", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const logs = captureConsole();
    try {
      const bad = await request(app).post("/api/file").set(json).send("{bad");
      expect(bad.status).toBe(400);
      expect(bad.headers["content-type"]).toMatch(/json/);
      expect(bad.body).toEqual({ error: "Request body is not valid JSON.", code: "invalid" });
      expect(JSON.stringify(bad.body)).not.toMatch(/\/|at parse|node_modules/);

      const text = await request(app).post("/api/file").set(json).send(JSON.stringify("str"));
      expect(text.status).toBe(400);
      expect(text.body.code).toBe("invalid");
      expect(text.headers["content-type"]).toMatch(/json/);

      const huge = await request(app)
        .post("/api/file")
        .set(json)
        .send({ path: "Big.mmd", content: "x".repeat(5 * 1024 * 1024) });
      expect(huge.status).toBe(413);
      expect(huge.body).toEqual({ error: "Request body is too large.", code: "too_large" });
      expect(JSON.stringify(huge.body)).not.toMatch(/node_modules|ENAMETOOLONG/);
    } finally {
      logs.restore();
    }

    expect(logs.errors.length).toBeGreaterThan(0);
    for (const line of logs.errors) {
      expect(line).not.toMatch(/\n/);
      expect(line).not.toMatch(/at parse|node_modules|SyntaxError/);
    }
  });

  it("rejects an over-long name with 400 and can lock a long legal name", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const tooLong = `${"x".repeat(300)}.mmd`;
    const rejected = await request(app).put("/api/file").set(json).send({ path: tooLong, content: "flowchart LR\n  A-->B\n" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("invalid");
    expect(rejected.body.error).toMatch(/too long/i);
    expect(rejected.body.error).not.toMatch(/\/tmp|ENAMETOOLONG|node_modules/);

    const legal = `${"n".repeat(250)}.mmd`;
    const written = await request(app).put("/api/file").set(json).send({ path: legal, content: "flowchart LR\n  A-->B\n" });
    expect(written.status).toBe(200);
    const key = lockStorageKey(legal);
    expect(key.startsWith("h_")).toBe(true);
    expect(Buffer.byteLength(`${key}.json`)).toBeLessThanOrEqual(255);
    await expect(fs.access(path.join(dir, legal))).resolves.toBeUndefined();
  });
});
