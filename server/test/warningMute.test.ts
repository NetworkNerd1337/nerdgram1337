import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { lintDiagram } from "../src/diagramLint.js";
import { lintDiagramSource } from "../src/mermaidSyntax.js";
import { REPO_ROOT } from "../src/paths.js";
import { omitMutedWarnings, setWarningsMuted, WARNINGS_MUTED_LINE, warningsMuted } from "../src/warningMute.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const WARNING = "flowchart LR\n  Title[Title]\n  classDef coreStyle fill:#fff\n";
const LOUD = "flowchart LR\n  A[One]\n  classDef spare fill:#eee\n";

describe("warning mute directive", () => {
  it("parses the directive and round-trips a toggle without moving other lines", () => {
    expect(warningsMuted(WARNING)).toBe(false);
    expect(warningsMuted(`  ${WARNINGS_MUTED_LINE}  \nflowchart LR\n`)).toBe(true);
    expect(warningsMuted("%% nerdgram:generated\nflowchart LR\n")).toBe(false);

    const muted = setWarningsMuted(WARNING, true);
    expect(muted.startsWith(`${WARNINGS_MUTED_LINE}\n`)).toBe(true);
    expect(muted.endsWith(WARNING)).toBe(true);
    expect(setWarningsMuted(muted, true)).toBe(muted);
    expect(setWarningsMuted(muted, false)).toBe(WARNING);

    const crlf = WARNING.replace(/\n/g, "\r\n");
    const mutedCrlf = setWarningsMuted(crlf, true);
    expect(mutedCrlf.includes("\r\n")).toBe(true);
    expect(setWarningsMuted(mutedCrlf, false)).toBe(crlf);

    const wan = fs.readFileSync(path.join(REPO_ROOT, "diagrams/WAN.mmd"), "utf8");
    const withFrontMatter = setWarningsMuted(wan, true);
    const lines = withFrontMatter.split("\n");
    expect(lines[7]).toBe(WARNINGS_MUTED_LINE);
    expect(lines[8]).toBe("flowchart LR");
    expect(setWarningsMuted(withFrontMatter, false)).toBe(wan);
  });

  it("drops warnings and keeps errors, and does not change the warnings the check would find", async () => {
    const plain = lintDiagram(WARNING);
    const commented = lintDiagram(`${WARNINGS_MUTED_LINE}\n${WARNING}`);
    expect(plain.some((item) => item.severity === "warning")).toBe(true);
    expect(commented.map((item) => item.message)).toEqual(plain.map((item) => item.message));

    const muted = await lintDiagramSource(`${WARNINGS_MUTED_LINE}\n${WARNING}`);
    expect(muted).toEqual([]);

    const broken = await lintDiagramSource(`${WARNINGS_MUTED_LINE}\nflowchart LR\n  A -->\n  classDef coreStyle fill:#fff\n`);
    expect(broken.some((item) => item.severity === "error" && item.ruleId === "parse")).toBe(true);
    expect(broken.some((item) => item.severity === "warning")).toBe(false);
    expect(omitMutedWarnings(WARNING, plain)).toEqual(plain);
  });
});

describe("muted warnings on the workspace check", () => {
  let cleanup = async () => {};

  afterEach(async () => {
    await cleanup();
  });

  it("omits muted warnings from counts, keeps errors, and follows rename and move", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const json = { Host: HOST, "Content-Type": "application/json" };

    const quiet = setWarningsMuted(WARNING, true);
    expect(
      (
        await request(app).put("/api/file").set(json).send({ path: "Quiet.mmd", content: quiet })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app).put("/api/file").set(json).send({ path: "Loud.mmd", content: LOUD })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .put("/api/file")
          .set(json)
          .send({ path: "Bad.mmd", content: `${WARNINGS_MUTED_LINE}\nflowchart LR\n  A -->\n` })
      ).status,
    ).toBe(200);

    const open = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(open.status).toBe(200);
    const names = open.body.diagrams.map((item: { path: string }) => item.path);
    expect(names).not.toContain("Quiet.mmd");
    expect(names).toContain("Loud.mmd");
    const bad = open.body.diagrams.find((item: { path: string }) => item.path === "Bad.mmd");
    expect(bad.diagnostics.some((item: { severity: string }) => item.severity === "error")).toBe(true);
    expect(bad.diagnostics.some((item: { severity: string }) => item.severity === "warning")).toBe(false);
    expect(open.body.muted).toEqual(expect.arrayContaining(["Quiet.mmd", "Bad.mmd"]));
    expect(open.body.muted).not.toContain("Loud.mmd");

    const renamed = await request(app).patch("/api/rename").set(json).send({ from: "Quiet.mmd", to: "Renamed.mmd" });
    expect(renamed.status).toBe(200);
    const afterRename = await request(app).get("/api/file").set("Host", HOST).query({ path: "Renamed.mmd" });
    expect(warningsMuted(afterRename.body.content)).toBe(true);

    expect((await request(app).post("/api/folder").set(json).send({ path: "Sites" })).status).toBe(201);
    const moved = await request(app).post("/api/move").set(json).send({ from: "Renamed.mmd", toFolder: "Sites" });
    expect(moved.status).toBe(200);
    const afterMove = await request(app).get("/api/file").set("Host", HOST).query({ path: "Sites/Renamed.mmd" });
    expect(warningsMuted(afterMove.body.content)).toBe(true);

    const again = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(again.body.diagrams.map((item: { path: string }) => item.path)).not.toContain("Sites/Renamed.mmd");
    expect(again.body.muted).toContain("Sites/Renamed.mmd");
    expect(again.body.diagrams.some((item: { path: string }) => item.path === "Loud.mmd")).toBe(true);
  });
});
