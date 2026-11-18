import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { buildOpenApiSpec } from "../../src/openapi.js";
import { REPO_ROOT } from "../../src/paths.js";
import { loadTranslators } from "../../src/translators/registry.js";
import { makeTempDataDir } from "../helpers.js";
import { assertCanonical, translatorFixture } from "../translatorHarness.js";

const HOST = "127.0.0.1:8787";
const json = { Host: HOST, "Content-Type": "application/json" };

function app() {
  return createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
}

describe("convert API", () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  async function token(server: ReturnType<typeof app>, scope: "read" | "read-write") {
    const created = await request(server).post("/api/tokens").set(json).send({ name: scope, scope });
    expect(created.status).toBe(201);
    return created.body.token as string;
  }

  it("lists translators and converts with a read token", async () => {
    const server = app();
    const read = await token(server, "read");
    const listed = await request(server).get("/api/v1/translators").set(json).set("Authorization", `Bearer ${read}`);
    expect(listed.status).toBe(200);
    const ids = (listed.body.translators as { id: string; name: string; formatHint: string; placeholder: string }[]).map((item) => item.id);
    const installed = (await loadTranslators()).map((item) => item.id);
    expect(ids).toEqual(installed);
    expect(ids).toContain("netbox");
    expect(ids).toContain("librenms");
    for (const item of listed.body.translators as { formatHint: string; placeholder: string; name: string }[]) {
      expect(item.name).toBeTruthy();
      expect(item.formatHint).toBeTruthy();
      expect(item.placeholder).toContain("{");
    }

    const browserConvert = await request(server)
      .post("/api/convert/netbox")
      .set(json)
      .send(translatorFixture("netbox", "devices-only.json"));
    expect(browserConvert.status).toBe(200);
    expect(browserConvert.body.source).toBe("netbox");
    expect(browserConvert.body.document.links).toEqual([]);

    const browser = await request(server).get("/api/translators").set("Host", HOST);
    expect(browser.status).toBe(200);
    expect(browser.body.translators).toEqual(listed.body.translators);
    const foreign = await request(server).get("/api/translators").set("Host", "evil.example");
    expect(foreign.status).toBe(403);

    const campus = translatorFixture("netbox", "campus.json");
    const converted = await request(server)
      .post("/api/v1/convert/netbox")
      .set(json)
      .set("Authorization", `Bearer ${read}`)
      .send(campus);
    expect(converted.status).toBe(200);
    assertCanonical(converted.body.document);
    expect(converted.body.source).toBe("netbox");
    expect(converted.body.warnings.some((warning: { message: string }) => warning.message.includes('"serial"'))).toBe(true);
    expect(converted.body.upsert).toBeUndefined();

    const denied = await request(server)
      .post("/api/v1/convert/netbox")
      .set(json)
      .set("Authorization", `Bearer ${read}`)
      .send({ input: campus, path: "Campus-L3.mmd", view: "l3" });
    expect(denied.status).toBe(403);

    const missing = await request(server).get("/api/v1/translators").set(json);
    expect(missing.status).toBe(401);
    const unknown = await request(server)
      .post("/api/v1/convert/missing")
      .set(json)
      .set("Authorization", `Bearer ${read}`)
      .send({ devices: [] });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("not_found");
  });

  it("upserts both views from the converted document", async () => {
    const server = app();
    const write = await token(server, "read-write");
    const libre = translatorFixture("librenms", "campus.json");
    const converted = await request(server)
      .post("/api/v1/convert/librenms?path=Campus-L3.mmd&view=l3")
      .set(json)
      .set("Authorization", `Bearer ${write}`)
      .send(libre);
    expect(converted.status).toBe(201);
    expect(converted.body.upsert.path).toBe("Campus-L3.mmd");
    expect(converted.body.upsert.created).toBe(true);
    expect(converted.body.upsert.mermaid).toContain("core-rtr");
    const onDisk = await fs.readFile(path.join(process.env.NERDGRAM_DATA_DIR ?? "", "Campus-L3.mmd"), "utf8");
    expect(onDisk).toContain("core-rtr");

    const text = JSON.stringify(converted.body.document);
    for (const view of ["l3", "l2"] as const) {
      const saved = await request(server)
        .post("/api/v1/generate/upsert")
        .set(json)
        .set("Authorization", `Bearer ${write}`)
        .send({ path: `FromConvert-${view}.mmd`, format: "network", view, text });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      expect(saved.body.mermaid).toContain("dist-sw");
    }

    await loadTranslators();
    const spec = buildOpenApiSpec() as {
      paths: Record<string, { post?: { parameters?: { name: string; schema?: { enum?: string[] } }[] } }>;
    };
    const parameter = spec.paths["/api/v1/convert/{source}"]?.post?.parameters?.find((item) => item.name === "source");
    expect(parameter?.schema?.enum).toEqual((await loadTranslators()).map((item) => item.id));
  });
});
