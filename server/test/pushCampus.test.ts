import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import { promisify } from "node:util";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { REPO_ROOT } from "../src/paths.js";
import { makeTempDataDir } from "./helpers.js";

const execFileAsync = promisify(execFile);
const script = path.join(REPO_ROOT, "docs/samples/push-campus.sh");

describe("campus push script", () => {
  let cleanup = async () => {};
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
    await cleanup();
  });

  it("creates the diagram on the first run and updates it on the second", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const source = await fs.readFile(script, "utf8");
    expect(source).toContain("/api/v1/generate/upsert");
    expect(source).toContain("/api/v1/generate/preview");
    expect(source).toContain("/api/v1/schema/network.json");
    expect(source).toContain("/api/v1/openapi.json");
    expect(source).not.toContain("/api/v1/generate/refresh");
    expect(source).not.toMatch(/\/api\/v1\/generate"/);

    const portRef = { port: 8787 };
    const app = createApp({
      mode: "production",
      portRef,
      bindHosts: ["127.0.0.1", "::1"],
    });
    const token = await request(app)
      .post("/api/tokens")
      .set("Host", "127.0.0.1:8787")
      .set("Content-Type", "application/json")
      .send({ name: "push", scope: "read-write" });
    expect(token.status).toBe(201);

    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    portRef.port = address.port;
    const base = `http://127.0.0.1:${address.port}`;

    const first = await execFileAsync("sh", [script], {
      env: {
        ...process.env,
        NERDGRAM_URL: base,
        NERDGRAM_TOKEN: token.body.token as string,
        NERDGRAM_PATH: "Campus-L3.mmd",
        NERDGRAM_VIEW: "l3",
      },
    });
    expect(first.stdout).toContain("created\n");
    expect(first.stdout).toContain("Campus-L3.mmd");

    const saved = await request(app)
      .get("/api/v1/diagrams/content")
      .set("Host", `127.0.0.1:${address.port}`)
      .set("Authorization", `Bearer ${token.body.token}`)
      .query({ path: "Campus-L3.mmd" });
    expect(saved.status).toBe(200);
    const noted = `${saved.body.content}\n%% kept by hand\n`;
    const write = await request(app)
      .put("/api/v1/diagrams")
      .set("Host", `127.0.0.1:${address.port}`)
      .set("Authorization", `Bearer ${token.body.token}`)
      .set("Content-Type", "application/json")
      .send({ path: "Campus-L3.mmd", content: noted, force: true });
    expect(write.status).toBe(200);

    const second = await execFileAsync("sh", [script], {
      env: {
        ...process.env,
        NERDGRAM_URL: base,
        NERDGRAM_TOKEN: token.body.token as string,
        NERDGRAM_PATH: "Campus-L3.mmd",
        NERDGRAM_VIEW: "l3",
      },
    });
    expect(second.stdout).toContain("updated\n");
    expect(second.stdout).not.toContain("created\n");

    const again = await request(app)
      .get("/api/v1/diagrams/content")
      .set("Host", `127.0.0.1:${address.port}`)
      .set("Authorization", `Bearer ${token.body.token}`)
      .query({ path: "Campus-L3.mmd" });
    expect(again.status).toBe(200);
    expect(again.body.content).toContain("%% kept by hand");
    expect(again.body.content).toContain("%% nerdgram:generated");
  });
});
