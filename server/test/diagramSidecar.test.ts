import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { DATA_MAX_CHARS } from "../src/diagramData.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const CDP = [
  "hub#show cdp neighbors detail",
  "-------------------------",
  "Device ID: spoke-0042",
  "Entry address(es):",
  "  IP address: 10.200.1.42",
  "Platform: cisco ISR, Capabilities: Router",
  "Interface: Tunnel0,  Port ID (outgoing port): Tunnel0",
  "",
].join("\n");

const DIAGRAM = [
  "---",
  "nerdgram:",
  "  source:",
  "    file: DMVPN-500.cdp",
  "    format: cdp",
  "    shape: links",
  "    mapping: {}",
  "    direction: LR",
  "    grouping: true",
  "    diagramType: flowchart",
  "---",
  "flowchart LR",
  '  spoke0042["spoke-0042"]',
  "",
].join("\n");

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

describe("diagram sidecar read", () => {
  let dir = "";
  let cleanup: () => Promise<void> = async () => undefined;

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns the data file named on the diagram, including 10.200.1.42", async () => {
    await fs.writeFile(path.join(dir, "DMVPN-500.mmd"), DIAGRAM, "utf8");
    await fs.writeFile(path.join(dir, "DMVPN-500.cdp"), CDP, "utf8");
    const api = app();
    const blocked = await request(api).get("/api/file").set("Host", HOST).query({ path: "DMVPN-500.cdp" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/\.mmd/);
    const read = await request(api).get("/api/diagram-sidecar").set("Host", HOST).query({ path: "DMVPN-500.mmd" });
    expect(read.status).toBe(200);
    expect(read.body.path).toBe("DMVPN-500.cdp");
    expect(read.body.content).toContain("10.200.1.42");
    expect(read.body.content).toContain("spoke-0042");
  });

  it("refuses a file outside the diagram folder, a traversal path, and a non-data extension", async () => {
    await fs.mkdir(path.join(dir, "Other"));
    await fs.writeFile(path.join(dir, "Other", "secret.cdp"), "IP address: 10.9.9.9\n", "utf8");
    const outside = DIAGRAM.replace("file: DMVPN-500.cdp", "file: Other/secret.cdp");
    await fs.writeFile(path.join(dir, "DMVPN-500.mmd"), outside, "utf8");
    const api = app();
    const otherFolder = await request(api).get("/api/diagram-sidecar").set("Host", HOST).query({ path: "DMVPN-500.mmd" });
    expect(otherFolder.status).toBe(400);

    const climbed = DIAGRAM.replace("file: DMVPN-500.cdp", "file: ../DMVPN-500.cdp");
    await fs.writeFile(path.join(dir, "DMVPN-500.mmd"), climbed, "utf8");
    const traversal = await request(api).get("/api/diagram-sidecar").set("Host", HOST).query({ path: "DMVPN-500.mmd" });
    expect(traversal.status).toBe(400);

    const script = DIAGRAM.replace("file: DMVPN-500.cdp", "file: DMVPN-500.exe");
    await fs.writeFile(path.join(dir, "DMVPN-500.mmd"), script, "utf8");
    await fs.writeFile(path.join(dir, "DMVPN-500.exe"), "nope\n", "utf8");
    const extension = await request(api).get("/api/diagram-sidecar").set("Host", HOST).query({ path: "DMVPN-500.mmd" });
    expect(extension.status).toBe(400);
    expect(await fs.readFile(path.join(dir, "DMVPN-500.exe"), "utf8")).toBe("nope\n");
  });

  it("reads a .txt sidecar in the same folder and refuses a file over 4 MiB", async () => {
    const textDiagram = DIAGRAM.replace("file: DMVPN-500.cdp", "file: notes.txt").replace("format: cdp", "format: csv");
    await fs.writeFile(path.join(dir, "DMVPN-500.mmd"), textDiagram, "utf8");
    await fs.writeFile(path.join(dir, "notes.txt"), "IP address: 10.200.1.42\n", "utf8");
    const api = app();
    const read = await request(api).get("/api/diagram-sidecar").set("Host", HOST).query({ path: "DMVPN-500.mmd" });
    expect(read.status).toBe(200);
    expect(read.body.content).toContain("10.200.1.42");

    const huge = DIAGRAM.replace("file: DMVPN-500.cdp", "file: huge.cdp");
    await fs.writeFile(path.join(dir, "DMVPN-500.mmd"), huge, "utf8");
    await fs.writeFile(path.join(dir, "huge.cdp"), "x".repeat(DATA_MAX_CHARS + 1), "utf8");
    const tooBig = await request(api).get("/api/diagram-sidecar").set("Host", HOST).query({ path: "DMVPN-500.mmd" });
    expect(tooBig.status).toBe(413);
  });
});
