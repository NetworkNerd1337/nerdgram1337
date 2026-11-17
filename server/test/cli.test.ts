import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { formatRowIssues, main } from "../src/cli.js";
import { closeRenderer } from "../src/renderDiagram.js";
import { makeTempDataDir } from "./helpers.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: serverRoot,
      env: { ...process.env, NERDGRAM_TOKEN: "", NERDGRAM_URL: "" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("nerdgram CLI", () => {
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

  afterAll(async () => {
    await closeRenderer();
  });

  it("prints help and fails unknown commands from the process entry", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("nerdgram list");
    expect(help.stdout).toContain("nerdgram duplicate");
    expect(help.stdout).toContain("--copy-data");
    expect(help.stdout).toContain("--with-data");
    expect(help.stdout).toContain("NERDGRAM_TOKEN");
    expect(help.stdout).toContain("--url");
    expect(help.stdout).toContain("--token");
    expect(help.stdout).toContain("--include-down");
    expect(help.stdout).toContain("--vlan");
    expect(help.stdout).toContain("platform or capability");
    expect(help.stdout).toContain("vrf");
    expect(help.stdout).toContain("site, role, or platform");
    expect(help.stdout).toContain('{"ok":true');

    const version = await runCli(["--version"]);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^nerdgram \d+\.\d+\.\d+$/);
    expect(version.stderr).toBe("");

    const refreshView = await runCli(["refresh", "Campus.mmd", "--view", "l2"]);
    expect(refreshView.code).toBe(1);
    expect(refreshView.stderr).toMatch(/does not take --view/);

    const unknown = await runCli(["nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown command/);
  });

  it("lints a local file without a server", async () => {
    const file = path.join(os.tmpdir(), `nerdgram-lint-${process.pid}.mmd`);
    await fs.writeFile(file, "flowchart LR\n  A[One] --> B[Two]\n");
    try {
      const clean = await runCli(["lint", file, "--json"]);
      expect(clean.code).toBe(0);
      const body = JSON.parse(clean.stdout) as { ok: boolean; diagnostics: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.diagnostics).toEqual([]);
    } finally {
      await fs.rm(file, { force: true });
    }

    const syntax = path.join(os.tmpdir(), `nerdgram-lint-syntax-${process.pid}.mmd`);
    await fs.writeFile(syntax, "flowchart LR\n  A -->\n");
    try {
      const failed = await runCli(["lint", syntax]);
      expect(failed.code).toBe(1);
      expect(failed.stdout).toMatch(/Line 2/);
      expect(failed.stdout).toContain("parse");
      expect(`${failed.stdout}\n${failed.stderr}`).not.toMatch(/No problems/);
    } finally {
      await fs.rm(syntax, { force: true });
    }

    const broken = path.join(os.tmpdir(), `nerdgram-lint-bad-${process.pid}.mmd`);
    await fs.writeFile(broken, "---\n[ this is not: yaml\n---\nflowchart LR\n  A-->B\n");
    try {
      const failed = await runCli(["lint", broken, "--json"]);
      expect(failed.code).toBe(1);
      const body = JSON.parse(failed.stdout) as { ok: boolean; diagnostics: { severity: string }[] };
      expect(body.ok).toBe(true);
      expect(body.diagnostics.some((item) => item.severity === "error")).toBe(true);
    } finally {
      await fs.rm(broken, { force: true });
    }
  });

  it("prints generate row and field errors in text and json", async () => {
    expect(
      formatRowIssues([
        { row: 2, message: "source is empty." },
        { row: 0, path: "/devices/0/name", message: "duplicate device \"core\"." },
      ]),
    ).toEqual(["row 2: source is empty.", "/devices/0/name: duplicate device \"core\"."]);

    const server = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const created = await request(server)
      .post("/api/tokens")
      .set("Host", "127.0.0.1:8787")
      .set("Content-Type", "application/json")
      .send({ name: "cli", scope: "read-write" });
    expect(created.status).toBe(201);
    const running = await listen(server);
    const url = `http://127.0.0.1:${running.port}`;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: (chunk: string) => stdout.push(chunk),
      stderr: (chunk: string) => stderr.push(chunk),
      env: {} as NodeJS.ProcessEnv,
    };
    const bad = path.join(dir, "bad.network.json");
    await fs.writeFile(
      bad,
      JSON.stringify({
        schemaVersion: 1,
        devices: [{ name: "core" }, { name: "core" }],
        interfaces: [],
      }),
    );
    const args = ["generate", "--path", "Dup.mmd", "--data", bad, "--format", "network", "--view", "l3", "--url", url, "--token", created.body.token as string];
    try {
      expect(await main(args, io)).toBe(1);
      const text = stderr.join("");
      expect(text).toContain("Fix the rows listed before creating the diagram.");
      expect(text).toContain("duplicate device");
      expect(text).toContain("/devices/");

      stdout.length = 0;
      stderr.length = 0;
      expect(await main([...args, "--json"], io)).toBe(1);
      const body = JSON.parse(stdout.join("")) as { ok: boolean; error: string; errors: { path?: string; message: string }[] };
      expect(body.ok).toBe(false);
      expect(body.error).toContain("duplicate device");
      expect(body.errors.some((item) => item.message.includes("duplicate device"))).toBe(true);
    } finally {
      await running.close();
    }
  });

  it("renders a local file offline and drives the API commands", async () => {
    const server = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const created = await request(server)
      .post("/api/tokens")
      .set("Host", "127.0.0.1:8787")
      .set("Content-Type", "application/json")
      .send({ name: "cli", scope: "read-write" });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    const running = await listen(server);
    const url = `http://127.0.0.1:${running.port}`;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: (chunk: string) => stdout.push(chunk),
      stderr: (chunk: string) => stderr.push(chunk),
      env: {} as NodeJS.ProcessEnv,
    };
    const flags = ["--json", "--url", url, "--token", token];

    try {
      const source = path.join(dir, "Local.mmd");
      const svg = path.join(dir, "Local.svg");
      await fs.writeFile(source, "flowchart LR\n  Alpha[Alpha] --> Beta[Beta]\n");
      stdout.length = 0;
      const rendered = await main(["render", source, "-o", svg, "--json"], io);
      expect(rendered).toBe(0);
      stderr.length = 0;
      const serverRender = await main(["render", source, "--server", "-o", svg, ...flags.filter((flag) => flag !== "--json")], io);
      expect(serverRender).toBe(1);
      expect(stderr.join("")).toMatch(/Drop --server/);
      const svgText = await fs.readFile(svg, "utf8");
      expect(svgText).toContain("<svg");
      expect(svgText).toContain("Alpha");

      const bad = path.join(dir, "Bad.mmd");
      await fs.writeFile(bad, "flowchart LR\n  A -->\n");
      stdout.length = 0;
      stderr.length = 0;
      expect(await main(["render", bad, "-o", path.join(dir, "Bad.svg")], io)).toBe(1);
      const renderError = stderr.join("");
      expect(renderError).toMatch(/Line 2/);
      expect(renderError).not.toMatch(/line 4/i);

      const headed = path.join(dir, "Headed.mmd");
      await fs.writeFile(headed, "---\ntitle: T\n---\nflowchart LR\n  A -->\n");
      stderr.length = 0;
      expect(await main(["render", headed, "-o", path.join(dir, "Headed.svg")], io)).toBe(1);
      expect(stderr.join("")).toMatch(/Line 5/);

      const note = path.join(dir, "Note.mmd");
      await fs.writeFile(note, "flowchart LR\n  A[Saved] --> B[Here]\n");
      stdout.length = 0;
      expect(await main(["put", "Notes.mmd", note, ...flags], io)).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({ ok: true, path: "Notes.mmd" });

      stdout.length = 0;
      expect(await main(["list", ...flags], io)).toBe(0);
      const listed = JSON.parse(stdout.join("")) as { ok: boolean; files: { path: string }[] };
      expect(listed.ok).toBe(true);
      expect(listed.files.map((file) => file.path)).toContain("Notes.mmd");

      stdout.length = 0;
      expect(await main(["search", "Saved", ...flags], io)).toBe(0);
      expect(JSON.parse(stdout.join("")).hits.length).toBeGreaterThan(0);

      const got = path.join(dir, "got.mmd");
      stdout.length = 0;
      expect(await main(["get", "Notes.mmd", "-o", got, ...flags], io)).toBe(0);
      expect(await fs.readFile(got, "utf8")).toContain("Saved");

      const exported = path.join(dir, "exported");
      stdout.length = 0;
      expect(await main(["export", "", "-o", exported, ...flags], io)).toBe(0);
      expect(await fs.readFile(path.join(exported, "Notes.mmd"), "utf8")).toContain("Saved");

      const csv = path.join(dir, "links.csv");
      await fs.writeFile(csv, "Local Device,Remote Device\nCore,Atlanta\n");
      stdout.length = 0;
      expect(await main(["generate", "--path", "Campus.mmd", "--data", csv, ...flags], io)).toBe(0);
      expect(JSON.parse(stdout.join("")).path).toBe("Campus.mmd");

      const lldp = path.join(dir, "neighbors.lldp");
      await fs.writeFile(
        lldp,
        "core-sw#show lldp neighbors detail\nLocal Intf: Gi1/0/1\nPort id: Gi1/0/2\nSystem Name: dist-sw\nSystem Description: Cisco IOS Software\n",
      );
      stdout.length = 0;
      expect(
        await main(["generate", "--path", "Neighbors.mmd", "--data", lldp, "--format", "lldp", "--group-by", "platform", ...flags], io),
      ).toBe(0);
      expect(JSON.parse(stdout.join("")).dataPath).toBe("Neighbors.lldp");

      const network = path.join(dir, "campus.network.json");
      await fs.writeFile(
        network,
        JSON.stringify({
          schemaVersion: 1,
          devices: [{ name: "core" }, { name: "dist" }],
          interfaces: [
            { device: "core", name: "Gi0/0", ipv4: [{ address: "10.1.0.1", prefix: 30 }] },
            { device: "dist", name: "Gi0/1", ipv4: [{ address: "10.1.0.2", prefix: 30 }] },
          ],
        }),
      );
      stdout.length = 0;
      expect(
        await main(
          ["generate", "--path", "Campus-L3.mmd", "--data", network, "--format", "network", "--view", "l3", ...flags],
          io,
        ),
      ).toBe(0);
      expect(JSON.parse(stdout.join("")).dataPath).toBe("Campus-L3.network.json");
      stdout.length = 0;
      expect(await main(["refresh", "Campus-L3.mmd", ...flags], io)).toBe(0);
      expect(JSON.parse(stdout.join("")).saved).toBe(true);

      stdout.length = 0;
      expect(await main(["refresh", "Campus.mmd", ...flags], io)).toBe(0);
      expect(JSON.parse(stdout.join("")).saved).toBe(true);

      stdout.length = 0;
      expect(await main(["move", "Campus.mmd", "Sites", ...flags], io)).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        ok: true,
        path: "Sites/Campus.mmd",
        dataFiles: [{ from: "Campus.csv", to: "Sites/Campus.csv" }],
      });

      stdout.length = 0;
      expect(await main(["duplicate", "Sites/Campus.mmd", "--copy-data", ...flags], io)).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        ok: true,
        path: "Sites/Campus (copy).mmd",
        dataFiles: [{ from: "Sites/Campus.csv", to: "Sites/Campus (copy).csv" }],
      });
      const originalCsv = await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8");
      const copiedCsv = await fs.readFile(path.join(dir, "Sites", "Campus (copy).csv"), "utf8");
      expect(copiedCsv).toBe(originalCsv);

      stdout.length = 0;
      expect(await main(["delete", "Sites/Campus.mmd", "--keep-data", ...flags], io)).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({ ok: true, trashed: true });
      expect(await fs.readFile(path.join(dir, "Sites", "Campus.csv"), "utf8")).toBe(originalCsv);

      stdout.length = 0;
      expect(await main(["lint", "Notes.mmd", ...flags], io)).toBe(0);

      stdout.length = 0;
      const missing = await main(["get", "Missing.mmd", ...flags], io);
      expect(missing).toBe(1);
      expect(JSON.parse(stdout.join("")).ok).toBe(false);
    } finally {
      await running.close();
    }
  }, 60_000);
});
