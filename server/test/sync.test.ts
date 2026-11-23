import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import gitHttp from "isomorphic-git/http/node";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { thumbnailCacheKey } from "../src/frontMatter.js";
import { encodeStorageKey } from "../src/storage.js";
import { discardSearchCache } from "../src/search.js";
import { emptyConfig, saveConfig } from "../src/sync/configStore.js";
import { resetSyncForTests, setGithubFetch, setSyncTestHook, syncConcurrency } from "../src/sync/engine.js";
import { assertCleanRemoteUrl, classifyNetworkError } from "../src/sync/github.js";
import { commitMirror, gitBasicAuthorization, headOid } from "../src/sync/mirror.js";
import { readToken, writeToken } from "../src/sync/secrets.js";
import { captureConsole, makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const TOKEN = "ghp_TESTTOKENVALUE1234567890abcd";
const DEVICE_CODE = "device-code-secret-value-123456";
const CLIENT_ID = "Iv1.userowned1234";
const nodeFs = await import("node:fs");

const json = {
  Host: HOST,
  "Content-Type": "application/json",
};

function makeApp() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
    allowedHosts: [],
    allowedOrigins: [],
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fingerprint(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const text = await fs.readFile(abs);
      out.set(rel, createHash("sha256").update(text).digest("hex"));
    }
  }
  await walk(root);
  return out;
}

async function treeText(root: string): Promise<string> {
  const parts: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      parts.push(await fs.readFile(abs, "utf8"));
    }
  }
  await walk(root);
  return parts.join("\n");
}

function installGithub(remoteUrl: string, options?: { device?: "ok" | "disabled" | "invalid"; empty?: boolean; create?: "ok" | "taken" | "unreachable" }) {
  const device = options?.device ?? "ok";
  const empty = options?.empty ?? true;
  const create = options?.create ?? "ok";
  let polls = 0;
  const calls: { url: string; method: string; authorization: string }[] = [];
  setGithubFetch(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({ url, method, authorization: headers.get("authorization") ?? "" });
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain(DEVICE_CODE);
    expect(url).not.toContain("access_token=");
    if (url.includes("/login/device/code")) {
      if (device === "disabled") {
        return jsonResponse(400, { error: "device_flow_disabled", error_description: "Device flow is disabled for this app" });
      }
      if (device === "invalid") {
        return jsonResponse(404, { error: "incorrect_client_credentials" });
      }
      return jsonResponse(200, {
        device_code: DEVICE_CODE,
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 0,
      });
    }
    if (url.includes("/login/oauth/access_token")) {
      polls += 1;
      if (polls < 2) return jsonResponse(200, { error: "authorization_pending" });
      return jsonResponse(200, { access_token: TOKEN, token_type: "bearer", scope: "repo" });
    }
    if (url.endsWith("/user")) return jsonResponse(200, { login: "octocat" });
    if (method === "POST" && url.endsWith("/user/repos")) {
      if (create === "taken") {
        return jsonResponse(422, { message: "Repository creation failed.", errors: [{ message: "name already exists" }] });
      }
      const cloneUrl = create === "unreachable" ? "https://127.0.0.1:9/octocat/nerdgram-diagrams.git" : remoteUrl;
      return jsonResponse(201, repoPayload(cloneUrl));
    }
    if (url.includes("/repos/octocat/nerdgram-diagrams/commits")) {
      return empty ? jsonResponse(409, { message: "Git Repository is empty." }) : jsonResponse(200, [{ sha: "abc" }]);
    }
    if (method === "GET" && url.endsWith("/repos/octocat/nerdgram-diagrams")) {
      const remaining = headers.get("x-test-rate") ?? "";
      if (remaining === "limit") {
        return jsonResponse(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" });
      }
      return jsonResponse(200, repoPayload(remoteUrl));
    }
    if (method === "PATCH") return jsonResponse(200, repoPayload(remoteUrl));
    if (method === "DELETE" && url.includes("/applications/")) return jsonResponse(204, {});
    return jsonResponse(404, { message: "not found" });
  });
  return { calls };
}

function repoPayload(cloneUrl: string) {
  return {
    name: "nerdgram-diagrams",
    full_name: "octocat/nerdgram-diagrams",
    private: true,
    html_url: "https://github.com/octocat/nerdgram-diagrams",
    clone_url: cloneUrl,
    owner: { login: "octocat" },
    default_branch: "main",
  };
}

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

type LocalGit = {
  bare: string;
  url: string;
  requests: { method: string; url: string; authorization: string }[];
  close: () => Promise<void>;
};

async function startGitHttp(options?: { rejectStatus?: number }): Promise<LocalGit> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-git-"));
  const bare = path.join(root, "remote.git");
  await runGit(["init", "--bare", "-b", "main", bare]);
  await runGit(["-C", bare, "config", "http.receivepack", "true"]);
  const requests: LocalGit["requests"] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    requests.push({
      method: req.method || "GET",
      url: `${url.pathname}${url.search}`,
      authorization: String(req.headers.authorization || ""),
    });
    if (options?.rejectStatus) {
      res.statusCode = options.rejectStatus;
      res.setHeader("Content-Type", "text/plain");
      res.end(options.rejectStatus === 401 ? "Authentication failed" : "Forbidden");
      return;
    }
    const child = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        REQUEST_METHOD: req.method || "GET",
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.replace(/^\?/, ""),
        CONTENT_TYPE: String(req.headers["content-type"] || ""),
        CONTENT_LENGTH: String(req.headers["content-length"] || ""),
      },
    });
    req.pipe(child.stdin);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", () => {
      const raw = Buffer.concat(chunks);
      const sep = raw.indexOf("\r\n\r\n");
      const nl = raw.indexOf("\n\n");
      const headerEnd = sep >= 0 ? sep : nl;
      if (headerEnd < 0) {
        res.statusCode = 500;
        res.end(raw);
        return;
      }
      const headerText = raw.slice(0, headerEnd).toString("utf8");
      const body = raw.slice(headerEnd + (sep >= 0 ? 4 : 2));
      let status = 200;
      for (const line of headerText.split(/\r?\n/)) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const name = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (name.toLowerCase() === "status") status = Number(value.split(" ")[0]) || 200;
        else res.setHeader(name, value);
      }
      res.statusCode = status;
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    bare,
    url: `http://127.0.0.1:${port}/remote.git`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          void fs.rm(root, { recursive: true, force: true }).finally(() => resolve());
        });
      }),
  };
}

function runGit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(" ")} exited ${code}`))));
  });
}

async function headOf(bare: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs: nodeFs, gitdir: bare, ref: "refs/heads/main" });
  } catch {
    return null;
  }
}

async function filesAt(bare: string): Promise<string[]> {
  const oid = await headOf(bare);
  if (!oid) return [];
  return git.listFiles({ fs: nodeFs, gitdir: bare, ref: oid });
}

async function blobAt(bare: string, filepath: string): Promise<string | null> {
  const oid = await headOf(bare);
  if (!oid) return null;
  try {
    const { blob } = await git.readBlob({ fs: nodeFs, gitdir: bare, oid, filepath });
    return Buffer.from(blob).toString("utf8");
  } catch {
    return null;
  }
}

async function logMessages(bare: string): Promise<string[]> {
  const oid = await headOf(bare);
  if (!oid) return [];
  const commits = await git.log({ fs: nodeFs, gitdir: bare, depth: 30 });
  return commits.map((commit) => commit.commit.message.trim());
}

async function commitOnRemote(remoteUrl: string, filepath: string, content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-remote-"));
  try {
    await git.clone({ fs: nodeFs, http: gitHttp, dir, url: remoteUrl, ref: "main", singleBranch: true });
    const abs = path.join(dir, ...filepath.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    await git.add({ fs: nodeFs, dir, filepath });
    await git.commit({
      fs: nodeFs,
      dir,
      message: `Remote edit ${filepath}`,
      author: { name: "Remote", email: "remote@example.com" },
    });
    const result = await git.push({
      fs: nodeFs,
      http: gitHttp,
      dir,
      remote: "origin",
      ref: "main",
      remoteRef: "main",
      force: false,
    });
    expect(result.ok).toBe(true);
    return await git.resolveRef({ fs: nodeFs, dir, ref: "HEAD" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await delay(40);
  }
  throw new Error("timed out waiting for sync");
}

describe("GitHub sync", () => {
  let dir = "";
  let cleanup = async () => {};
  let remote: LocalGit | null = null;
  const app = makeApp();
  const logs = captureConsole();

  afterAll(() => {
    logs.restore();
  });

  beforeEach(async () => {
    await resetSyncForTests();
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    process.env.NERDGRAM_SYNC_WATCH = "0";
    process.env.NERDGRAM_SYNC_RECONCILE_MS = "0";
    process.env.NERDGRAM_SYNC_IDLE_MS = "60000";
    process.env.NERDGRAM_GITHUB_WEB = "https://github.test";
    process.env.NERDGRAM_GITHUB_API = "https://api.github.test";
    delete process.env.NERDGRAM_GITHUB_TOKEN;
    delete process.env.NERDGRAM_GITHUB_CLIENT_ID;
    delete process.env.NERDGRAM_GITHUB_CLIENT_SECRET;
    delete process.env.NERDGRAM_SYNC_MIRROR;
  });

  afterEach(async () => {
    await resetSyncForTests();
    if (remote) await remote.close();
    remote = null;
    await cleanup();
    delete process.env.NERDGRAM_SYNC_WATCH;
    delete process.env.NERDGRAM_SYNC_RECONCILE_MS;
    delete process.env.NERDGRAM_SYNC_IDLE_MS;
    delete process.env.NERDGRAM_GITHUB_WEB;
    delete process.env.NERDGRAM_GITHUB_API;
    delete process.env.NERDGRAM_GITHUB_TOKEN;
    delete process.env.NERDGRAM_GITHUB_CLIENT_SECRET;
  });

  async function signIn(): Promise<void> {
    const saved = await request(app).post("/api/sync/client-id").set(json).send({ clientId: CLIENT_ID });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(TOKEN);
    const started = await request(app).post("/api/sync/device/start").set(json).send({});
    expect(started.status).toBe(200);
    expect(started.body.device.userCode).toBe("ABCD-1234");
    expect(started.body.device.verificationUri).toBe("https://github.com/login/device");
    expect(JSON.stringify(started.body)).not.toContain(DEVICE_CODE);
    expect(JSON.stringify(started.body)).not.toContain(TOKEN);
    await waitFor(async () => {
      const status = await request(app).get("/api/sync/status").set("Host", HOST);
      return status.body.login === "octocat" && status.body.tokenSource === "file";
    });
  }

  async function connect(): Promise<request.Response> {
    if (!remote) remote = await startGitHttp();
    installGithub(remote.url);
    await signIn();
    return request(app).post("/api/sync/connect").set(json).send({});
  }

  it("connects with device flow, pushes only diagrams, and never leaks the token", async () => {
    const outside = path.join(path.dirname(dir), "templates");
    await fs.mkdir(path.join(dir, "Network"), { recursive: true });
    await fs.mkdir(path.join(dir, ".meta"), { recursive: true });
    await fs.mkdir(path.join(dir, ".secret"), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(dir, "Network", "Core.mmd"), "flowchart LR\n  A-->B\n");
    await fs.writeFile(path.join(dir, "Network", "Core.csv"), "local,remote\nA,B\n");
    await fs.writeFile(path.join(dir, "Notes.txt"), "do not sync text");
    await fs.writeFile(path.join(dir, ".hidden.mmd"), "flowchart LR\n  hidden-->x\n");
    await fs.writeFile(path.join(dir, ".secret", "Nope.mmd"), "flowchart LR\n  secret-->x\n");
    await fs.writeFile(
      path.join(dir, ".meta", "favorites.json"),
      `${JSON.stringify({ version: 1, folders: [], items: [{ path: "FAVORITE_MARKER", folderId: null }] })}\n`,
    );
    await fs.writeFile(path.join(outside, "Secret.mmd"), "flowchart LR\n  template-->x\n");
    await fs.symlink(path.join(outside, "Secret.mmd"), path.join(dir, "Link.mmd"));
    const before = await fingerprint(dir);
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    const connected = await connect();
    expect(connected.status).toBe(200);
    expect(connected.body.enabled).toBe(true);
    expect(connected.body.login).toBe("octocat");
    expect(connected.body.repo.htmlUrl).toBe("https://github.com/octocat/nerdgram-diagrams");
    expect(connected.body.repo.private).toBe(true);
    expect(connected.body.mirror).toBe(".nerdgram-git");
    expect(JSON.stringify(connected.body)).not.toContain(TOKEN);
    expect(JSON.stringify(connected.body)).not.toContain(DEVICE_CODE);

    const files = await filesAt(bare);
    expect(files).toContain("Network/Core.mmd");
    expect(files).toContain("Network/Core.csv");
    expect(files).toContain("README.md");
    expect(files).not.toEqual(expect.arrayContaining([".meta/favorites.json", "Notes.txt", ".hidden.mmd", ".secret/Nope.mmd", "Link.mmd"]));
    expect(files.some((file) => file.split("/").some((part) => part.startsWith(".") && part !== ".gitignore" && part !== ".gitattributes"))).toBe(false);
    expect(await blobAt(bare, "Network/Core.mmd")).toContain("A-->B");
    expect(await treeText(path.join(dir, ".nerdgram-git"))).not.toContain("FAVORITE_MARKER");
    expect(await treeText(path.join(dir, ".nerdgram-git"))).not.toContain(TOKEN);

    const tokenStat = await fs.stat(path.join(dir, ".meta", "github-token"));
    expect(tokenStat.mode & 0o777).toBe(0o600);
    const storedConfig = await fs.readFile(path.join(dir, ".meta", "github-sync.json"), "utf8");
    expect(storedConfig).not.toContain(TOKEN);
    expect(storedConfig).not.toContain(DEVICE_CODE);
    const gitConfig = await fs.readFile(path.join(dir, ".nerdgram-git", ".git", "config"), "utf8");
    expect(gitConfig).not.toContain(TOKEN);
    expect(gitConfig.toLowerCase()).not.toContain("extraheader");
    expect(gitConfig).not.toContain("AUTHORIZATION");
    const basic = gitBasicAuthorization(TOKEN);
    expect(basic).toBe(`Basic ${Buffer.from(`x-access-token:${TOKEN}`, "utf8").toString("base64")}`);
    expect(basic.startsWith("Bearer")).toBe(false);
    expect(remote?.requests.length).toBeGreaterThan(0);
    expect(remote?.requests.every((hit) => hit.authorization === basic)).toBe(true);
    expect(remote?.requests.every((hit) => !hit.url.includes(TOKEN) && !hit.url.toLowerCase().includes("x-access-token"))).toBe(true);
    expect(remote?.requests.every((hit) => !hit.url.includes("access_token"))).toBe(true);
    await expect(fs.access(path.join(dir, ".git"))).rejects.toThrow();

    const health = await request(app).get("/api/health").set("Host", HOST);
    expect(JSON.stringify(health.body)).not.toContain(TOKEN);
    expect(logs.logs.join("\n") + logs.errors.join("\n")).not.toContain(TOKEN);
    expect(logs.logs.join("\n") + logs.errors.join("\n")).not.toContain(DEVICE_CODE);

    const again = await request(app).post("/api/sync/now").set(json).send({});
    expect(again.status).toBe(200);
    expect(await logMessages(bare)).toHaveLength(1);

    const denied = await request(app).post("/api/sync/disable").set(json).send({ confirm: false });
    expect(denied.status).toBe(400);
    expect(denied.body.error).toMatch(/stays in your account/i);

    const disabled = await request(app).post("/api/sync/disable").set(json).send({ confirm: true });
    expect(disabled.status).toBe(200);
    expect(disabled.body.disconnected).toBe(true);
    expect(disabled.body.repoRemains).toBe(true);
    expect(disabled.body.grantRevoked).toBe(false);
    expect(disabled.body.revokeUrl).toContain("github.com/settings");
    expect(JSON.stringify(disabled.body)).not.toContain(TOKEN);
    await expect(fs.access(path.join(dir, ".nerdgram-git"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".git"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".meta", "github-token"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".meta", "github-sync.json"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "Network", "Core.mmd"), "utf8")).toContain("A-->B");
    const after = await fingerprint(dir);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [file, hash] of before) expect(after.get(file)).toBe(hash);
  });

  it("says not_connected before any account exists and clears an empty client id", async () => {
    const connect = await request(app).post("/api/sync/connect").set(json).send({});
    expect(connect.status).toBe(401);
    expect(connect.body.code).toBe("not_connected");
    expect(connect.body.error).toMatch(/Connect a GitHub account/i);

    const saved = await request(app).post("/api/sync/client-id").set(json).send({ clientId: CLIENT_ID });
    expect(saved.status).toBe(200);
    expect(saved.body.clientId).toBe(CLIENT_ID);
    const cleared = await request(app).post("/api/sync/client-id").set(json).send({ clientId: "  " });
    expect(cleared.status).toBe(200);
    expect(cleared.body.clientId).toBeNull();
    const missing = await request(app).post("/api/sync/device/start").set(json).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("invalid_client");
  });

  it("explains a missing client id and device flow that is turned off", async () => {
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    installGithub(remoteUrl, { device: "disabled" });
    const missing = await request(app).post("/api/sync/device/start").set(json).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("invalid_client");
    expect(missing.body.error).toMatch(/GitHub sync page/i);
    expect(missing.body.error).toContain("github-sync");

    await request(app).post("/api/sync/client-id").set(json).send({ clientId: CLIENT_ID });
    const disabled = await request(app).post("/api/sync/device/start").set(json).send({});
    expect(disabled.status).toBe(400);
    expect(disabled.body.code).toBe("device_flow_disabled");
    expect(disabled.body.error).toMatch(/Device flow/i);

    installGithub(remoteUrl, { device: "invalid" });
    const invalid = await request(app).post("/api/sync/device/start").set(json).send({});
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("invalid_client");
    expect(JSON.stringify(invalid.body)).not.toContain(TOKEN);
  });

  it("does not half-enable sync when the first push fails", async () => {
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    const before = await fs.readFile(path.join(dir, "Notes.mmd"), "utf8");
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    installGithub(remoteUrl, { create: "unreachable" });
    await signIn();
    const connected = await request(app).post("/api/sync/connect").set(json).send({});
    expect(connected.status).toBeGreaterThanOrEqual(400);
    expect(connected.body.error).toMatch(/not on/i);
    expect(connected.body.error).toMatch(/still in your account/i);
    expect(JSON.stringify(connected.body)).not.toContain(TOKEN);
    const status = await request(app).get("/api/sync/status").set("Host", HOST);
    expect(status.body.enabled).toBe(false);
    expect(status.body.error).not.toBeNull();
    expect(status.body.error.code).toBe(connected.body.code);
    expect(status.body.error.message).toBe(connected.body.error);
    await expect(fs.access(path.join(dir, ".nerdgram-git"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".git"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe(before);
  });

  it("asks before using a repository that already has commits", async () => {
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  Local-->Here\n");
    installGithub(remoteUrl, { empty: false, create: "taken" });
    await seedBare(remoteUrl, "README.md", "already here\n");
    await signIn();
    const blocked = await request(app).post("/api/sync/connect").set(json).send({ name: "nerdgram-diagrams" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("repo_not_empty");
    expect(blocked.body.error).toMatch(/does not force-push/i);
    expect(blocked.body.error).toMatch(/already has commits/i);

    const allowed = await request(app)
      .post("/api/sync/connect")
      .set(json)
      .send({ name: "nerdgram-diagrams", confirmNonEmpty: true });
    expect(allowed.status).toBe(200);
    expect(await blobAt(bare, "Notes.mmd")).toContain("Local-->Here");
    const messages = await logMessages(bare);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.some((message) => message.includes("already") || message === "Seed existing")).toBe(true);
  });

  it("batches edits into one commit that names the path, and picks up an external edit", async () => {
    remote = await startGitHttp();
    const bare = remote.bare;
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    const connected = await connect();
    expect(connected.status).toBe(200);
    expect(await logMessages(bare)).toEqual(["Initial import of NerdGram diagrams"]);

    const first = await save(app, "Notes.mmd", "flowchart LR\n  A-->C\n");
    expect(first.status).toBe(200);
    const second = await save(app, "Notes.mmd", "flowchart LR\n  A-->D\n");
    expect(second.status).toBe(200);
    // Saves wait for an idle gap, so two edits are still one unpushed change.
    expect(await logMessages(bare)).toHaveLength(1);
    const batched = await request(app).post("/api/sync/now").set(json).send({});
    expect(batched.status).toBe(200);
    expect(batched.body.error).toBeNull();
    const messages = await logMessages(bare);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe("Update Notes.mmd");
    expect(await blobAt(bare, "Notes.mmd")).toContain("A-->D");

    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  External-->Edit\n");
    const synced = await request(app).post("/api/sync/now").set(json).send({});
    expect(synced.status).toBe(200);
    expect(await blobAt(bare, "Notes.mmd")).toContain("External-->Edit");
    expect((await logMessages(bare))[0]).toMatch(/Notes\.mmd/);
  });

  it("pushes an offline commit after the network returns and does not force-push", async () => {
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A[\"ALPHAWORD\"]\n");
    const connected = await connect();
    expect(connected.status).toBe(200);
    const original = await headOf(bare);

    const github = installGithub(remoteUrl);
    github.calls.length = 0;
    const configPath = path.join(dir, ".meta", "github-sync.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { remoteUrl: string };
    config.remoteUrl = "https://github.com/octocat/nerdgram-diagrams.git";
    await fs.writeFile(configPath, JSON.stringify(config));
    setGithubFetch(async () => {
      throw Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" });
    });
    const saved = await save(app, "Notes.mmd", "flowchart LR\n  A[\"OFFLINEWORD\"]\n");
    expect(saved.status).toBe(200);
    const offline = await request(app).post("/api/sync/now").set(json).send({});
    expect(offline.status).toBe(200);
    expect(offline.body.error.code).toBe("offline");
    expect(offline.body.pending).toBe(true);
    expect(JSON.stringify(offline.body)).not.toContain(TOKEN);
    expect(await headOf(bare)).toBe(original);
    const mirrorBlob = await fs.readFile(path.join(dir, ".nerdgram-git", "Notes.mmd"), "utf8");
    expect(mirrorBlob).toContain("OFFLINEWORD");

    installGithub(remoteUrl);
    config.remoteUrl = remoteUrl;
    await fs.writeFile(configPath, JSON.stringify({ ...config, remoteUrl }));
    const back = await request(app).post("/api/sync/now").set(json).send({});
    expect(back.status).toBe(200);
    expect(back.body.error).toBeNull();
    expect(await blobAt(bare, "Notes.mmd")).toContain("OFFLINEWORD");

    const remoteOid = await commitOnRemote(remoteUrl, "Notes.mmd", "flowchart LR\n  A[\"REMOTEWORD\"]\n");
    const local = await save(app, "Notes.mmd", "flowchart LR\n  A[\"LOCALWORDX\"]\n");
    expect(local.status).toBe(200);
    const diverged = await request(app).post("/api/sync/now").set(json).send({});
    expect(diverged.status).toBe(200);
    expect(diverged.body.error.code).toBe("not_fast_forward");
    expect(diverged.body.error.message).toMatch(/did not force-push/i);
    expect(await headOf(bare)).toBe(remoteOid);
    expect(await blobAt(bare, "Notes.mmd")).toContain("REMOTEWORD");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toContain("LOCALWORDX");
  });

  it("reports rate limit, revoked auth, and a missing repository", async () => {
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    const configPath = path.join(dir, ".meta", "github-sync.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
    config.remoteUrl = "https://github.com/octocat/nerdgram-diagrams.git";
    await fs.writeFile(configPath, `${JSON.stringify(config)}\n`);

    setGithubFetch(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      return jsonResponse(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" });
    });
    const limited = await request(app).post("/api/sync/now").set(json).send({});
    expect(limited.body.error.code).toBe("rate_limit");

    setGithubFetch(async () => jsonResponse(401, { message: "Bad credentials" }));
    const revoked = await request(app).post("/api/sync/now").set(json).send({});
    expect(revoked.body.error.code).toBe("auth_revoked");
    expect(JSON.stringify(revoked.body)).not.toContain(TOKEN);

    setGithubFetch(async () => jsonResponse(404, { message: "Not Found" }));
    const missing = await request(app).post("/api/sync/now").set(json).send({});
    expect(missing.body.error.code).toBe("repo_missing");
  });

  it("pulls through the storage path, keeps locked edits, and refreshes search and thumbnails", async () => {
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    const alpha = "flowchart LR\n  A[\"ALPHAWORD\"]\n";
    const beta = "flowchart LR\n  A[\"BETAWORDX\"]\n";
    await fs.writeFile(path.join(dir, "Notes.mmd"), alpha);
    expect((await connect()).status).toBe(200);
    const key = thumbnailCacheKey(alpha);
    const thumb = await request(app)
      .put("/api/thumbnail")
      .set(json)
      .send({ path: "Notes.mmd", cacheKey: key, svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" });
    expect(thumb.status).toBe(200);
    const found = await request(app).get("/api/search").query({ q: "ALPHAWORD" }).set("Host", HOST);
    expect(found.body.hits.length).toBeGreaterThan(0);

    await fs.writeFile(path.join(dir, "Notes.mmd"), beta);
    const planted = await fs.stat(path.join(dir, "Notes.mmd"));
    const indexPath = path.join(dir, ".meta", "search", "index.json");
    const index = JSON.parse(await fs.readFile(indexPath, "utf8")) as {
      entries: Record<string, { mtimeMs: number; size: number }>;
    };
    index.entries["Notes.mmd"].mtimeMs = planted.mtimeMs;
    index.entries["Notes.mmd"].size = planted.size;
    await fs.writeFile(indexPath, JSON.stringify(index));
    discardSearchCache();
    const stale = await request(app).get("/api/search").query({ q: "ALPHAWORD" }).set("Host", HOST);
    expect(stale.body.hits.length).toBeGreaterThan(0);
    const betaBefore = await request(app).get("/api/search").query({ q: "BETAWORDX" }).set("Host", HOST);
    expect(betaBefore.body.hits).toEqual([]);
    await commitOnRemote(remoteUrl, "Notes.mmd", beta);

    const pulled = await request(app).post("/api/sync/pull").set(json).send({});
    expect(pulled.status).toBe(200);
    expect(pulled.body.conflicts).toEqual([]);
    const fresh = await request(app).get("/api/search").query({ q: "BETAWORDX" }).set("Host", HOST);
    expect(JSON.stringify(fresh.body)).toContain("BETAWORDX");
    const staleAfter = await request(app).get("/api/search").query({ q: "ALPHAWORD" }).set("Host", HOST);
    expect(staleAfter.body.hits).toEqual([]);
    await expect(
      fs.access(path.join(dir, ".meta", "thumbs", `${encodeStorageKey("Notes.mmd")}.json`)),
    ).rejects.toThrow();

    const history = await request(app).get("/api/history").query({ path: "Notes.mmd" }).set("Host", HOST);
    expect(history.status).toBe(200);

    const lockedAlpha = "flowchart LR\n  A[\"LOCKWORD1\"]\n";
    await save(app, "Notes.mmd", lockedAlpha);
    await request(app).post("/api/sync/now").set(json).send({});
    const lock = await request(app).post("/api/lock").set(json).send({ path: "Notes.mmd", sessionId: "editor-1" });
    expect(lock.status).toBe(200);
    await commitOnRemote(remoteUrl, "Notes.mmd", "flowchart LR\n  A[\"REMOTELOCK\"]\n");
    const blocked = await request(app).post("/api/sync/pull").set(json).send({});
    expect(blocked.status).toBe(200);
    expect(blocked.body.conflicts[0].locked).toBe(true);
    expect(blocked.body.conflicts[0].path).toBe("Notes.mmd");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe(lockedAlpha);
    const rejected = await request(app)
      .post("/api/sync/resolve")
      .set(json)
      .send({ choices: [{ path: "Notes.mmd", choice: "remote" }] });
    expect(rejected.status).toBe(423);
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe(lockedAlpha);

    await request(app).post("/api/lock/release").set(json).send({ path: "Notes.mmd", token: lock.body.token });
    const localEdit = "flowchart LR\n  A[\"UNSAVEDLOC\"]\n";
    await save(app, "Notes.mmd", localEdit);
    await commitOnRemote(remoteUrl, "Notes.mmd", "flowchart LR\n  A[\"OTHERREMOTE\"]\n");
    const beforeRemote = await headOf(bare);
    const conflicted = await request(app).post("/api/sync/pull").set(json).send({});
    expect(conflicted.body.conflicts.map((item: { path: string }) => item.path)).toContain("Notes.mmd");
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe(localEdit);
    expect(await headOf(bare)).toBe(beforeRemote);

    const kept = await request(app)
      .post("/api/sync/resolve")
      .set(json)
      .send({ choices: [{ path: "Notes.mmd", choice: "both" }] });
    expect(kept.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Notes.mmd"), "utf8")).toBe(localEdit);
    const copy = await fs.readFile(path.join(dir, "Notes (from GitHub).mmd"), "utf8");
    expect(copy).toContain("OTHERREMOTE");
    const messages = await logMessages(bare);
    expect(messages.some((message) => message.includes("Remote edit"))).toBe(true);
    expect(await headOf(bare)).not.toBe(beforeRemote);
  });

  it("does not push a commit after a clean pull", async () => {
    process.env.NERDGRAM_SYNC_WATCH = "1";
    process.env.NERDGRAM_SYNC_IDLE_MS = "150";
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    await fs.mkdir(path.join(dir, "Lab"), { recursive: true });
    await fs.writeFile(path.join(dir, "Lab", "E2ERenamed.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    const remoteContent = "flowchart LR\n  A-->RemoteOnly\n";
    const remoteCommit = await commitOnRemote(remoteUrl, "Lab/E2ERenamed.mmd", remoteContent);
    const pulled = await request(app).post("/api/sync/pull").set(json).send({});
    expect(pulled.status).toBe(200);
    expect(pulled.body.conflicts).toEqual([]);
    expect(await fs.readFile(path.join(dir, "Lab", "E2ERenamed.mmd"), "utf8")).toBe(remoteContent);
    await delay(700);
    await waitFor(async () => {
      const status = await request(app).get("/api/sync/status").set("Host", HOST);
      return status.body.pending === false && status.body.syncing === false;
    });
    expect(await headOf(bare)).toBe(remoteCommit);
    expect(await blobAt(bare, "Lab/E2ERenamed.mmd")).toBe(remoteContent);
    expect(await logMessages(bare)).not.toContain("Update Lab/E2ERenamed.mmd");
  });

  it("commits a real local edit after a pull", async () => {
    process.env.NERDGRAM_SYNC_WATCH = "1";
    process.env.NERDGRAM_SYNC_IDLE_MS = "150";
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    await fs.mkdir(path.join(dir, "Lab"), { recursive: true });
    await fs.writeFile(path.join(dir, "Lab", "E2ERenamed.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    const remoteContent = "flowchart LR\n  A-->RemoteOnly\n";
    const remoteCommit = await commitOnRemote(remoteUrl, "Lab/E2ERenamed.mmd", remoteContent);
    const pulled = await request(app).post("/api/sync/pull").set(json).send({});
    expect(pulled.status).toBe(200);
    expect(await headOf(bare)).toBe(remoteCommit);

    const edited = "flowchart LR\n  A-->LocalAfter\n";
    const saved = await save(app, "Lab/E2ERenamed.mmd", edited);
    expect(saved.status).toBe(200);
    await waitFor(async () => (await blobAt(bare, "Lab/E2ERenamed.mmd")) === edited, 4000);
    expect(await headOf(bare)).not.toBe(remoteCommit);
    const parent = (await git.readCommit({ fs: nodeFs, gitdir: bare, oid: (await headOf(bare)) || "" })).commit.parent[0];
    const parentTree = (await git.readCommit({ fs: nodeFs, gitdir: bare, oid: parent })).commit.tree;
    const headTree = (await git.readCommit({ fs: nodeFs, gitdir: bare, oid: (await headOf(bare)) || "" })).commit.tree;
    expect(headTree).not.toBe(parentTree);
  });

  it("does not create a commit whose tree matches its only parent", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-empty-commit-"));
    try {
      await git.init({ fs: nodeFs, dir: repo, defaultBranch: "main" });
      const file = path.join(repo, "Notes.mmd");
      const original = "flowchart LR\n  A-->B\n";
      await fs.writeFile(file, original);
      const first = await commitMirror(repo, "Initial");
      expect(first).toBeTruthy();
      await fs.writeFile(file, "flowchart LR\n  A-->Changed\n");
      await git.add({ fs: nodeFs, dir: repo, filepath: "Notes.mmd" });
      await fs.writeFile(file, original);
      const second = await commitMirror(repo, "Update Notes.mmd");
      expect(second).toBeNull();
      expect(await headOid(repo)).toBe(first);
      await fs.writeFile(file, "flowchart LR\n  A-->LocalAfter\n");
      const third = await commitMirror(repo, "Update Notes.mmd");
      expect(third).toBeTruthy();
      expect(third).not.toBe(first);
      const created = await git.readCommit({ fs: nodeFs, dir: repo, oid: third || "" });
      const parentCommit = await git.readCommit({ fs: nodeFs, dir: repo, oid: first || "" });
      expect(created.commit.tree).not.toBe(parentCommit.commit.tree);
      expect(created.commit.parent).toEqual([first]);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it("serializes overlapping sync requests", async () => {
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    let release: () => void = () => undefined;
    let entered = 0;
    setSyncTestHook(
      () =>
        new Promise<void>((resolve) => {
          entered += 1;
          release = resolve;
        }),
    );
    const first = request(app).post("/api/sync/now").set(json).send({});
    void Promise.resolve(first).catch(() => undefined);
    await waitFor(async () => entered === 1);
    const second = request(app).post("/api/sync/now").set(json).send({});
    void Promise.resolve(second).catch(() => undefined);
    await delay(80);
    expect(entered).toBe(1);
    expect(syncConcurrency().maxActive).toBe(1);
    release();
    await first;
    await waitFor(async () => entered === 2);
    expect(syncConcurrency().maxActive).toBe(1);
    release();
    const finished = await second;
    expect(finished.status).toBe(200);
    expect(syncConcurrency().maxActive).toBe(1);
  });

  it("runs reconciliation without a restart", async () => {
    process.env.NERDGRAM_SYNC_RECONCILE_MS = "200";
    remote = await startGitHttp();
    const bare = remote.bare;
    const remoteUrl = remote.url;
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  Watched-->Edit\n");
    await waitFor(async () => (await blobAt(bare, "Notes.mmd"))?.includes("Watched-->Edit") === true, 3000);
  });

  it("stores a device-flow refresh token only in the token file", async () => {
    setGithubFetch(async (input) => {
      const url = String(input);
      expect(url).not.toContain(REFRESH);
      if (url.includes("/login/device/code")) {
        return jsonResponse(200, {
          device_code: DEVICE_CODE,
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 0,
        });
      }
      if (url.includes("/login/oauth/access_token")) {
        return jsonResponse(200, {
          access_token: TOKEN,
          refresh_token: REFRESH,
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
          scope: "repo",
        });
      }
      if (url.endsWith("/user")) return jsonResponse(200, { login: "octocat" });
      return jsonResponse(404, { message: "not found" });
    });
    const saved = await request(app).post("/api/sync/client-id").set(json).send({ clientId: CLIENT_ID });
    expect(saved.status).toBe(200);
    const started = await request(app).post("/api/sync/device/start").set(json).send({});
    expect(started.status).toBe(200);
    await waitFor(async () => {
      const status = await request(app).get("/api/sync/status").set("Host", HOST);
      return status.body.tokenSource === "file";
    });
    const tokenFile = await fs.readFile(path.join(dir, ".meta", "github-token"), "utf8");
    const configFile = await fs.readFile(path.join(dir, ".meta", "github-sync.json"), "utf8");
    expect(tokenFile).toContain(REFRESH);
    expect(tokenFile).toContain(TOKEN);
    expect((await fs.stat(path.join(dir, ".meta", "github-token"))).mode & 0o777).toBe(0o600);
    expect(configFile).not.toContain(REFRESH);
    expect(configFile).not.toContain(TOKEN);
    const status = await request(app).get("/api/sync/status").set("Host", HOST);
    expect(JSON.stringify(status.body)).not.toContain(REFRESH);
    expect(JSON.stringify(status.body)).not.toContain(TOKEN);
  });

  it("classifies git HTTP 401 and 403 like REST authorization failures", () => {
    const denied = classifyNetworkError(
      Object.assign(new Error("HTTP Error: 401 Unauthorized"), {
        code: "HttpError",
        data: { statusCode: 401, statusMessage: "Unauthorized", response: "invalid credentials" },
      }),
    );
    expect(denied).toMatchObject({ code: "auth_revoked", status: 401 });
    expect(denied.message).toMatch(/Connect again/);
    const forbidden = classifyNetworkError(
      Object.assign(new Error("HTTP Error: 403 Forbidden"), {
        code: "HttpError",
        data: { statusCode: 403, statusMessage: "Forbidden", response: "" },
      }),
    );
    expect(forbidden).toMatchObject({ code: "auth_revoked", status: 403 });
    expect(forbidden.message).toMatch(/repository access/);
    expect(() => assertCleanRemoteUrl(`https://x-access-token:${TOKEN}@github.com/octocat/repo.git`)).toThrow(/token|password/i);
  });

  it("keeps a git HTTP 401 on connect in the status and the log, without secrets", async () => {
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    remote = await startGitHttp({ rejectStatus: 401 });
    installGithub(remote.url);
    await signIn();
    const connected = await request(app).post("/api/sync/connect").set(json).send({});
    expect(connected.status).toBe(401);
    expect(connected.body.code).toBe("auth_revoked");
    expect(connected.body.error).toMatch(/Connect again/);
    expect(connected.body.error).toMatch(/not on/i);
    expect(JSON.stringify(connected.body)).not.toContain(TOKEN);
    const status = await request(app).get("/api/sync/status").set("Host", HOST);
    expect(status.body.enabled).toBe(false);
    expect(status.body.error.code).toBe("auth_revoked");
    expect(status.body.error.message).toMatch(/Connect again/);
    expect(JSON.stringify(status.body)).not.toContain(TOKEN);
    const logged = logs.errors.join("\n");
    expect(logged).toMatch(/GitHub sync: auth_revoked /);
    expect(logged).toMatch(/Connect again/);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toMatch(/Bearer |Basic |x-access-token:/);
  });

  it("reads a legacy token file and refuses to store a refresh token in sync settings", async () => {
    await writeToken(TOKEN);
    expect(await readToken()).toEqual({ token: TOKEN, source: "file" });
    const plain = await fs.readFile(path.join(dir, ".meta", "github-token"), "utf8");
    expect(plain.trim()).toBe(TOKEN);
    const stat = await fs.stat(path.join(dir, ".meta", "github-token"));
    expect(stat.mode & 0o777).toBe(0o600);
    const config = emptyConfig();
    config.login = REFRESH;
    await expect(saveConfig(config)).rejects.toThrow(/token/i);
  });

  it("refreshes a device-flow token before it expires without a client secret", async () => {
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    await writeToken(TOKEN, {
      refreshToken: REFRESH,
      expiresIn: 30,
      refreshExpiresIn: 15897600,
      deviceFlow: true,
    });
    remote?.requests.splice(0, remote.requests.length);
    let refreshes = 0;
    setGithubFetch(async (input, init) => {
      const url = String(input);
      expect(url).not.toContain(TOKEN);
      expect(url).not.toContain(REFRESH);
      expect(url).not.toContain(NEXT);
      if (url.includes("/login/oauth/access_token")) {
        refreshes += 1;
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body.grant_type).toBe("refresh_token");
        expect(body.client_id).toBe(CLIENT_ID);
        expect(body.refresh_token).toBe(REFRESH);
        expect(body.client_secret).toBeUndefined();
        return jsonResponse(200, {
          access_token: NEXT,
          refresh_token: REFRESH_NEXT,
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
        });
      }
      const authorization = new Headers(init?.headers).get("authorization");
      expect(authorization).toBe(`Bearer ${NEXT}`);
      return jsonResponse(200, repoPayload(remote?.url ?? ""));
    });
    const synced = await request(app).post("/api/sync/now").set(json).send({});
    expect(synced.status).toBe(200);
    expect(synced.body.error).toBeNull();
    expect(refreshes).toBe(1);
    const basic = `Basic ${Buffer.from(`x-access-token:${NEXT}`, "utf8").toString("base64")}`;
    expect(remote?.requests.some((hit) => hit.authorization === basic)).toBe(true);
    expect(remote?.requests.every((hit) => !hit.authorization.includes(TOKEN) && !hit.url.includes(NEXT))).toBe(true);
    const tokenFile = await fs.readFile(path.join(dir, ".meta", "github-token"), "utf8");
    expect(tokenFile).toContain(NEXT);
    expect(tokenFile).toContain(REFRESH_NEXT);
    expect(tokenFile).not.toContain(REFRESH);
    expect((await fs.stat(path.join(dir, ".meta", "github-token"))).mode & 0o777).toBe(0o600);
    const storedConfig = await fs.readFile(path.join(dir, ".meta", "github-sync.json"), "utf8");
    expect(storedConfig).not.toContain(NEXT);
    expect(storedConfig).not.toContain(REFRESH_NEXT);
    expect(storedConfig).not.toContain(TOKEN);
    const logged = logs.errors.join("\n") + logs.logs.join("\n");
    expect(logged).not.toContain(NEXT);
    expect(logged).not.toContain(REFRESH);
    expect(logged).not.toContain(REFRESH_NEXT);
  });

  it("sends the client secret only when a non-device refresh token needs one", async () => {
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    process.env.NERDGRAM_GITHUB_CLIENT_SECRET = CLIENT_SECRET;
    await writeToken(TOKEN, {
      refreshToken: REFRESH,
      expiresIn: -10,
      refreshExpiresIn: 15897600,
      deviceFlow: false,
    });
    setGithubFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/login/oauth/access_token")) {
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body.client_secret).toBe(CLIENT_SECRET);
        expect(body.grant_type).toBe("refresh_token");
        return jsonResponse(200, {
          access_token: NEXT,
          refresh_token: REFRESH_NEXT,
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
        });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${NEXT}`);
      return jsonResponse(200, repoPayload(remote?.url ?? ""));
    });
    const synced = await request(app).post("/api/sync/now").set(json).send({});
    expect(synced.status).toBe(200);
    expect(synced.body.error).toBeNull();
    const logged = logs.errors.join("\n") + logs.logs.join("\n");
    expect(logged).not.toContain(CLIENT_SECRET);
    expect(logged).not.toContain(REFRESH);
    expect(logged).not.toContain(NEXT);
  });

  it("asks to connect again when a refresh fails", async () => {
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    await writeToken(TOKEN, {
      refreshToken: REFRESH,
      expiresIn: -10,
      refreshExpiresIn: 15897600,
      deviceFlow: true,
    });
    let refreshes = 0;
    setGithubFetch(async (input) => {
      const url = String(input);
      expect(url).not.toContain(REFRESH);
      if (url.includes("/login/oauth/access_token")) {
        refreshes += 1;
        return jsonResponse(200, { error: "bad_refresh_token", error_description: "expired" });
      }
      return jsonResponse(401, { message: "Bad credentials" });
    });
    const synced = await request(app).post("/api/sync/now").set(json).send({});
    expect(synced.status).toBe(200);
    expect(synced.body.error.code).toBe("auth_expired");
    expect(synced.body.error.message).toMatch(/authorization expired/i);
    expect(synced.body.error.message).toMatch(/Connect again/);
    expect(refreshes).toBe(1);
    const status = await request(app).get("/api/sync/status").set("Host", HOST);
    expect(status.body.error.code).toBe("auth_expired");
    const logged = logs.errors.join("\n");
    expect(logged).toMatch(/GitHub sync: auth_expired /);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(REFRESH);
    expect(JSON.stringify(synced.body)).not.toContain(REFRESH);
  });

  it("asks to connect again when a non-device token has no client secret", async () => {
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    delete process.env.NERDGRAM_GITHUB_CLIENT_SECRET;
    await writeToken(TOKEN, {
      refreshToken: REFRESH,
      expiresIn: -10,
      refreshExpiresIn: 15897600,
      deviceFlow: false,
    });
    let calls = 0;
    setGithubFetch(async () => {
      calls += 1;
      return jsonResponse(500, { message: "should not be called" });
    });
    const status = await request(app).get("/api/sync/status").set("Host", HOST);
    expect(status.body.error.code).toBe("auth_expired");
    expect(status.body.error.message).toMatch(/authorization expired/i);
    expect(status.body.error.message).toMatch(/Connect again/);
    const synced = await request(app).post("/api/sync/now").set(json).send({});
    expect(synced.body.error.code).toBe("auth_expired");
    expect(calls).toBe(0);
    const logged = logs.errors.join("\n") + JSON.stringify(synced.body);
    expect(logged).not.toContain(REFRESH);
    expect(logged).not.toContain(TOKEN);
  });

  it("retries one GitHub 401 after a refresh and does not refresh again", async () => {
    await fs.writeFile(path.join(dir, "Notes.mmd"), "flowchart LR\n  A-->B\n");
    expect((await connect()).status).toBe(200);
    await writeToken(TOKEN, {
      refreshToken: REFRESH,
      expiresIn: 28800,
      refreshExpiresIn: 15897600,
      deviceFlow: true,
    });
    let refreshes = 0;
    let repoGets = 0;
    setGithubFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/login/oauth/access_token")) {
        refreshes += 1;
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body.client_secret).toBeUndefined();
        return jsonResponse(200, {
          access_token: NEXT,
          refresh_token: REFRESH_NEXT,
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
        });
      }
      repoGets += 1;
      return jsonResponse(401, { message: "Bad credentials" });
    });
    const synced = await request(app).post("/api/sync/now").set(json).send({});
    expect(refreshes).toBe(1);
    expect(repoGets).toBe(2);
    expect(synced.body.error.code).toBe("auth_revoked");
    expect(synced.body.error.message).toMatch(/Connect again/);
    const logged = logs.errors.join("\n");
    expect(logged).not.toContain(NEXT);
    expect(logged).not.toContain(REFRESH_NEXT);
  });
});

const REFRESH = "ghr_OLDREFRESHTOKENVALUE123456789";
const REFRESH_NEXT = "ghr_NEWREFRESHTOKENVALUE123456789";
const NEXT = "gho_NEWACCESSTOKENVALUE123456789";
const CLIENT_SECRET = "oauth-client-secret-value-123456";

async function save(app: ReturnType<typeof makeApp>, filePath: string, content: string) {
  const current = await request(app).get("/api/file").query({ path: filePath }).set("Host", HOST);
  return request(app)
    .put("/api/file")
    .set(json)
    .send({
      path: filePath,
      content,
      expectedHash: current.status === 200 ? current.body.hash : undefined,
    });
}

async function seedBare(bare: string, filepath: string, content: string): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-seed-"));
  try {
    await git.init({ fs: nodeFs, dir, defaultBranch: "main" });
    await fs.writeFile(path.join(dir, filepath), content);
    await git.add({ fs: nodeFs, dir, filepath });
    await git.commit({
      fs: nodeFs,
      dir,
      message: "Seed existing",
      author: { name: "Remote", email: "remote@example.com" },
    });
    await git.addRemote({ fs: nodeFs, dir, remote: "origin", url: bare });
    const result = await git.push({
      fs: nodeFs,
      http: gitHttp,
      dir,
      remote: "origin",
      ref: "main",
      remoteRef: "main",
      force: false,
    });
    expect(result.ok).toBe(true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
