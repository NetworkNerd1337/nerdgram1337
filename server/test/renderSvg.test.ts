import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { main } from "../src/cli.js";
import { svgXmlError } from "../src/edgeLabelPadding.js";
import { closeRenderer, renderDiagram } from "../src/renderDiagram.js";
import { makeTempDataDir } from "./helpers.js";

const multi = "flowchart LR\n  Core[Core] -->|line one<br/>line two<br/>line three| Dist[Dist]\n";
const click = 'flowchart LR\n  Core[Core] -->|Gi0/1| Dist[Dist]\n  click Core "https://example.com"\n';

describe("rendered SVG", () => {
  afterAll(async () => {
    await closeRenderer();
  });

  it("rejects a break that is not closed and a parser-error document", () => {
    expect(svgXmlError(`<svg xmlns="http://www.w3.org/2000/svg"><p>line one<br>line two</p></svg>`)).toMatch(/br/);
    expect(svgXmlError(`<html><body><parsererror>bad</parsererror></body></html>`)).toMatch(/well-formed/);
    expect(svgXmlError(`<svg xmlns="http://www.w3.org/2000/svg"><p>line one<br/>line two</p></svg>`)).toBeNull();
  });

  it("keeps every line of a multi-line edge label and stays well-formed XML", async () => {
    const rendered = await renderDiagram({ source: multi, format: "svg" });
    const svg = rendered.body.toString("utf8");
    expect(svgXmlError(svg)).toBeNull();
    expect(svg).toContain("line one");
    expect(svg).toContain("line two");
    expect(svg).toContain("line three");
    expect(svg).toContain("data-nerdgram-pad");
    expect(svg).toMatch(/<p[^>]*padding:0 6px/);
    expect(svg).not.toMatch(/<span[^>]*edgeLabel[^>]*padding/);
    expect(svg).not.toMatch(/<br(?![^>]*\/>)/i);

    const clicked = await renderDiagram({ source: click, format: "svg" });
    const clickSvg = clicked.body.toString("utf8");
    expect(svgXmlError(clickSvg)).toBeNull();
    expect(clickSvg).toContain("xmlns:xlink");
    expect(clickSvg).toContain("Gi0/1");
    expect(clickSvg).toContain("data-nerdgram-pad");
  });

  it("fails the CLI when the SVG would not parse, and writes a multi-line label that does", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-render-"));
    const source = path.join(dir, "Labels.mmd");
    const output = path.join(dir, "Labels.svg");
    await fs.writeFile(source, multi);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await main(["render", source, "-o", output], {
      stdout: (chunk: string) => stdout.push(chunk),
      stderr: (chunk: string) => stderr.push(chunk),
      env: {},
    });
    expect(code).toBe(0);
    const svg = await fs.readFile(output, "utf8");
    expect(svgXmlError(svg)).toBeNull();
    expect(svg).toContain("line one");
    expect(svg).toContain("line two");
    expect(svg).toContain("line three");

    const temp = await makeTempDataDir();
    try {
      const server = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
      const token = await request(server).post("/api/tokens").set("Host", "127.0.0.1:8787").set("Content-Type", "application/json").send({ name: "render", scope: "read" });
      expect(token.status).toBe(201);
      const api = await request(server)
        .post("/api/v1/render")
        .set("Host", "127.0.0.1:8787")
        .set("Content-Type", "application/json")
        .set("Authorization", `Bearer ${token.body.token}`)
        .send({ source: multi, format: "svg" });
      expect(api.status).toBe(200);
      const body = api.text || api.body?.toString?.() || "";
      const xml = typeof api.body === "string" ? api.body : Buffer.isBuffer(api.body) ? api.body.toString("utf8") : String(body);
      expect(svgXmlError(xml)).toBeNull();
      expect(xml).toContain("line three");
    } finally {
      await temp.cleanup();
    }
  });
});
