import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { diagramInitConfig, parseDiagram, withNodeLabelRoom, NODE_LABEL_WRAP_WIDTH } from "../src/frontMatter.js";
import { contentWithStyle, initialPresetId, type StyleSnapshot } from "../src/stylePresetModel.js";
import { clearWorkspaceValueCache } from "../src/workspaceValues.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = { Host: HOST, "Content-Type": "application/json" };
const BODY = "flowchart LR\n  A[Keep] --> B[Me]\n";

const style: StyleSnapshot = {
  theme: "forest",
  look: "classic",
  handDrawnSeed: 7,
  layout: "elk",
  fontFamily: "IBM Plex Sans",
  themeVariables: { primaryColor: "#112233", lineColor: "#abcdef" },
  themeCSS: ".edge { stroke-width: 2px; }",
  flowchartCurve: "basis",
  elk: { mergeEdges: true, nodePlacementStrategy: "BRANDES_KOEPF" },
  displayMode: "compact",
};

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

function diagram(options: { font?: string; color?: string; fill?: string }): string {
  const font = options.font ? `  fontFamily: ${JSON.stringify(options.font)}\n` : "";
  const color = options.color ? `    primaryColor: ${JSON.stringify(options.color)}\n` : "";
  const variables = color ? `  themeVariables:\n${color}` : "";
  const header = font || variables ? `---\nconfig:\n${font}${variables}---\n` : "";
  const fill = options.fill ? `  classDef hot fill:${options.fill}\n` : "";
  return `${header}flowchart LR\n  A:::hot --> B\n${fill}`;
}

describe("style presets", () => {
  let cleanup = async () => {};
  let dir = "";

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    dir = temp.dir;
    clearWorkspaceValueCache();
  });

  afterEach(async () => {
    clearWorkspaceValueCache();
    await cleanup();
  });

  it("creates, updates, and deletes a preset, and rejects unknown keys", async () => {
    const api = app();
    const rejected = await request(api).post("/api/style-presets").set(json).send({ name: "House", style, extra: true });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/Unknown field "extra"/);

    const badTheme = await request(api).post("/api/style-presets").set(json).send({
      name: "House",
      style: { ...style, theme: "nope" },
    });
    expect(badTheme.status).toBe(400);

    const created = await request(api).post("/api/style-presets").set(json).send({ name: "House", style, default: true });
    expect(created.status).toBe(201);
    const id = created.body.preset.id as string;
    expect(created.body.defaultId).toBe(id);
    expect(created.body.presets).toHaveLength(1);

    const duplicate = await request(api).post("/api/style-presets").set(json).send({ name: "house", style });
    expect(duplicate.status).toBe(409);

    const renamed = await request(api).put(`/api/style-presets/${id}`).set(json).send({ name: "Lab house" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.preset.name).toBe("Lab house");
    expect(renamed.body.preset.style.theme).toBe("forest");

    const cleared = await request(api).put(`/api/style-presets/${id}`).set(json).send({ default: false });
    expect(cleared.body.defaultId).toBeNull();

    const removed = await request(api).delete(`/api/style-presets/${id}`).set(json);
    expect(removed.status).toBe(200);
    expect(removed.body.presets).toEqual([]);

    const missing = await request(api).delete(`/api/style-presets/${id}`).set(json);
    expect(missing.status).toBe(404);
  });

  it("copies preset values into front matter and leaves the diagram alone when the preset changes", async () => {
    const api = app();
    const source = `---\ntitle: Campus\nnerdgram:\n  notes: Keep this\n  tags:\n    - lab\n---\n${BODY}`;
    await request(api).put("/api/file").set(json).send({ path: "Campus.mmd", content: source });
    const before = await fs.readFile(path.join(dir, "Campus.mmd"), "utf8");

    const created = await request(api).post("/api/style-presets").set(json).send({ name: "House", style, default: true });
    const id = created.body.preset.id as string;
    const applied = contentWithStyle(source, style);
    const parsed = parseDiagram(applied);
    expect(parsed.title).toBe("Campus");
    expect(parsed.notes).toBe("Keep this");
    expect(parsed.tags).toEqual(["lab"]);
    expect(parsed.body).toBe(BODY);
    expect(parsed.theme).toBe("forest");
    expect(parsed.look).toBe("classic");
    expect(parsed.handDrawnSeed).toBe(7);
    expect(parsed.layout).toBe("elk");
    expect(parsed.fontFamily).toBe("IBM Plex Sans");
    expect(parsed.themeVariables.primaryColor).toBe("#112233");
    expect(parsed.themeCSS).toContain("stroke-width");
    expect(parsed.flowchartCurve).toBe("basis");
    expect(parsed.elk.mergeEdges).toBe(true);
    expect(parsed.elk.nodePlacementStrategy).toBe("BRANDES_KOEPF");
    expect(parsed.displayMode).toBe("compact");
    expect(applied).not.toContain(id);
    expect(contentWithStyle(BODY, null)).toBe(BODY);

    const wide = `---\nconfig:\n  flowchart:\n    wrappingWidth: 80\n    curve: linear\n---\n${BODY}`;
    const kept = contentWithStyle(wide, style);
    const keptDoc = parseDiagram(kept);
    expect(keptDoc.flowchartCurve).toBe("basis");
    expect(keptDoc.config.flowchart).toMatchObject({ wrappingWidth: 80, curve: "basis" });
    expect(withNodeLabelRoom(diagramInitConfig(kept)).flowchart).toMatchObject({ wrappingWidth: 80, curve: "basis" });
    const cleared = contentWithStyle(wide, { ...style, flowchartCurve: null });
    expect(parseDiagram(cleared).flowchartCurve).toBeNull();
    expect(parseDiagram(cleared).config.flowchart).toMatchObject({ wrappingWidth: 80 });
    const plain = contentWithStyle(BODY, style);
    expect(parseDiagram(plain).config.flowchart).toEqual({ curve: "basis" });
    expect(withNodeLabelRoom(diagramInitConfig(plain)).flowchart).toMatchObject({
      wrappingWidth: NODE_LABEL_WRAP_WIDTH,
      curve: "basis",
    });
    expect(initialPresetId("create", created.body)).toBe(id);
    expect(initialPresetId("template", created.body)).toBe("");

    await request(api).put(`/api/style-presets/${id}`).set(json).send({
      style: { ...style, theme: "dark", themeVariables: { primaryColor: "#ffffff" } },
    });
    await request(api).delete(`/api/style-presets/${id}`).set(json);
    const after = await fs.readFile(path.join(dir, "Campus.mmd"), "utf8");
    expect(after).toBe(before);

    const tree = await request(api).get("/api/tree").set("Host", HOST);
    expect(JSON.stringify(tree.body)).not.toContain("style-presets");
  });

  it("imports a preset document and can replace the list", async () => {
    const api = app();
    const first = await request(api).post("/api/style-presets").set(json).send({ name: "Local", style });
    const imported = await request(api).post("/api/style-presets/import").set(json).send({
      version: 1,
      defaultId: "sp0123456789abcdef",
      mode: "add",
      presets: [{ id: "sp0123456789abcdef", name: "Shared", style: { theme: "neutral" } }],
    });
    expect(imported.status).toBe(200);
    expect(imported.body.presets.map((item: { name: string }) => item.name)).toEqual(["Local", "Shared"]);
    expect(imported.body.defaultId).not.toBe("sp0123456789abcdef");
    expect(imported.body.presets[0].id).toBe(first.body.preset.id);

    const replaced = await request(api).post("/api/style-presets/import").set(json).send({
      version: 1,
      defaultId: null,
      mode: "replace",
      presets: [{ name: "Only", style: { theme: "dark" } }],
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.presets).toHaveLength(1);
    expect(replaced.body.presets[0].name).toBe("Only");
    expect(replaced.body.defaultId).toBeNull();

    const unknown = await request(api).post("/api/style-presets/import").set(json).send({
      version: 1,
      presets: [],
      note: "nope",
    });
    expect(unknown.status).toBe(400);
  });

  it("counts fonts and colors and skips trash", async () => {
    const api = app();
    await request(api).put("/api/file").set(json).send({
      path: "One.mmd",
      content: diagram({ font: "IBM Plex Sans", color: "#ffffff", fill: "#fff" }),
    });
    await request(api).put("/api/file").set(json).send({
      path: "Two.mmd",
      content: diagram({ font: "IBM Plex Sans", color: "#FFF", fill: "#333333" }),
    });
    await request(api).put("/api/file").set(json).send({
      path: "Three.mmd",
      content: diagram({ font: "ibm plex sans", color: "navy" }),
    });
    await request(api).put("/api/file").set(json).send({
      path: "Gone.mmd",
      content: diagram({ font: "Comic Sans MS", color: "#ff00aa", fill: "#00ff00" }),
    });
    const trashed = await request(api).delete("/api/item").set(json).send({ path: "Gone.mmd" });
    expect(trashed.status).toBe(204);

    const fonts = await request(api).get("/api/fonts").set("Host", HOST);
    expect(fonts.status).toBe(200);
    const fontRows = fonts.body.fonts as { fontFamily: string; count: number }[];
    expect(fontRows.find((item) => item.fontFamily === "IBM Plex Sans")).toEqual({
      fontFamily: "IBM Plex Sans",
      count: 2,
    });
    expect(fontRows.find((item) => item.fontFamily === "ibm plex sans")).toEqual({
      fontFamily: "ibm plex sans",
      count: 1,
    });
    expect(fontRows.some((item) => item.fontFamily === "Comic Sans MS")).toBe(false);

    const colors = await request(api).get("/api/colors").set("Host", HOST);
    const colorRows = colors.body.colors as { color: string; count: number }[];
    expect(colorRows.find((item) => item.color === "#ffffff")?.count).toBe(2);
    expect(colorRows.find((item) => item.color === "#333333")?.count).toBe(1);
    expect(colorRows.find((item) => item.color === "navy")?.count).toBe(1);
    expect(colorRows.some((item) => item.color === "#ff00aa" || item.color === "#00ff00")).toBe(false);
    expect(colorRows[0].count).toBeGreaterThanOrEqual(colorRows[colorRows.length - 1].count);
  });
});
