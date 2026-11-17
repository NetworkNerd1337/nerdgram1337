import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { clearWorkspaceTagCache } from "../src/tags.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

function diagram(tags: string[]): string {
  const lines = tags.map((tag) => `    - ${tag}`).join("\n");
  return `---\nnerdgram:\n  tags:\n${lines}\n---\nflowchart LR\n  A[One] --> B[Two]\n`;
}

describe("GET /api/tags", () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    cleanup = (await makeTempDataDir()).cleanup;
    clearWorkspaceTagCache();
  });

  afterEach(async () => {
    clearWorkspaceTagCache();
    await cleanup();
  });

  it("counts stored spellings, skips trash, and does not merge case", async () => {
    const api = app();
    const json = { Host: HOST, "Content-Type": "application/json" };
    await request(api).put("/api/file").set(json).send({ path: "Edge.mmd", content: diagram(["firewall", "edge"]) });
    await request(api).put("/api/file").set(json).send({ path: "Core.mmd", content: diagram(["firewall", "firewall"]) });
    await request(api).put("/api/file").set(json).send({ path: "Other.mmd", content: diagram(["Firewall"]) });
    await request(api).put("/api/file").set(json).send({ path: "Gone.mmd", content: diagram(["retired"]) });

    const trashed = await request(api).delete("/api/item").set(json).send({ path: "Gone.mmd" });
    expect(trashed.status).toBe(204);

    const listed = await request(api).get("/api/tags").set("Host", HOST);
    expect(listed.status).toBe(200);
    const tags = listed.body.tags as { tag: string; count: number }[];
    expect(tags.find((item) => item.tag === "firewall")).toEqual({ tag: "firewall", count: 2 });
    expect(tags.find((item) => item.tag === "Firewall")).toEqual({ tag: "Firewall", count: 1 });
    expect(tags.find((item) => item.tag === "edge")).toEqual({ tag: "edge", count: 1 });
    expect(tags.some((item) => item.tag === "retired")).toBe(false);

    const again = await request(api).get("/api/tags").set("Host", HOST);
    expect(again.body.tags).toEqual(tags);
  });
});
