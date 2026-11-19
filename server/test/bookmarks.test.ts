import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function makeApp() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

describe("bookmark files", () => {
  let dir = "";
  let cleanup = async () => {};
  const app = makeApp();

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
  });

  afterEach(async () => {
    await cleanup();
  });

  async function writeFavorites(body: unknown) {
    await fs.writeFile(path.join(dir, ".meta", "favorites.json"), `${JSON.stringify(body)}\n`);
  }

  it("loads an older path list and a folder file that has no parent", async () => {
    await writeFavorites(["Welcome.mmd", "Sites/Atlanta.mmd"]);
    const legacy = await request(app).get("/api/bookmarks").set("Host", HOST);
    expect(legacy.status).toBe(200);
    expect(legacy.body.folders).toEqual([]);
    expect(legacy.body.items).toEqual([
      { path: "Welcome.mmd", folderId: null },
      { path: "Sites/Atlanta.mmd", folderId: null },
    ]);

    await writeFavorites({
      version: 1,
      folders: [{ id: "sites", name: "Sites" }],
      items: [{ path: "WAN.mmd", folderId: "sites" }, { path: "Gone.mmd", folderId: "missing" }],
    });
    const current = await request(app).get("/api/bookmarks").set("Host", HOST);
    expect(current.body.folders).toEqual([{ id: "sites", name: "Sites", parentId: null }]);
    expect(current.body.items).toEqual([
      { path: "WAN.mmd", folderId: "sites" },
      { path: "Gone.mmd", folderId: null },
    ]);
  });

  it("keeps a nested parent, and flattens an unknown parent or a cycle", async () => {
    await writeFavorites({
      version: 1,
      folders: [
        { id: "sites", name: "Sites", parentId: null },
        { id: "lab", name: "Lab", parentId: "missing" },
        { id: "rack", name: "Rack", parentId: "lab" },
        { id: "a", name: "A", parentId: "b" },
        { id: "b", name: "B", parentId: "a" },
        { id: "child", name: "Child", parentId: "a" },
      ],
      items: [],
    });
    const loaded = await request(app).get("/api/bookmarks").set("Host", HOST);
    const parent = (id: string) => loaded.body.folders.find((folder: { id: string }) => folder.id === id)?.parentId;
    expect(parent("sites")).toBeNull();
    expect(parent("lab")).toBeNull();
    expect(parent("rack")).toBe("lab");
    expect(parent("a")).toBeNull();
    expect(parent("b")).toBeNull();
    expect(parent("child")).toBe("a");

    const saved = await request(app)
      .put("/api/bookmarks")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({
        folders: [
          { id: "sites", name: "Sites", parentId: null },
          { id: "lab", name: "Lab", parentId: "sites" },
        ],
        items: [{ path: "WAN.mmd", folderId: "lab" }],
      });
    expect(saved.status).toBe(200);
    expect(saved.body.folders).toEqual([
      { id: "sites", name: "Sites", parentId: null },
      { id: "lab", name: "Lab", parentId: "sites" },
    ]);
    expect(saved.body.items).toEqual([{ path: "WAN.mmd", folderId: "lab" }]);
  });
});
