import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadExporters } from "../../src/exporters/registry.js";
import { makeTempDataDir } from "../helpers.js";
import { translatorFixture } from "../translatorHarness.js";

const HOST = "127.0.0.1:8787";
const json = { Host: HOST, "Content-Type": "application/json" };

function app() {
  return createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
}

describe("path export reads the sibling network JSON", () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("exports every installed target from the diagram path", async () => {
    const server = app();
    const converted = await request(server)
      .post("/api/convert/netbox")
      .set(json)
      .send(translatorFixture("netbox", "campus.json"));
    expect(converted.status).toBe(200);

    const created = await request(server).post("/api/generate").set(json).send({
      path: "Campus-L3.mmd",
      text: JSON.stringify(converted.body.document),
      format: "network",
      view: "l3",
      storeData: true,
    });
    expect(created.status).toBe(201);

    const available = await request(server).get("/api/export/available").query({ path: "Campus-L3.mmd" }).set("Host", HOST);
    expect(available.status).toBe(200);
    expect(available.body).toEqual({ hasNetwork: true, path: "Campus-L3.network.json" });

    const blocked = await request(server).get("/api/file").query({ path: "Campus-L3.network.json" }).set("Host", HOST);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/\.mmd/);

    const installed = (await loadExporters()).map((item) => item.id);
    expect(installed).toHaveLength(7);
    for (const id of installed) {
      const exported = await request(server).post(`/api/export/${id}`).set(json).send({ path: "Campus-L3.mmd" });
      expect(exported.status, `${id}: ${exported.body.error ?? ""}`).toBe(200);
      expect(exported.body.target).toBe(id);
      const files = exported.body.files as { path: string; content: string }[] | undefined;
      expect(exported.body.text || (files && files.length > 0)).toBeTruthy();
    }
  });
});
