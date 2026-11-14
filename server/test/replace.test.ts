import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { main } from "../src/cli.js";
import { listRevisions, readRevision } from "../src/history.js";
import { acquireLock } from "../src/locks.js";
import { buildOpenApiSpec } from "../src/openapi.js";
import { REPO_ROOT } from "../src/paths.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = { "Content-Type": "application/json", Host: HOST };

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
  });
}

async function writeDiagram(server: ReturnType<typeof app>, filePath: string, content: string, hash?: string) {
  const res = await request(server)
    .put("/api/file")
    .set(json)
    .send({ path: filePath, content, ...(hash ? { expectedHash: hash } : {}) });
  expect(res.status, res.body?.error ?? filePath).toBe(200);
  return res.body as { path: string; hash: string; mtimeMs: number };
}

async function readDiagram(server: ReturnType<typeof app>, filePath: string) {
  const res = await request(server).get("/api/file").query({ path: filePath }).set("Host", HOST);
  expect(res.status).toBe(200);
  return res.body as { content: string; hash: string };
}

function preview(server: ReturnType<typeof app>, body: Record<string, unknown>) {
  return request(server).post("/api/replace/preview").set(json).send(body);
}

function apply(server: ReturnType<typeof app>, body: Record<string, unknown>) {
  return request(server).post("/api/replace/apply").set(json).send(body);
}

async function templateText(): Promise<Map<string, string>> {
  const dir = path.join(REPO_ROOT, "templates");
  const names = await fs.readdir(dir);
  const files = new Map<string, string>();
  for (const name of names) {
    if (!name.endsWith(".mmd")) continue;
    files.set(name, await fs.readFile(path.join(dir, name), "utf8"));
  }
  return files;
}

describe("workspace replace", () => {
  let dir = "";
  let cleanup = async () => {};
  let server: ReturnType<typeof app>;

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    server = app();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("replaces plain text and keeps a revision of the previous diagram", async () => {
    const original = "flowchart LR\n  A[Core switch] --> B[Edge]\n";
    await writeDiagram(server, "Core.mmd", original);
    const found = await preview(server, { find: "Core switch", replace: "ATL core" });
    expect(found.status).toBe(200);
    expect(found.body.totals).toMatchObject({ replacements: 1, diagrams: 1, shown: 1 });
    expect(found.body.files[0].matches[0]).toMatchObject({
      before: "  A[Core switch] --> B[Edge]",
      after: "  A[ATL core] --> B[Edge]",
      selected: true,
    });
    expect(found.body.files[0].matches[0].contextBefore).toBe("flowchart LR");
    const applied = await apply(server, {
      find: "Core switch",
      replace: "ATL core",
      files: [{ path: "Core.mmd", hash: found.body.files[0].hash }],
    });
    expect(applied.status).toBe(200);
    expect(applied.body.totals).toEqual({ diagrams: 1, replacements: 1 });
    expect(applied.body.operationId).toEqual(expect.any(String));
    expect(applied.body.changed[0].revisionId).toEqual(expect.any(String));
    const disk = await readDiagram(server, "Core.mmd");
    expect(disk.content).toBe("flowchart LR\n  A[ATL core] --> B[Edge]\n");
    const revisions = await listRevisions("Core.mmd");
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.id).toBe(applied.body.changed[0].revisionId);
    const previous = await readRevision("Core.mmd", revisions[0]!.id);
    expect(previous.content).toBe(original);
  });

  it("respects match case, whole word, and regex capture groups", async () => {
    await writeDiagram(server, "Words.mmd", "flowchart LR\n  A[Core] --> B[core]\n  C[CoreSwitch]\n");
    const loose = await preview(server, { find: "Core", replace: "Hub" });
    expect(loose.body.totals.replacements).toBe(3);
    const cased = await preview(server, { find: "Core", replace: "Hub", matchCase: true });
    expect(cased.body.totals.replacements).toBe(2);
    const word = await preview(server, { find: "Core", replace: "Hub", matchCase: true, wholeWord: true });
    expect(word.body.totals.replacements).toBe(1);
    expect(word.body.files[0].matches[0].after).toContain("Hub");
    expect(word.body.files[0].matches[0].before).not.toContain("CoreSwitch");

    await writeDiagram(server, "Regex.mmd", "flowchart LR\n  CORE-SW1[Core]\n");
    const pattern = await preview(server, {
      find: "(\\w+)-SW(\\d+)",
      replace: "$1-EDGE-$2",
      regex: true,
    });
    expect(pattern.status).toBe(200);
    expect(pattern.body.files[0].matches[0].after).toContain("CORE-EDGE-1");
    const applied = await apply(server, {
      find: "(\\w+)-SW(\\d+)",
      replace: "$1-EDGE-$2",
      regex: true,
      files: [{ path: "Regex.mmd", hash: pattern.body.files[0].hash }],
    });
    expect(applied.status).toBe(200);
    const disk = await readDiagram(server, "Regex.mmd");
    expect(disk.content).toContain("CORE-EDGE-1[Core]");
    expect(disk.content).not.toContain("CORE-SW1");
  });

  it("filters by folder, subfolders, and selected paths", async () => {
    const source = "flowchart LR\n  A[WIDGET]\n";
    await writeDiagram(server, "Sites/A.mmd", source);
    await writeDiagram(server, "Sites/East/B.mmd", source);
    await writeDiagram(server, "Other/C.mmd", source);
    const tree = await preview(server, { find: "WIDGET", replace: "UNIT", scope: { folder: "Sites", recursive: true } });
    expect(tree.body.files.map((file: { path: string }) => file.path).sort()).toEqual(["Sites/A.mmd", "Sites/East/B.mmd"]);
    const flat = await preview(server, { find: "WIDGET", replace: "UNIT", scope: { folder: "Sites", recursive: false } });
    expect(flat.body.files.map((file: { path: string }) => file.path)).toEqual(["Sites/A.mmd"]);
    const picked = await preview(server, { find: "WIDGET", replace: "UNIT", scope: { paths: ["Other/C.mmd"] } });
    expect(picked.body.files.map((file: { path: string }) => file.path)).toEqual(["Other/C.mmd"]);
  });

  it("skips front matter unless asked, and warns about generated diagrams, ids, clicks, and paths", async () => {
    await writeDiagram(
      server,
      "Header.mmd",
      "---\ntitle: CORE-SW1\n---\nflowchart LR\n  A[Keep]\n",
    );
    const bodyOnly = await preview(server, { find: "CORE-SW1", replace: "ATL" });
    expect(bodyOnly.body.files).toEqual([]);
    const withHeader = await preview(server, { find: "CORE-SW1", replace: "ATL", includeFrontMatter: true });
    expect(withHeader.body.totals.replacements).toBe(1);
    expect(withHeader.body.files[0].matches[0].before).toBe("title: CORE-SW1");

    const generated = [
      "---",
      "title: Campus",
      "nerdgram:",
      "  source:",
      "    file: Campus.csv",
      "    format: csv",
      "    shape: links",
      "    direction: LR",
      "---",
      "flowchart LR",
      "  CORE-SW1[Core] --> EDGE[Edge]",
      '  click CORE-SW1 "Sites/ATL/Core.mmd"',
      "",
    ].join("\n");
    await writeDiagram(server, "Campus.mmd", generated);
    const found = await preview(server, { find: "CORE-SW1", replace: "ATL-CORE-01" });
    expect(found.body.files[0].generated).toBe(true);
    expect(found.body.files[0].generatedWarning).toMatch(/Refresh from data/);
    expect(found.body.files[0].generatedWarning).toMatch(/Campus\.csv/);
    const warnings = found.body.files[0].matches.flatMap((match: { warnings: string[] }) => match.warnings);
    expect(warnings).toContain("node-id");
    const pathHit = await preview(server, { find: "Sites/ATL/Core.mmd", replace: "Sites/HQ/Core.mmd" });
    expect(pathHit.body.files[0].matches[0].warnings).toEqual(expect.arrayContaining(["click-target", "path"]));
  });

  it("unchecks a diagram that would not parse, and still applies every match when the preview is truncated", async () => {
    await writeDiagram(server, "Broken.mmd", "flowchart LR\n  A --> B\n");
    const bad = await preview(server, { find: " B", replace: "" });
    expect(bad.body.files[0].selected).toBe(false);
    expect(bad.body.files[0].lint.invalid).toBe(true);
    expect(bad.body.files[0].lint.newlyInvalid).toBe(true);
    const left = await apply(server, { find: " B", replace: "", files: [] });
    expect(left.body.totals.diagrams).toBe(0);
    expect((await readDiagram(server, "Broken.mmd")).content).toContain("A --> B");

    const label = Array.from({ length: 45 }, () => "CORE").join(" ");
    await writeDiagram(server, "Many.mmd", `flowchart LR\n  A["${label}"]\n`);
    const many = await preview(server, { find: "CORE", replace: "EDGE" });
    expect(many.body.truncated).toBe(true);
    expect(many.body.message).toMatch(/Showing/);
    expect(many.body.files[0].matchCount).toBe(45);
    expect(many.body.files[0].shownCount).toBeLessThan(45);
    const applied = await apply(server, {
      find: "CORE",
      replace: "EDGE",
      files: [{ path: "Many.mmd", hash: many.body.files[0].hash, skipMatchIds: [many.body.files[0].matches[0].id] }],
    });
    expect(applied.body.totals.replacements).toBe(44);
    const disk = await readDiagram(server, "Many.mmd");
    expect(disk.content.match(/CORE/g)).toHaveLength(1);
    expect(disk.content.match(/EDGE/g)).toHaveLength(44);
  });

  it("skips a locked file and a file whose hash changed, then undoes the batch except a later edit", async () => {
    await writeDiagram(server, "Open.mmd", "flowchart LR\n  A[CORE]\n");
    await writeDiagram(server, "Kept.mmd", "flowchart LR\n  A[CORE]\n");
    await writeDiagram(server, "Edited.mmd", "flowchart LR\n  A[CORE]\n");
    await acquireLock("Open.mmd", "replace-session");
    const found = await preview(server, { find: "CORE", replace: "EDGE" });
    const byPath = new Map(found.body.files.map((file: { path: string; hash: string }) => [file.path, file.hash]));
    const changed = await writeDiagram(server, "Kept.mmd", "flowchart LR\n  A[CORE changed]\n", byPath.get("Kept.mmd"));
    const applied = await apply(server, {
      find: "CORE",
      replace: "EDGE",
      files: ["Open.mmd", "Kept.mmd", "Edited.mmd"].map((filePath) => ({ path: filePath, hash: byPath.get(filePath) })),
    });
    expect(applied.status).toBe(200);
    const reasons = new Map(applied.body.skipped.map((item: { path: string; reason: string }) => [item.path, item.reason]));
    expect(reasons.get("Open.mmd")).toBe("locked");
    expect(reasons.get("Kept.mmd")).toBe("changed");
    expect(applied.body.changed.map((file: { path: string }) => file.path)).toEqual(["Edited.mmd"]);
    expect((await readDiagram(server, "Open.mmd")).content).toContain("A[CORE]");
    expect((await readDiagram(server, "Kept.mmd")).content).toBe("flowchart LR\n  A[CORE changed]\n");
    expect((await readDiagram(server, "Edited.mmd")).content).toContain("A[EDGE]");

    const editedHash = (await readDiagram(server, "Edited.mmd")).hash;
    await writeDiagram(server, "Edited.mmd", "flowchart LR\n  A[EDGE later]\n", editedHash);
    await writeDiagram(server, "Kept.mmd", "flowchart LR\n  A[CORE]\n", changed.hash);
    const second = await preview(server, { find: "CORE", replace: "EDGE", scope: { paths: ["Kept.mmd"] } });
    const both = await apply(server, {
      find: "CORE",
      replace: "EDGE",
      files: [{ path: "Kept.mmd", hash: second.body.files[0].hash }],
    });
    expect(both.body.changed).toHaveLength(1);
    const operationId = applied.body.operationId as string;
    const undone = await request(server).post("/api/replace/undo").set(json).send({ id: operationId });
    expect(undone.status).toBe(200);
    expect(undone.body.skipped.map((item: { path: string }) => item.path)).toContain("Edited.mmd");
    expect(undone.body.skipped.find((item: { path: string }) => item.path === "Edited.mmd").reason).toBe("edited");
    expect((await readDiagram(server, "Edited.mmd")).content).toContain("EDGE later");

    const keptUndo = await request(server).post("/api/replace/undo").set(json).send({ id: both.body.operationId });
    expect(keptUndo.status).toBe(200);
    expect(keptUndo.body.restored.map((item: { path: string }) => item.path)).toEqual(["Kept.mmd"]);
    expect((await readDiagram(server, "Kept.mmd")).content).toContain("A[CORE]");
  });

  it("does not touch templates, trash, hidden files, or .meta", async () => {
    const templates = await templateText();
    expect(templates.size).toBeGreaterThan(0);
    await writeDiagram(server, "Live.mmd", "flowchart LR\n  A[CORE-SW1]\n");
    await writeDiagram(server, "Gone.mmd", "flowchart LR\n  A[CORE-SW1]\n");
    const removed = await request(server).delete("/api/item").set(json).send({ path: "Gone.mmd" });
    expect(removed.status).toBe(204);
    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
    const secret = "flowchart LR\n  A[CORE-SW1]\n";
    await fs.writeFile(path.join(dir, ".meta", "secret.mmd"), secret);
    await fs.writeFile(path.join(dir, ".hidden.mmd"), secret);

    const found = await preview(server, {
      find: "CORE-SW1",
      replace: "ATL",
      scope: { paths: ["Live.mmd", ".meta/secret.mmd", ".hidden.mmd", "Gone.mmd"] },
    });
    expect(found.body.files.map((file: { path: string }) => file.path)).toEqual(["Live.mmd"]);
    const reasons = new Map(found.body.excluded.map((item: { path: string; reason: string }) => [item.path, item.reason]));
    expect(reasons.get(".meta/secret.mmd")).toBe("meta");
    expect(reasons.get(".hidden.mmd")).toBe("hidden");
    expect(reasons.get("Gone.mmd")).toBe("not-found");

    const applied = await apply(server, {
      find: "CORE-SW1",
      replace: "ATL",
      files: [
        { path: "Live.mmd", hash: found.body.files[0].hash },
        { path: ".meta/secret.mmd", hash: "unused" },
        { path: ".hidden.mmd", hash: "unused" },
      ],
    });
    expect(applied.body.changed.map((file: { path: string }) => file.path)).toEqual(["Live.mmd"]);
    expect(await fs.readFile(path.join(dir, ".meta", "secret.mmd"), "utf8")).toBe(secret);
    expect(await fs.readFile(path.join(dir, ".hidden.mmd"), "utf8")).toBe(secret);
    const trashRoot = path.join(dir, ".meta", "trash", "items");
    const trashIds = await fs.readdir(trashRoot);
    const payloads = await Promise.all(trashIds.map((id) => fs.readFile(path.join(trashRoot, id, "payload.mmd"), "utf8")));
    expect(payloads.join("\n")).toContain("CORE-SW1");
    expect(payloads.join("\n")).not.toContain("ATL");
    expect(await templateText()).toEqual(templates);
  });

  it("serves preview, apply, and undo on /api and /api/v1, and requires JSON", async () => {
    const spec = buildOpenApiSpec() as { paths: Record<string, unknown> };
    expect(spec.paths["/api/v1/replace/preview"]).toBeTruthy();
    expect(spec.paths["/api/v1/replace/apply"]).toBeTruthy();
    expect(spec.paths["/api/v1/replace/undo"]).toBeTruthy();

    await writeDiagram(server, "Api.mmd", "flowchart LR\n  A[CORE]\n");
    const plain = await request(server)
      .post("/api/replace/apply")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("nope");
    expect(plain.status).toBe(415);

    const created = await request(server).post("/api/tokens").set(json).send({ name: "replace", scope: "read-write" });
    const token = created.body.token as string;
    const read = await request(server).post("/api/tokens").set(json).send({ name: "read", scope: "read" });
    const denied = await request(server)
      .post("/api/v1/replace/apply")
      .set(json)
      .set("Authorization", `Bearer ${read.body.token}`)
      .send({ find: "CORE", replace: "EDGE", files: [] });
    expect(denied.status).toBe(403);

    const auth = { Authorization: `Bearer ${token}` };
    const found = await request(server)
      .post("/api/v1/replace/preview")
      .set(json)
      .set(auth)
      .send({ find: "CORE", replace: "EDGE" });
    expect(found.status).toBe(200);
    expect(found.body.totals.replacements).toBe(1);
    const applied = await request(server)
      .post("/api/v1/replace/apply")
      .set(json)
      .set(auth)
      .send({ find: "CORE", replace: "EDGE", files: [{ path: "Api.mmd", hash: found.body.files[0].hash }] });
    expect(applied.status).toBe(200);
    const undone = await request(server)
      .post("/api/v1/replace/undo")
      .set(json)
      .set(auth)
      .send({ id: applied.body.operationId });
    expect(undone.status).toBe(200);
    expect((await readDiagram(server, "Api.mmd")).content).toContain("A[CORE]");

    const missing = await request(server)
      .post("/api/v1/replace/undo")
      .set("Host", HOST)
      .set(auth)
      .set("Content-Type", "text/plain")
      .send("id=nope");
    expect(missing.status).toBe(415);
  });
});

describe("nerdgram replace", () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("prints a dry run and applies with --yes", async () => {
    const server = app();
    const created = await request(server).post("/api/tokens").set(json).send({ name: "cli", scope: "read-write" });
    const token = created.body.token as string;
    await writeDiagram(server, "Cli.mmd", "flowchart LR\n  CORE-SW1[Core]\n");
    const running = await listen(server);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: (chunk: string) => stdout.push(chunk),
      stderr: (chunk: string) => stderr.push(chunk),
      env: {} as NodeJS.ProcessEnv,
    };
    const flags = ["--url", `http://127.0.0.1:${running.port}`, "--token", token];
    try {
      stdout.length = 0;
      expect(await main(["replace", "CORE-SW1", "ATL-CORE-01", ...flags], io)).toBe(0);
      expect(stdout.join("")).toMatch(/1 replacement in 1 diagram/);
      expect(stdout.join("")).toMatch(/Nothing was written/);
      const disk = await readDiagram(server, "Cli.mmd");
      expect(disk.content).toContain("CORE-SW1");

      stdout.length = 0;
      expect(await main(["replace", "CORE-SW1", "ATL-CORE-01", "--yes", "--json", ...flags], io)).toBe(0);
      const applied = JSON.parse(stdout.join("")) as { ok: boolean; operationId: string; totals: { diagrams: number } };
      expect(applied.ok).toBe(true);
      expect(applied.totals.diagrams).toBe(1);
      expect((await readDiagram(server, "Cli.mmd")).content).toContain("ATL-CORE-01");

      stdout.length = 0;
      expect(await main(["replace", "--undo", applied.operationId, "--json", ...flags], io)).toBe(0);
      expect((await readDiagram(server, "Cli.mmd")).content).toContain("CORE-SW1");
      expect(stderr.join("")).toBe("");
    } finally {
      await running.close();
    }
  });
});

function listen(server: ReturnType<typeof app>): Promise<{ port: number; close: () => Promise<void> }> {
  const running = http.createServer(server);
  return new Promise((resolve) => {
    running.listen(0, "127.0.0.1", () => {
      const address = running.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        close: () =>
          new Promise((done, reject) => {
            running.close((err) => (err ? reject(err) : done()));
          }),
      });
    });
  });
}
