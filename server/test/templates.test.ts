import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MERMAID_THEMES, parseDiagram } from "../src/frontMatter.js";
import { getDataRoot } from "../src/paths.js";
import { lintDiagram } from "../src/diagramLint.js";
import { resolveUnder } from "../src/storage.js";
import { getTemplatesRoot, listTemplates, readTemplate } from "../src/templates.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

const SHIPPED = [
  { id: "network-topology", title: "Network topology", category: "Network", diagramType: "Flowchart", theme: "forest" },
  { id: "home-lab", title: "Home lab", category: "Network", diagramType: "Flowchart", theme: "neo" },
  { id: "firewall-policy", title: "Firewall rule policy", category: "Security", diagramType: "Flowchart", theme: "neutral" },
  { id: "rack-elevation", title: "Rack elevation", category: "Data Center", diagramType: "Block", theme: "redux" },
  { id: "flowchart-starter", title: "Flowchart starter", category: "Software", diagramType: "Flowchart", theme: "dark" },
  { id: "sequence-starter", title: "Sequence starter", category: "Software", diagramType: "Sequence", theme: "default" },
] as const;

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

function isDocumentationAddress(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  const c = parts[2] ?? -1;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

describe("bundled templates", () => {
  it("keeps templates outside the data directory", () => {
    const templatesRoot = getTemplatesRoot();
    expect(path.basename(templatesRoot)).toBe("templates");
    const dataRoot = getDataRoot();
    const relative = path.relative(dataRoot, templatesRoot);
    expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(true);
  });

  it("lists the six starters in order with front matter, and rejects traversal", async () => {
    const api = app();
    const listed = await request(api).get("/api/templates").set("Host", HOST);
    expect(listed.status).toBe(200);
    const templates = listed.body.templates as {
      id: string;
      title: string;
      description: string;
      tags: string[];
      category: string;
      theme: string;
      diagramType: string;
      cacheKey: string;
      malformed: boolean;
      source: string;
    }[];
    expect(templates.length).toBeGreaterThanOrEqual(SHIPPED.length);
    expect(templates.every((item) => item.origin === "builtin")).toBe(true);
    const categories = templates.map((item) => item.category);
    const order = ["Network", "Software", "Internet & Cloud", "Security", "OT & Industrial", "Data Center", "Operations & Planning"];
    const ranks = categories.map((name) => order.indexOf(name));
    expect(ranks.every((rank) => rank >= 0)).toBe(true);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);

    for (const expected of SHIPPED) {
      const item = templates.find((entry) => entry.id === expected.id);
      expect(item?.title).toBe(expected.title);
      expect(item?.category).toBe(expected.category);
      expect(item?.diagramType).toBe(expected.diagramType);
      expect(item?.theme).toBe(expected.theme);
      expect(MERMAID_THEMES).toContain(item?.theme);
      expect(item?.description.length).toBeGreaterThan(10);
      expect(item?.tags.length).toBeGreaterThan(0);
      expect(item?.malformed).toBe(false);
      expect(item?.cacheKey).toMatch(/^[0-9a-f]+:\d+$/);
      const parsed = parseDiagram(item?.source ?? "");
      expect(parsed.malformed).toBe(false);
      expect(parsed.title).toBe(expected.title);
      expect(parsed.category).toBe(expected.category);
      expect(parsed.theme).toBe(expected.theme);
      expect(item?.source.startsWith("---\n")).toBe(true);

      const addresses = item?.source.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
      for (const address of addresses) {
        expect(isDocumentationAddress(address), `${expected.id} ${address}`).toBe(true);
      }
      expect(item?.source).not.toMatch(/\.(com|net|org|io)\b/i);

      const detail = await request(api).get(`/api/templates/${expected.id}`).set("Host", HOST);
      expect(detail.status).toBe(200);
      expect(detail.body.source).toBe(item?.source);
      expect(detail.body.id).toBe(expected.id);
    }

    for (const id of ["../package", "..", ".hidden", "network-topology.mmd", "a/b", "%2e%2e"]) {
      const blocked = await request(api).get(`/api/templates/${encodeURIComponent(id)}`).set("Host", HOST);
      expect(blocked.status).toBeGreaterThanOrEqual(400);
      expect(blocked.status).toBeLessThan(500);
      expect(blocked.body.source).toBeUndefined();
    }
    const missing = await request(api).get("/api/templates/not-a-template").set("Host", HOST);
    expect(missing.status).toBe(404);
  });
});

describe("template directory rules", () => {
  it("ignores hidden names, spaces, and symlinks that leave the directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-templates-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-outside-"));
    try {
      const extra = `---
title: Extra sample
nerdgram:
  description: A dropped-in template
  category: Extra
  tags:
    - extra
---
flowchart TD
  A-->B
`;
      await fs.writeFile(path.join(root, "extra-sample.mmd"), extra, "utf8");
      await fs.writeFile(path.join(root, "Bad Name.mmd"), "flowchart TD\n  A-->B\n", "utf8");
      await fs.writeFile(path.join(root, ".hidden.mmd"), "flowchart TD\n  A-->B\n", "utf8");
      await fs.mkdir(path.join(root, "nested"));
      await fs.writeFile(path.join(root, "nested", "inside.mmd"), "flowchart TD\n  A-->B\n", "utf8");
      await fs.writeFile(path.join(outside, "secret.mmd"), "flowchart TD\n  secret-sentinel\n", "utf8");
      await fs.symlink(path.join(outside, "secret.mmd"), path.join(root, "secret.mmd"));

      const listed = await listTemplates(root);
      expect(listed.map((item) => item.id)).toEqual(["extra-sample"]);
      expect(listed[0]?.title).toBe("Extra sample");
      expect(listed[0]?.category).toBe("Extra");
      expect(listed[0]?.source.includes("secret-sentinel")).toBe(false);

      await expect(readTemplate("secret", root)).rejects.toMatchObject({ status: 400, code: "invalid" });
      await expect(readTemplate("../secret", root)).rejects.toMatchObject({ status: 400 });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("create a diagram from a template", () => {
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

  async function useTemplate(id: string, body: { name?: string; folder?: string } = {}) {
    return request(app())
      .post(`/api/templates/${id}/use`)
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send(body);
  }

  it("copies each starter into the data dir without changing the bundled file", async () => {
    const originals = new Map<string, string>();
    for (const item of SHIPPED) {
      originals.set(
        item.id,
        await fs.readFile(path.join(getTemplatesRoot(), `${item.id}.mmd`), "utf8"),
      );
    }

    for (const item of SHIPPED) {
      const created = await useTemplate(item.id, { name: item.title, folder: "" });
      expect(created.status).toBe(201);
      expect(created.body.templateId).toBe(item.id);
      expect(created.body.path).toBe(`${item.title}.mmd`);
      const written = await fs.readFile(path.join(dir, created.body.path), "utf8");
      expect(written).toBe(originals.get(item.id));
      const parsed = parseDiagram(written);
      expect(parsed.title).toBe(item.title);
      expect(parsed.malformed).toBe(false);
    }

    for (const [id, source] of originals) {
      const again = await fs.readFile(path.join(getTemplatesRoot(), `${id}.mmd`), "utf8");
      expect(again).toBe(source);
    }

    const found = await request(app())
      .get("/api/search")
      .query({ q: "campus access path" })
      .set("Host", HOST);
    expect(found.status).toBe(200);
    expect(found.body.hits.some((hit: { path: string }) => hit.path === "Network topology.mmd")).toBe(
      true,
    );
  });

  it("suffixes a taken name and does not overwrite", async () => {
    const sentinel = "flowchart TD\n  Keep[sentinel]\n";
    await fs.writeFile(path.join(dir, "Network topology.mmd"), sentinel, "utf8");
    await fs.writeFile(path.join(dir, "Network topology 2.mmd"), sentinel, "utf8");

    const created = await useTemplate("network-topology", { name: "Network topology" });
    expect(created.status).toBe(201);
    expect(created.body.path).toBe("Network topology 3.mmd");
    expect(await fs.readFile(path.join(dir, "Network topology.mmd"), "utf8")).toBe(sentinel);
    expect(await fs.readFile(path.join(dir, "Network topology 2.mmd"), "utf8")).toBe(sentinel);
    const copy = await fs.readFile(path.join(dir, "Network topology 3.mmd"), "utf8");
    expect(copy).not.toBe(sentinel);
    expect(copy).toContain("title: Network topology");

    const again = await useTemplate("network-topology", { name: "Network topology.mmd" });
    expect(again.status).toBe(201);
    expect(again.body.path).toBe("Network topology 4.mmd");
  });

  it("writes into an existing folder, including one with a space", async () => {
    await fs.mkdir(path.join(dir, "Server Room"));
    const created = await useTemplate("home-lab", { name: "Lab map", folder: "Server Room" });
    expect(created.status).toBe(201);
    expect(created.body.path).toBe("Server Room/Lab map.mmd");
    const written = await fs.readFile(path.join(dir, "Server Room", "Lab map.mmd"), "utf8");
    expect(written).toContain("flowchart TB");
    expect(written).toContain("title: Home lab");
  });

  it("refuses a missing folder, a file used as a folder, dot paths, and path traversal", async () => {
    await fs.writeFile(path.join(dir, "NotAFolder.mmd"), "flowchart TD\n  A-->B\n", "utf8");
    const cases: { name?: string; folder?: string }[] = [
      { name: "Ok", folder: "Missing" },
      { name: "Ok", folder: "NotAFolder.mmd" },
      { name: "Ok", folder: ".meta" },
      { name: "Ok", folder: "notes/.hidden" },
      { name: "Ok", folder: "../outside" },
      { name: ".secret", folder: "" },
      { name: "../Welcome.mmd", folder: "" },
      { name: "nested/name", folder: "" },
    ];
    for (const body of cases) {
      const refused = await useTemplate("flowchart-starter", body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(refused.body.code).toBe("invalid");
    }
    const names = await fs.readdir(dir);
    expect(names).toEqual(["NotAFolder.mmd"]);
    const sentinel = await fs.readFile(path.join(dir, "NotAFolder.mmd"), "utf8");
    expect(sentinel).toBe("flowchart TD\n  A-->B\n");
  });

  it("rejects a non-JSON body and a cross-origin create", async () => {
    const api = app();
    const text = await request(api)
      .post("/api/templates/flowchart-starter/use")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("name=Stolen");
    expect(text.status).toBe(415);

    const cross = await request(api)
      .post("/api/templates/flowchart-starter/use")
      .set("Host", HOST)
      .set("Origin", "https://evil.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Content-Type", "application/json")
      .send({ name: "Stolen", folder: "" });
    expect(cross.status).toBe(403);

    const escaped = await request(api)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "../templates/flowchart-starter.mmd", content: "flowchart TD\n  Hacked\n" });
    expect(escaped.status).toBe(400);
    const bundled = await fs.readFile(path.join(getTemplatesRoot(), "flowchart-starter.mmd"), "utf8");
    expect(bundled).toContain("title: Flowchart starter");
    expect(bundled).not.toContain("Hacked");
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("rejects a name or folder that is not a string", async () => {
    const api = app();
    const badName = await request(api)
      .post("/api/templates/flowchart-starter/use")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ name: 12, folder: "" });
    expect(badName.status).toBe(400);
    const badFolder = await request(api)
      .post("/api/templates/flowchart-starter/use")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ name: "Ok", folder: 4 });
    expect(badFolder.status).toBe(400);
  });
});

describe("user templates", () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    cleanup = (await makeTempDataDir()).cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  const source = `---
title: Site sketch
nerdgram:
  description: A sketch
  tags:
    - lab
  category: Network
---
flowchart LR
  A[One] --> B[Two]
`;

  it("creates, updates, renames, and deletes only user templates", async () => {
    const api = app();
    const created = await request(api)
      .post("/api/templates")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ content: source, name: "Site sketch" });
    expect(created.status).toBe(201);
    expect(created.body.origin).toBe("user");
    expect(created.body.category).toBe("User created");
    expect(created.body.source).toContain("category: User created");
    expect(created.body.source).toContain("A[One] --> B[Two]");

    const clash = await request(api)
      .post("/api/templates")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ content: source, name: "Site sketch" });
    expect(clash.status).toBe(409);

    const replaced = await request(api)
      .post("/api/templates")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ content: source, name: "Site sketch", replace: true });
    expect(replaced.status).toBe(201);

    const saved = await request(api)
      .put(`/api/templates/${created.body.id}`)
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ content: source.replace("Two", "Three"), category: "Security" });
    expect(saved.status).toBe(200);
    expect(saved.body.category).toBe("User created");
    expect(saved.body.source).toContain("Three");

    const renamed = await request(api)
      .post(`/api/templates/${created.body.id}/rename`)
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ name: "Site plan" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe("Site plan");
    expect(renamed.body.origin).toBe("user");

    const listed = await request(api).get("/api/templates").set("Host", HOST);
    expect(listed.body.templates.some((item: { id: string; origin: string }) => item.id === renamed.body.id && item.origin === "user")).toBe(true);

    const builtin = await request(api)
      .put("/api/templates/network-topology")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ content: source });
    expect(builtin.status).toBe(403);
    const builtinDelete = await request(api)
      .delete("/api/templates/firewall-policy")
      .set("Host", HOST)
      .set("Content-Type", "application/json");
    expect(builtinDelete.status).toBe(403);
    const builtinRename = await request(api)
      .post("/api/templates/home-lab/rename")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ name: "Nope" });
    expect(builtinRename.status).toBe(403);

    const removed = await request(api)
      .delete(`/api/templates/${renamed.body.id}`)
      .set("Host", HOST)
      .set("Content-Type", "application/json");
    expect(removed.status).toBe(204);
    const gone = await request(api).get(`/api/templates/${renamed.body.id}`).set("Host", HOST);
    expect(gone.status).toBe(404);
  });

  it("turns a dashed name into the same id as before", async () => {
    const api = app();
    const created = await request(api)
      .post("/api/templates")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ content: source, name: "--Lab--" });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe("lab");
  });

  it("rejects template ids that would leave .templates", async () => {
    const api = app();
    const dataRoot = getDataRoot();
    const outside = path.dirname(dataRoot);
    const ids = ["../evil", "a/../../b", "..", "a\\b", "%2e%2e", "x\u0000"];
    for (const id of ids) {
      const created = await request(api)
        .post("/api/templates")
        .set("Host", HOST)
        .set("Content-Type", "application/json")
        .send({ content: source, id, name: "Nope" });
      expect(created.status, `create ${JSON.stringify(id)}`).toBe(400);

      const encoded = encodeURIComponent(id);
      const saved = await request(api)
        .put(`/api/templates/${encoded}`)
        .set("Host", HOST)
        .set("Content-Type", "application/json")
        .send({ content: source });
      expect(saved.status, `save ${JSON.stringify(id)}`).toBe(400);

      const renamed = await request(api)
        .post(`/api/templates/${encoded}/rename`)
        .set("Host", HOST)
        .set("Content-Type", "application/json")
        .send({ id, name: "Nope" });
      expect(renamed.status, `rename ${JSON.stringify(id)}`).toBe(400);

      const removed = await request(api)
        .delete(`/api/templates/${encoded}`)
        .set("Host", HOST)
        .set("Content-Type", "application/json")
        .send({});
      expect(removed.status, `delete ${JSON.stringify(id)}`).toBe(400);
    }

    const walked: string[] = [];
    const walk = async (current: string) => {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else walked.push(path.relative(dataRoot, full));
      }
    };
    await walk(dataRoot);
    expect(walked.every((rel) => rel.startsWith(`.templates${path.sep}`) || rel.startsWith(".templates/"))).toBe(true);
    await expect(fs.stat(path.join(outside, "evil.mmd"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(outside, "b.mmd"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps every shipped template free of diagram-check warnings", async () => {
    const listed = await listTemplates();
    expect(listed.length).toBeGreaterThan(6);
    for (const template of listed) {
      const hits = lintDiagram(template.source);
      expect(hits, template.id).toEqual([]);
    }
  });
});

describe("resolveUnder", () => {
  const root = path.join(os.tmpdir(), "nerdgram-resolve-under");

  it("accepts one file name and rejects a name that leaves the directory", () => {
    expect(resolveUnder(root, "lab.mmd")).toBe(path.resolve(root, "lab.mmd"));
    for (const name of ["..", "nested/name.mmd", "/etc/passwd"]) {
      expect(() => resolveUnder(root, name), name).toThrowError(expect.objectContaining({ status: 400, code: "invalid" }));
    }
  });
});
