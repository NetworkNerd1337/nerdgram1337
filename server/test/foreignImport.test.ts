import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { DATA_MAX_CHARS } from "../src/diagramData.js";
import { readZip } from "../src/diagramImport/zip.js";
import { REPO_ROOT } from "../src/paths.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function app() {
  return createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
}

function sample(name: string): Buffer {
  return readFileSync(path.join(REPO_ROOT, "docs/samples/imports", name));
}

function postFile(server: ReturnType<typeof app>, name: string, body: Buffer, headers: Record<string, string> = {}) {
  return request(server)
    .post(`/api/import/foreign?name=${encodeURIComponent(name)}`)
    .set({ Host: HOST, "Content-Type": "application/octet-stream", ...headers })
    .send(body);
}

/** A zip from Python's zipfile, including a central directory and EOCD. */
function pythonZip(files: { name: string; data: Buffer | string }[]): Buffer {
  const script = `
import json, sys, zipfile
from pathlib import Path
spec = json.loads(sys.stdin.read())
dest = Path(spec["dest"])
with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for item in spec["files"]:
        zf.writestr(item["name"], item["data"])
`;
  const dest = path.join(os.tmpdir(), `nerdgram-zip-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`);
  execFileSync("python3", ["-c", script], {
    input: JSON.stringify({
      dest,
      files: files.map((file) => ({
        name: file.name,
        data: Buffer.isBuffer(file.data) ? file.data.toString("utf8") : file.data,
      })),
    }),
    encoding: "utf8",
  });
  const bytes = readFileSync(dest);
  return bytes;
}

describe("foreign import over HTTP", () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    cleanup = (await makeTempDataDir()).cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("converts the Lucid and Visio samples through the mutation guard", async () => {
    const server = app();
    const csv = await postFile(server, "lucid-campus.csv", sample("lucid-campus.csv"));
    expect(csv.status).toBe(200);
    expect(csv.body.kind).toBe("lucid");
    expect(csv.body.pages.map((page: { title: string }) => page.title)).toEqual(["Campus", "WAN"]);
    expect(csv.body.pages[0].mermaid).toContain("Core");

    const json = await postFile(server, "lucid-campus.json", sample("lucid-campus.json"));
    expect(json.status).toBe(200);
    expect(json.body.pages[0].mermaid).toContain("Access");

    const vsdx = await postFile(server, "visio-campus.vsdx", sample("visio-campus.vsdx"));
    expect(vsdx.status).toBe(200);
    expect(vsdx.body.kind).toBe("visio");
    expect(vsdx.body.pages.map((page: { title: string }) => page.title)).toEqual(["Campus", "WAN"]);
    expect(vsdx.body.pages[0].mermaid).toContain("Gi0/1");
    expect(vsdx.body.pages[0].warnings.join(" ")).toMatch(/stub/);
    expect(vsdx.body.pages[1].mermaid).toContain("MPLS");
  });

  it("still rejects a foreign origin and a non-file content type", async () => {
    const server = app();
    const blocked = await postFile(server, "lucid-campus.csv", sample("lucid-campus.csv"), {
      Origin: "https://evil.example",
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/origin/i);

    const jsonType = await request(server)
      .post("/api/import/foreign?name=lucid-campus.json")
      .set({ Host: HOST, "Content-Type": "application/json" })
      .send({ text: "nope" });
    expect(jsonType.status).toBe(415);
    expect(jsonType.body.error).toMatch(/octet-stream/);

    const other = await request(server)
      .post("/api/import")
      .set({ Host: HOST, "Content-Type": "application/octet-stream" })
      .send(Buffer.from("hello"));
    expect(other.status).toBe(415);
    expect(other.body.error).toMatch(/application\/json/);
  });

  it("reads a standard-library zip and rejects corrupt, traversal, and oversized archives", async () => {
    const standard = pythonZip([
      {
        name: "[Content_Types].xml",
        data: `<Types><Override ContentType="application/vnd.ms-visio.drawing.main+xml" PartName="/visio/pages/page1.xml"/></Types>`,
      },
      {
        name: "visio/pages/page1.xml",
        data: `<PageContents><Shapes><Shape ID="1" NameU="Rectangle" Type="Shape"><Text>Core</Text></Shape></Shapes></PageContents>`,
      },
    ]);
    expect(standard.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(readZip(standard).map((entry) => entry.name)).toContain("visio/pages/page1.xml");
    const imported = await postFile(app(), "library.vsdx", standard);
    expect(imported.status).toBe(200);
    expect(imported.body.pages[0].mermaid).toContain("Core");

    const corrupt = await postFile(app(), "broken.vsdx", Buffer.from("PK\x03\x04not-a-zip"));
    expect(corrupt.status).toBe(400);
    expect(corrupt.body.error).toMatch(/zip|Visio|not a/i);

    const traversal = pythonZip([{ name: "../secret.xml", data: "<x/>" }]);
    const escaped = await postFile(app(), "escape.vsdx", traversal);
    expect(escaped.status).toBe(400);
    expect(escaped.body.error).toMatch(/unsafe path/);

    const huge = pythonZip([{ name: "visio/pages/page1.xml", data: " ".repeat(DATA_MAX_CHARS + 1) }]);
    const over = await postFile(app(), "huge.vsdx", huge);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/4 MiB/);
  });
});
