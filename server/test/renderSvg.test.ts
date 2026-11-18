import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import puppeteer, { Page } from "puppeteer";
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

    const broken = `<svg xmlns="http://www.w3.org/2000/svg"><p>line one<br>line two</p></svg>`;
    const restore = stubRendererSvg(broken);
    try {
      const badOut = path.join(dir, "Broken.svg");
      stdout.length = 0;
      stderr.length = 0;
      const failed = await main(["render", source, "-o", badOut], {
        stdout: (chunk: string) => stdout.push(chunk),
        stderr: (chunk: string) => stderr.push(chunk),
        env: {},
      });
      expect(failed).not.toBe(0);
      expect(stderr.join("")).toMatch(/well-formed|br/i);
      expect(stdout.join("")).toBe("");
      await expect(fs.stat(badOut)).rejects.toThrow();

      stdout.length = 0;
      stderr.length = 0;
      const jsonFailed = await main(["render", source, "-o", badOut, "--json"], {
        stdout: (chunk: string) => stdout.push(chunk),
        stderr: (chunk: string) => stderr.push(chunk),
        env: {},
      });
      expect(jsonFailed).toBe(1);
      expect(stderr.join("")).toBe("");
      const body = JSON.parse(stdout.join("")) as { ok: boolean; error: string; status: number | string };
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/well-formed|br/i);
      expect(body.status).toBe(500);
      expect(body.status).not.toBeNull();

      const tempFail = await makeTempDataDir();
      try {
        const server = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
        const token = await request(server).post("/api/tokens").set("Host", "127.0.0.1:8787").set("Content-Type", "application/json").send({ name: "render-fail", scope: "read" });
        expect(token.status).toBe(201);
        const apiFail = await request(server)
          .post("/api/v1/render")
          .set("Host", "127.0.0.1:8787")
          .set("Content-Type", "application/json")
          .set("Authorization", `Bearer ${token.body.token}`)
          .send({ source: multi, format: "svg" });
        expect(apiFail.status).toBe(500);
        expect(String(apiFail.body?.error ?? "")).toMatch(/well-formed|br/i);
      } finally {
        await tempFail.cleanup();
      }
    } finally {
      restore();
    }
  });

  it("reports a non-null status for a render usage error", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await main(["render", "Local.mmd", "--json"], {
      stdout: (chunk: string) => stdout.push(chunk),
      stderr: (chunk: string) => stderr.push(chunk),
      env: {},
    });
    expect(code).toBe(1);
    const body = JSON.parse(stdout.join("")) as { ok: boolean; error: string; status: unknown };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/-o/);
    expect(body.status).toBe("error");
  });

  it("keeps inner padding on a long node label in light and dark themes and in SVG text", async () => {
    const source = [
      "flowchart LR",
      '  core["core-rtr<br/>Lo0 2001:db8::1/128"]',
      '  guest["Short"]',
      "  core -->|line one<br/>line two<br/>line three| guest",
      "",
    ].join("\n");
    const light = `---\nconfig:\n  theme: default\n---\n${source}`;
    const dark = `---\nconfig:\n  theme: dark\n---\n${source}`;
    const svgText = `---\nconfig:\n  theme: dark\n  htmlLabels: false\n---\n${source}`;
    for (const [name, text] of [
      ["light", light],
      ["dark", dark],
      ["svg", svgText],
    ] as const) {
      const rendered = await renderDiagram({ source: text, format: "svg" });
      const svg = rendered.body.toString("utf8");
      expect(svgXmlError(svg), name).toBeNull();
      const plain = svg.replace(/<[^>]+>/g, "");
      expect(plain, name).toContain("core-rtr");
      expect(plain, name).toContain("Lo0 2001:db8::1/128");
      expect(plain, name).toContain("line one");
      expect(plain, name).toContain("line two");
      expect(plain, name).toContain("line three");
      expect(svg, name).toContain("data-nerdgram-pad");
      expect(svg, name).not.toMatch(/<span[^>]*edgeLabel[^>]*padding/);
      expect(svg, name).not.toMatch(/<br(?![^>]*\/>)/i);
      const inset = await labelInset(svg, "2001:db8::1/128");
      expect(inset, name).toBeGreaterThanOrEqual(12);
    }
    const png = await renderDiagram({ source: dark, format: "png" });
    expect(png.body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});

/** Replace the SVG Mermaid returns, before the well-formed check. */
function stubRendererSvg(svg: string): () => void {
  const proto = Page.prototype as unknown as {
    evaluate: (pageFunction: unknown, ...args: unknown[]) => Promise<unknown>;
  };
  const original = proto.evaluate;
  proto.evaluate = async function (this: Page, pageFunction: unknown, ...args: unknown[]) {
    const source = typeof pageFunction === "function" ? Function.prototype.toString.call(pageFunction) : "";
    if (source.includes("padEdgeLabelSvg")) return { ok: true, svg };
    return original.call(this, pageFunction, ...args);
  };
  return () => {
    proto.evaluate = original;
  };
}

async function labelInset(svg: string, needle: string): Promise<number> {
  const browser = await puppeteer.launch({ headless: "shell", args: ["--disable-dev-shm-usage", "--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`, { waitUntil: "domcontentloaded" });
    const inset = await page.evaluate((wanted: string) => {
      const svgEl = document.querySelector("svg");
      if (!svgEl) return null;
      const box = svgEl.viewBox?.baseVal;
      if (box && box.width > 0) {
        svgEl.setAttribute("width", String(box.width));
        svgEl.setAttribute("height", String(box.height));
      }
      svgEl.style.maxWidth = "none";
      const node = [...document.querySelectorAll("g.node")].find((item) => (item.textContent ?? "").includes(wanted));
      const shape = node?.querySelector("rect");
      if (!node || !shape) return null;
      const paragraph = node.querySelector("p");
      const text = node.querySelector("text");
      const font = paragraph ? getComputedStyle(paragraph).font : text ? getComputedStyle(text).font : "16px sans-serif";
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.font = font;
      const outers = [...node.querySelectorAll("tspan.text-outer-tspan")];
      const lines = paragraph
        ? paragraph.innerHTML.split(/<br\s*\/?>/i).map((line) => line.replace(/<[^>]+>/g, ""))
        : (outers.length > 0 ? outers : [...node.querySelectorAll("tspan")]).map((item) => item.textContent ?? "");
      const widest = Math.max(0, ...lines.map((line) => context.measureText(line).width));
      const bounds = shape.getBoundingClientRect();
      return (bounds.width - widest) / 2;
    }, needle);
    if (inset == null || !Number.isFinite(inset)) throw new Error(`No inset for ${needle}`);
    return inset;
  } finally {
    await browser.close();
  }
}
