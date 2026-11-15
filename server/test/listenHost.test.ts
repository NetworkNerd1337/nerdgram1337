import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { saveDataDir } from "../src/dataDir.js";
import {
  clearInstanceIdentityCache,
  instanceFilePath,
  readInstanceListenHost,
  resetStartupDataDirForTests,
  setExternalDataDirForTests,
} from "../src/instanceConfig.js";
import {
  DEFAULT_LISTEN_HOST,
  describeListenHost,
  hostRestartNotice,
  hostsFromListenAddress,
  isWildcardBind,
  listNonLoopbackInterfaceAddresses,
  listenHostPath,
  mergeAllowedHosts,
  parseListenHostInput,
  readSavedListenHost,
  resolveEffectiveBind,
  writeSavedListenHost,
} from "../src/listenHost.js";
import { getDataRoot } from "../src/paths.js";
import { closeServers, startServer } from "../src/listen.js";
import { buildAllowedHostnames, buildAllowedOrigins, isAllowedHostHeader } from "../src/security.js";
import { captureConsole, makeTempDataDir } from "./helpers.js";

const HOST_HEADER = "127.0.0.1:8787";

const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
  lo: [
    {
      address: "127.0.0.1",
      netmask: "255.0.0.0",
      family: "IPv4",
      mac: "00:00:00:00:00:00",
      internal: true,
      cidr: "127.0.0.1/8",
    },
    {
      address: "::1",
      netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      family: "IPv6",
      mac: "00:00:00:00:00:00",
      internal: true,
      cidr: "::1/128",
      scopeid: 0,
    },
  ],
  eth0: [
    {
      address: "192.168.1.10",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "02:00:00:00:00:01",
      internal: false,
      cidr: "192.168.1.10/24",
    },
    {
      address: "fe80::1%eth0",
      netmask: "ffff:ffff:ffff:ffff::",
      family: "IPv6",
      mac: "02:00:00:00:00:01",
      internal: false,
      cidr: "fe80::1/64",
      scopeid: 2,
    },
    {
      address: "192.168.1.10",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "02:00:00:00:00:01",
      internal: false,
      cidr: "192.168.1.10/24",
    },
  ],
};

describe("parseListenHostInput", () => {
  it("accepts IPv4, IPv6, wildcards, and bracketed IPv6", () => {
    expect(parseListenHostInput("127.0.0.1")).toEqual({ ok: true, host: "127.0.0.1" });
    expect(parseListenHostInput(" 192.168.1.10 ")).toEqual({ ok: true, host: "192.168.1.10" });
    expect(parseListenHostInput("0.0.0.0")).toEqual({ ok: true, host: "0.0.0.0" });
    expect(parseListenHostInput("::")).toEqual({ ok: true, host: "::" });
    expect(parseListenHostInput("[::1]")).toEqual({ ok: true, host: "::1" });
    expect(parseListenHostInput("2001:DB8::1")).toEqual({ ok: true, host: "2001:db8::1" });
  });

  it("rejects hostnames, ports, and empty input", () => {
    for (const value of ["localhost", "diagrams.local", "192.168.1.10:8787", "", "   ", "127.0.0.01", "*"]) {
      const parsed = parseListenHostInput(value);
      expect(parsed.ok).toBe(false);
    }
    expect(parseListenHostInput(8787).ok).toBe(false);
  });
});

describe("resolveEffectiveBind", () => {
  it("keeps today's loopback pair when nothing is saved and HOST is unset", () => {
    expect(resolveEffectiveBind({ envHost: undefined, savedHost: null })).toEqual({
      hosts: ["127.0.0.1", "::1"],
      source: "default",
      envOverrides: false,
    });
    expect(resolveEffectiveBind({ envHost: "  ", savedHost: DEFAULT_LISTEN_HOST })).toEqual({
      hosts: ["127.0.0.1", "::1"],
      source: "default",
      envOverrides: false,
    });
  });

  it("lets a set HOST win over the saved setting", () => {
    expect(resolveEffectiveBind({ envHost: "0.0.0.0", savedHost: "192.168.1.10" })).toEqual({
      hosts: ["0.0.0.0"],
      source: "env",
      envOverrides: true,
    });
  });

  it("binds a saved address other than 127.0.0.1", () => {
    expect(resolveEffectiveBind({ envHost: undefined, savedHost: "192.168.1.10" }).hosts).toEqual([
      "192.168.1.10",
    ]);
    expect(resolveEffectiveBind({ envHost: undefined, savedHost: "::1" }).hosts).toEqual(["::1"]);
  });
});

describe("hostRestartNotice", () => {
  it("appears only while the saved host differs from the host this process started with", () => {
    expect(hostRestartNotice(null, "127.0.0.1")).toBe(false);
    expect(hostRestartNotice("127.0.0.1", "127.0.0.1")).toBe(false);
    expect(hostRestartNotice("0.0.0.0", "127.0.0.1")).toBe(true);
    expect(hostRestartNotice("0.0.0.0", "0.0.0.0")).toBe(false);
    expect(hostRestartNotice("::", "127.0.0.1")).toBe(true);
    expect(hostRestartNotice("::", "::")).toBe(false);
    expect(hostRestartNotice("192.168.1.10", "127.0.0.1")).toBe(true);
    expect(hostRestartNotice("192.168.1.10", "192.168.1.10")).toBe(false);
    expect(hostRestartNotice("::1", "::1")).toBe(false);
    expect(hostRestartNotice("192.168.1.10", "0.0.0.0")).toBe(true);
  });
});

describe("allowed hosts from the bind", () => {
  it("discovers non-loopback interface addresses and drops zone ids", () => {
    expect(listNonLoopbackInterfaceAddresses(interfaces)).toEqual(["192.168.1.10", "fe80::1"]);
  });

  it("allows a specific IP, including IP:port, and merges NERDGRAM_ALLOWED_HOSTS", () => {
    const fromBind = hostsFromListenAddress(["192.168.1.10"], []);
    const merged = mergeAllowedHosts(fromBind, ["diagrams.local", "*", "0.0.0.0", "192.168.1.10"]);
    expect(merged).toEqual(["192.168.1.10", "diagrams.local"]);
    const names = buildAllowedHostnames(["192.168.1.10"], merged);
    const ports = new Set(["8787"]);
    expect(isAllowedHostHeader("192.168.1.10:8787", names, ports)).toBe(true);
    expect(isAllowedHostHeader("192.168.1.10", names, ports)).toBe(true);
    expect(isAllowedHostHeader("diagrams.local:8787", names, ports)).toBe(true);
    expect(isAllowedHostHeader("127.0.0.1:8787", names, ports)).toBe(true);
    expect(isAllowedHostHeader("10.0.0.8:8787", names, ports)).toBe(false);
    expect(names.has("0.0.0.0")).toBe(false);
    expect(names.has("*")).toBe(false);
  });

  it("allows discovered interface IPs for 0.0.0.0 and ::, and not the wildcard itself", () => {
    expect(isWildcardBind("0.0.0.0")).toBe(true);
    expect(isWildcardBind("::")).toBe(true);
    const discovered = listNonLoopbackInterfaceAddresses(interfaces);
    const fromBind = hostsFromListenAddress(["0.0.0.0"], discovered);
    expect(fromBind).toEqual(["192.168.1.10", "fe80::1"]);
    const merged = mergeAllowedHosts(fromBind, ["lab.home"]);
    expect(merged).toEqual(["192.168.1.10", "fe80::1", "lab.home"]);
    const names = buildAllowedHostnames(["0.0.0.0"], merged);
    const ports = new Set(["8787"]);
    expect(names.has("0.0.0.0")).toBe(false);
    expect(isAllowedHostHeader("192.168.1.10:8787", names, ports)).toBe(true);
    expect(isAllowedHostHeader("[fe80::1]:8787", names, ports)).toBe(true);
    expect(isAllowedHostHeader("lab.home:8787", names, ports)).toBe(true);
    expect(isAllowedHostHeader("localhost:8787", names, ports)).toBe(true);
    expect(isAllowedHostHeader("evil.example:8787", names, ports)).toBe(false);
    expect(hostsFromListenAddress(["::"], discovered)).toEqual(["192.168.1.10", "fe80::1"]);
  });

  it("adds an origin for a non-loopback address and leaves the default list unchanged", () => {
    const plain = buildAllowedOrigins({ mode: "production", port: 8787 });
    expect(plain.has("http://192.168.1.10:8787")).toBe(false);
    const opened = buildAllowedOrigins({
      mode: "production",
      port: 8787,
      extraHosts: ["192.168.1.10", "fe80::1"],
    });
    expect(opened.has("http://192.168.1.10:8787")).toBe(true);
    expect(opened.has("http://[fe80::1]:8787")).toBe(true);
    expect(opened.has("http://127.0.0.1:8787")).toBe(true);
  });
});

describe("listen host file and API", () => {
  let cleanup = async () => {};
  let instanceCleanup = async () => {};
  const previousInstall = process.env.NERDGRAM_INSTALL;

  beforeEach(async () => {
    instanceCleanup = await isolateInstanceFile();
  });

  afterEach(async () => {
    await cleanup();
    cleanup = async () => {};
    await instanceCleanup();
    instanceCleanup = async () => {};
    setExternalDataDirForTests(undefined);
    resetStartupDataDirForTests();
    if (previousInstall === undefined) delete process.env.NERDGRAM_INSTALL;
    else process.env.NERDGRAM_INSTALL = previousInstall;
  });

  it("persists under .meta and reports the restart notice from the saved value", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const app = createApp({ mode: "production", port: 8787 });

    const initial = await request(app).get("/api/host").set("Host", HOST_HEADER);
    expect(initial.status).toBe(200);
    expect(initial.body.saved).toBe("127.0.0.1");
    expect(initial.body.persisted).toBe(false);
    expect(initial.body.restartNotice).toBe(false);
    expect(initial.body.effectiveHosts).toEqual(["127.0.0.1", "::1"]);
    expect(initial.body.readOnly).toBe(false);

    const rejected = await request(app)
      .post("/api/host")
      .set("Host", HOST_HEADER)
      .set("Content-Type", "application/json")
      .send({ host: "diagrams.local" });
    expect(rejected.status).toBe(400);

    const saved = await request(app)
      .post("/api/host")
      .set("Host", HOST_HEADER)
      .set("Content-Type", "application/json")
      .send({ host: "192.168.1.10" });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toBe("192.168.1.10");
    expect(saved.body.persisted).toBe(true);
    expect(saved.body.restartNotice).toBe(true);
    expect(saved.body.effectiveHosts).toEqual(["127.0.0.1", "::1"]);

    const file = JSON.parse(await fs.readFile(instanceFilePath(), "utf8")) as { listenHost?: string };
    expect(file.listenHost).toBe("192.168.1.10");
    expect(instanceFilePath()).not.toBe(path.join(temp.dir, ".meta", "listen-host.json"));
    await expect(fs.access(path.join(temp.dir, ".meta", "listen-host.json"))).rejects.toThrow();

    const again = await readSavedListenHost();
    expect(again).toEqual({ persisted: true, host: "192.168.1.10", invalid: false });

    const back = await request(app)
      .post("/api/host")
      .set("Host", HOST_HEADER)
      .set("Content-Type", "application/json")
      .send({ host: "[::1]" });
    expect(back.body.saved).toBe("::1");
    expect(back.body.restartNotice).toBe(true);

    const cleared = await request(app)
      .post("/api/host")
      .set("Host", HOST_HEADER)
      .set("Content-Type", "application/json")
      .send({ host: "127.0.0.1" });
    expect(cleared.body.restartNotice).toBe(false);
    expect(cleared.body.saved).toBe("127.0.0.1");
    expect(cleared.body.running).toBe("127.0.0.1");
  });

  it("hides the restart notice once the process is bound to the saved host", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const previous = process.env.HOST;
    delete process.env.HOST;
    try {
      await writeSavedListenHost("0.0.0.0");
      const pending = createApp({ mode: "production", port: 8787 });
      const before = await request(pending).get("/api/host").set("Host", HOST_HEADER);
      expect(before.body.saved).toBe("0.0.0.0");
      expect(before.body.running).toBe("127.0.0.1");
      expect(before.body.restartNotice).toBe(true);

      const restarted = createApp({ mode: "production", port: 8787, bindHosts: ["0.0.0.0"] });
      const after = await request(restarted).get("/api/host").set("Host", HOST_HEADER);
      expect(after.body.saved).toBe("0.0.0.0");
      expect(after.body.running).toBe("0.0.0.0");
      expect(after.body.restartNotice).toBe(false);
      expect(after.body.envOverrides).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it("does not ask for a restart when HOST already matches the saved host", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const previous = process.env.HOST;
    process.env.HOST = "0.0.0.0";
    try {
      await writeSavedListenHost("0.0.0.0");
      const app = createApp({ mode: "production", port: 8787, bindHosts: ["0.0.0.0"] });
      const status = await request(app).get("/api/host").set("Host", HOST_HEADER);
      expect(status.body.envOverrides).toBe(true);
      expect(status.body.envHost).toBe("0.0.0.0");
      expect(status.body.saved).toBe("0.0.0.0");
      expect(status.body.running).toBe("0.0.0.0");
      expect(status.body.restartNotice).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it("refuses to save in Docker and shows the env override", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    process.env.NERDGRAM_INSTALL = "docker";
    const previousHost = process.env.HOST;
    process.env.HOST = "0.0.0.0";
    try {
      const app = createApp({
        mode: "production",
        port: 8787,
        bindHosts: ["0.0.0.0"],
        allowedOriginHosts: ["192.168.1.10"],
        allowedHosts: mergeAllowedHosts(["192.168.1.10"], ["lab.home"]),
      });
      const status = await request(app).get("/api/host").set("Host", HOST_HEADER);
      expect(status.body.docker).toBe(true);
      expect(status.body.readOnly).toBe(true);
      expect(status.body.envOverrides).toBe(true);
      expect(status.body.envHost).toBe("0.0.0.0");
      expect(status.body.effectiveHosts).toEqual(["0.0.0.0"]);

      const denied = await request(app)
        .post("/api/host")
        .set("Host", HOST_HEADER)
        .set("Content-Type", "application/json")
        .send({ host: "192.168.1.10" });
      expect(denied.status).toBe(409);
      expect(await readSavedListenHost()).toEqual({ persisted: false, host: null, invalid: false });

      const lan = await request(app).get("/api/health").set("Host", "192.168.1.10:8787");
      expect(lan.status).toBe(200);
      const named = await request(app).get("/api/health").set("Host", "lab.home:8787");
      expect(named.status).toBe(200);
      const foreign = await request(app).get("/api/health").set("Host", "evil.example:8787");
      expect(foreign.status).toBe(403);

      const origin = await request(app)
        .post("/api/host")
        .set("Host", "192.168.1.10:8787")
        .set("Origin", "http://192.168.1.10:8787")
        .set("Content-Type", "application/json")
        .send({ host: "10.1.1.1" });
      expect(origin.status).toBe(409);
    } finally {
      if (previousHost === undefined) delete process.env.HOST;
      else process.env.HOST = previousHost;
    }
  });

  it("copies a legacy listen-host.json once and then ignores it", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const legacy = path.join(temp.dir, ".meta", "listen-host.json");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, `${JSON.stringify({ host: "192.168.4.4" })}\n`, "utf8");

    const migrated = await readSavedListenHost();
    expect(migrated).toEqual({ persisted: true, host: "192.168.4.4", invalid: false });
    expect(readInstanceListenHost()).toEqual({ present: true, value: "192.168.4.4" });
    expect(await fs.readFile(legacy, "utf8")).toContain("192.168.4.4");

    await fs.writeFile(legacy, `${JSON.stringify({ host: "10.1.1.1" })}\n`, "utf8");
    expect(await readSavedListenHost()).toEqual({ persisted: true, host: "192.168.4.4", invalid: false });
  });

  it("does not copy a legacy file when the instance config already has a Host", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    await writeSavedListenHost("127.0.0.8");
    const legacy = path.join(temp.dir, ".meta", "listen-host.json");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, `${JSON.stringify({ host: "10.2.2.2" })}\n`, "utf8");
    expect(await readSavedListenHost()).toEqual({ persisted: true, host: "127.0.0.8", invalid: false });
    expect(await fs.readFile(legacy, "utf8")).toContain("10.2.2.2");
  });
});

describe("startServer uses the saved host", () => {
  const servers: Server[] = [];
  let cleanup = async () => {};
  let instanceCleanup = async () => {};

  beforeEach(async () => {
    instanceCleanup = await isolateInstanceFile();
  });

  afterEach(async () => {
    await closeServers(servers);
    servers.length = 0;
    await cleanup();
    cleanup = async () => {};
    await instanceCleanup();
    instanceCleanup = async () => {};
    setExternalDataDirForTests(undefined);
    resetStartupDataDirForTests();
  });

  async function listen(options: Parameters<typeof startServer>[0] = {}) {
    const started = await startServer({ port: 0, mode: "production", ...options });
    servers.push(...started);
    return started;
  }

  it("binds the default pair when the file is missing", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const previous = process.env.HOST;
    delete process.env.HOST;
    const captured = captureConsole();
    try {
      const started = await listen();
      const addresses = started.map((server) => (server.address() as AddressInfo).address);
      expect(addresses).toContain("127.0.0.1");
      expect(addresses).not.toContain("0.0.0.0");
      expect(captured.logs.join("\n")).toMatch(/Listen host: 127\.0\.0\.1, ::1 \(default\)/);
    } finally {
      captured.restore();
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it("binds a saved address and still allows loopback Host names", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const previous = process.env.HOST;
    delete process.env.HOST;
    await writeSavedListenHost("127.0.0.2");
    const captured = captureConsole();
    try {
      const started = await listen();
      expect(started).toHaveLength(1);
      const address = started[0].address() as AddressInfo;
      expect(address.address).toBe("127.0.0.2");
      const status = await httpStatus(address.port, `127.0.0.2:${address.port}`, "127.0.0.2");
      expect(status).toBe(200);
      expect(await httpStatus(address.port, `127.0.0.1:${address.port}`, "127.0.0.2")).toBe(200);
      expect(await httpStatus(address.port, `evil.example:${address.port}`, "127.0.0.2")).toBe(403);
      expect(await canConnect("127.0.0.1", address.port)).toBe(false);
      expect(captured.logs.join("\n")).toMatch(/saved Host setting/);
    } finally {
      captured.restore();
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it("lets HOST override a saved wildcard and still merges configured names", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const previousHost = process.env.HOST;
    const previousAllowed = process.env.NERDGRAM_ALLOWED_HOSTS;
    process.env.HOST = "127.0.0.1";
    process.env.NERDGRAM_ALLOWED_HOSTS = "lab.home";
    await writeSavedListenHost("0.0.0.0");
    const captured = captureConsole();
    try {
      const started = await listen();
      expect(started).toHaveLength(1);
      const address = started[0].address() as AddressInfo;
      expect(address.address).toBe("127.0.0.1");
      expect(await httpStatus(address.port, `lab.home:${address.port}`)).toBe(200);
      expect(captured.logs.join("\n")).toMatch(/HOST=127\.0\.0\.1/);
      expect(captured.logs.join("\n")).toMatch(/overrides the saved Host setting 0\.0\.0\.0/);
      const described = describeListenHost({
        envHost: "127.0.0.1",
        saved: { persisted: true, host: "0.0.0.0", invalid: false },
        boundHosts: ["127.0.0.1"],
        docker: false,
      });
      expect(described.envOverrides).toBe(true);
      expect(described.restartNotice).toBe(true);
    } finally {
      captured.restore();
      if (previousHost === undefined) delete process.env.HOST;
      else process.env.HOST = previousHost;
      if (previousAllowed === undefined) delete process.env.NERDGRAM_ALLOWED_HOSTS;
      else process.env.NERDGRAM_ALLOWED_HOSTS = previousAllowed;
    }
  });

  it("binds 0.0.0.0 from the saved setting and accepts a discovered interface address", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const previous = process.env.HOST;
    delete process.env.HOST;
    await writeSavedListenHost("0.0.0.0");
    const captured = captureConsole();
    try {
      const started = await listen();
      const address = started[0].address() as AddressInfo;
      expect(address.address).toBe("0.0.0.0");
      expect(await httpStatus(address.port, `127.0.0.1:${address.port}`)).toBe(200);
      expect(await httpStatus(address.port, `evil.example:${address.port}`)).toBe(403);
      const lan = listNonLoopbackInterfaceAddresses().find((item) => item.includes(".") && !item.includes(":"));
      if (lan) {
        expect(await httpStatus(address.port, `${lan}:${address.port}`)).toBe(200);
      }
      expect(captured.errors.join("\n")).toMatch(/tool port/);
      expect(captured.errors.join("\n")).not.toMatch(/UNSUPPORTED/);
    } finally {
      captured.restore();
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it("ignores an invalid saved file and keeps the default bind", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const previous = process.env.HOST;
    delete process.env.HOST;
    await fs.mkdir(`${temp.dir}/.meta`, { recursive: true });
    await fs.writeFile(`${temp.dir}/.meta/listen-host.json`, "{", "utf8");
    const captured = captureConsole();
    try {
      const started = await listen();
      const addresses = started.map((server) => (server.address() as AddressInfo).address);
      expect(addresses).toContain("127.0.0.1");
      expect(captured.errors.join("\n")).toMatch(/not a valid address/);
      expect(await readSavedListenHost()).toMatchObject({ invalid: true, host: null });
      expect(readInstanceListenHost().present).toBe(false);
    } finally {
      captured.restore();
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it("applies a saved Host and a saved Diagram folder on one restart", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const next = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-next-diagrams-"));
    const previousHost = process.env.HOST;
    delete process.env.HOST;
    setExternalDataDirForTests(undefined);
    resetStartupDataDirForTests();
    const captured = captureConsole();
    try {
      const app = createApp({ mode: "production", port: 8787 });
      const savedHost = await request(app)
        .post("/api/host")
        .set("Host", HOST_HEADER)
        .set("Content-Type", "application/json")
        .send({ host: "127.0.0.2" });
      expect(savedHost.status).toBe(200);
      expect(savedHost.body.restartNotice).toBe(true);
      const savedDir = await saveDataDir(next);
      expect(savedDir.restartNotice).toBe(true);
      expect(savedDir.saved).toBe(next);
      expect(savedDir.running).toBe(temp.dir);

      const stored = JSON.parse(await fs.readFile(instanceFilePath(), "utf8")) as {
        listenHost?: string;
        NERDGRAM_DATA_DIR?: string;
      };
      expect(stored.listenHost).toBe("127.0.0.2");
      expect(stored.NERDGRAM_DATA_DIR).toBe(next);
      await expect(fs.access(path.join(temp.dir, ".meta", "listen-host.json"))).rejects.toThrow();

      delete process.env.NERDGRAM_DATA_DIR;
      resetStartupDataDirForTests();
      clearInstanceIdentityCache();
      const started = await listen();
      expect(getDataRoot()).toBe(next);
      expect(started).toHaveLength(1);
      const address = started[0].address() as AddressInfo;
      expect(address.address).toBe("127.0.0.2");
      expect(await readSavedListenHost()).toEqual({ persisted: true, host: "127.0.0.2", invalid: false });
      const restarted = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.2"] });
      const after = await request(restarted).get("/api/host").set("Host", "127.0.0.2:8787");
      expect(after.body.saved).toBe("127.0.0.2");
      expect(after.body.running).toBe("127.0.0.2");
      expect(after.body.restartNotice).toBe(false);
      expect(captured.logs.join("\n")).toContain(`Data directory: ${next}`);
      await expect(fs.access(path.join(next, ".meta", "listen-host.json"))).rejects.toThrow();
    } finally {
      captured.restore();
      await fs.rm(next, { recursive: true, force: true });
      if (previousHost === undefined) delete process.env.HOST;
      else process.env.HOST = previousHost;
    }
  });
});

async function isolateInstanceFile(): Promise<() => Promise<void>> {
  const previous = process.env.NERDGRAM_INSTANCE_FILE;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-host-instance-"));
  process.env.NERDGRAM_INSTANCE_FILE = path.join(dir, "instance.json");
  clearInstanceIdentityCache();
  return async () => {
    clearInstanceIdentityCache();
    if (previous === undefined) delete process.env.NERDGRAM_INSTANCE_FILE;
    else process.env.NERDGRAM_INSTANCE_FILE = previous;
    await fs.rm(dir, { recursive: true, force: true });
  };
}

function httpStatus(port: number, hostHeader: string, connectHost = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: connectHost, port, path: "/api/health", method: "GET", headers: { Host: hostHeader } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = http.request({ host, port, path: "/api/health", method: "GET" });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("response", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.end();
  });
}
