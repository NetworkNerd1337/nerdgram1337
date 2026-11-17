import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { reportUnreadable, unreadableMessage } from "../src/readError.js";
import { textFiles } from "../src/textFile.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

function readError(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: injected read failure`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("read error explanations", () => {
  it("maps common errnos to a sentence and keeps the code", () => {
    expect(unreadableMessage("Network topology.mmd", "EIO")).toBe(
      "Couldn't read `Network topology.mmd`. The file may still be syncing or the folder may be unavailable on this computer (EIO).",
    );
    expect(unreadableMessage("Sites/Core.mmd", "EACCES")).toBe(
      "Couldn't read `Sites/Core.mmd`. This computer does not have permission to read the file (EACCES).",
    );
    expect(unreadableMessage("Core.mmd", "EPERM")).toContain("(EPERM)");
    expect(unreadableMessage("Core.mmd", "ENOENT")).toContain("removed or renamed");
    expect(unreadableMessage("Core.mmd", "EBUSY")).toContain("busy");
    expect(unreadableMessage("Core.mmd", "ETIMEDOUT")).toContain("timed out");
    expect(unreadableMessage("Core.mmd", "ENOTSUP")).toBe(
      "Couldn't read `Core.mmd`. The file could not be read (ENOTSUP).",
    );
    expect(unreadableMessage("Core.mmd", "")).toBe("Couldn't read `Core.mmd`. The file could not be read.");
    for (const code of ["EIO", "EACCES", "EPERM", "ENOENT", "EBUSY", "ETIMEDOUT", "ENOTSUP"]) {
      const message = unreadableMessage("Core.mmd", code);
      expect(message).not.toBe(code);
      expect(message).not.toMatch(/i\/o error/i);
    }
  });

  it("turns a not-found race into the ENOENT sentence", () => {
    const missing = Object.assign(new Error("Not found"), { status: 404, code: "not_found" });
    expect(reportUnreadable("Network topology.mmd", missing)).toEqual({
      path: "Network topology.mmd",
      code: "ENOENT",
      message: unreadableMessage("Network topology.mmd", "ENOENT"),
    });
  });
});

describe("diagram lint with an injected read error", () => {
  let cleanup = async () => {};
  let dir = "";

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    dir = temp.dir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  async function createDiagram(app: ReturnType<typeof createApp>, filePath: string, content: string) {
    const created = await request(app)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: filePath, content });
    expect(created.status).toBe(200);
  }

  it("lists one unreadable file and still returns the other findings", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const broken = "flowchart LR\n  A[One] --> Ennd\n  classDef muted fill:#eee\n";
    await createDiagram(app, "Broken.mmd", broken);
    await createDiagram(app, "WAN.mmd", "flowchart LR\n  A[One] --> B[Two]\n");
    await createDiagram(app, "Network topology.mmd", "flowchart LR\n  A[Core] --> B[Edge]\n");

    vi.spyOn(textFiles, "read").mockImplementation(async (abs) => {
      if (path.basename(abs) === "Network topology.mmd") throw readError("EIO");
      return fs.readFile(abs, "utf8");
    });

    const workspace = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(workspace.status).toBe(200);
    expect(workspace.body.checked).toBe(3);
    expect(workspace.body.unreadable).toEqual([
      {
        path: "Network topology.mmd",
        code: "EIO",
        message: unreadableMessage("Network topology.mmd", "EIO"),
      },
    ]);
    const findings = workspace.body.diagrams.find((item: { path: string }) => item.path === "Broken.mmd");
    expect(findings.diagnostics.some((item: { ruleId: string }) => item.ruleId === "unused-class")).toBe(true);
    expect(workspace.body.diagrams.some((item: { path: string }) => item.path === "Network topology.mmd")).toBe(false);
    expect(workspace.body.diagrams.some((item: { path: string }) => item.path === "WAN.mmd")).toBe(false);
    expect(JSON.stringify(workspace.body)).not.toContain(dir);
    expect(JSON.stringify(workspace.body)).not.toMatch(/i\/o error/i);
    expect(workspace.body.lock).toBeUndefined();

    const file = await request(app).get("/api/file").set("Host", HOST).query({ path: "Network topology.mmd" });
    expect(file.status).toBe(500);
    expect(file.body.code).toBe("unreadable");
    expect(file.body.errno).toBe("EIO");
    expect(file.body.error).toBe(unreadableMessage("Network topology.mmd", "EIO"));
    expect(file.body.lock).toBeUndefined();

    const thumb = await request(app).get("/api/thumbnail").set("Host", HOST).query({ path: "Network topology.mmd" });
    expect(thumb.status).toBe(500);
    expect(thumb.body.code).toBe("unreadable");
    expect(thumb.body.error).toBe(unreadableMessage("Network topology.mmd", "EIO"));
    expect(thumb.body.lock).toBeUndefined();
  });

  it("reports a file that disappears between the listing and the read", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    await createDiagram(app, "Broken.mmd", "flowchart LR\n  A[One] --> Ennd\n  classDef muted fill:#eee\n");
    await createDiagram(app, "Gone.mmd", "flowchart LR\n  A[One] --> B[Two]\n");

    vi.spyOn(textFiles, "read").mockImplementation(async (abs) => {
      if (path.basename(abs) === "Gone.mmd") throw readError("ENOENT");
      return fs.readFile(abs, "utf8");
    });

    const workspace = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(workspace.status).toBe(200);
    expect(workspace.body.unreadable).toEqual([
      {
        path: "Gone.mmd",
        code: "ENOENT",
        message: unreadableMessage("Gone.mmd", "ENOENT"),
      },
    ]);
    expect(
      workspace.body.diagrams
        .find((item: { path: string }) => item.path === "Broken.mmd")
        .diagnostics.some((item: { ruleId: string }) => item.ruleId === "unused-class"),
    ).toBe(true);
  });
});
