import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { escapeHtml, forbiddenHostCopy, renderForbiddenHostPage } from "../src/forbiddenHostPage.js";
import { makeTempDataDir } from "./helpers.js";

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1"],
    allowedHosts: [],
  });
}

describe("forbidden host page", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    delete process.env.NERDGRAM_INSTALL;
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("escapes the host and splits the port", () => {
    expect(escapeHtml(`172.16.10.228:8787"><script>`)).toBe(
      "172.16.10.228:8787&quot;&gt;&lt;script&gt;",
    );
    const copy = forbiddenHostCopy("172.16.10.228:8787", 9);
    expect(copy.name).toBe("172.16.10.228");
    expect(copy.port).toBe(8787);
    expect(copy.origin).toBe("http://172.16.10.228:8787");
    expect(forbiddenHostCopy("[fe80::1]:8787", 9).origin).toBe("http://[fe80::1]:8787");
    expect(forbiddenHostCopy("not a host", 8787).name).toBeNull();
  });

  it("uses Docker copy or Node copy, and never the other", () => {
    const docker = renderForbiddenHostPage({
      hostHeader: "172.16.10.228:8787",
      port: 8787,
      docker: true,
    });
    expect(docker).toContain("NerdGram blocked this address");
    expect(docker).toContain("NERDGRAM_ALLOWED_HOSTS: &quot;172.16.10.228&quot;");
    expect(docker).toContain("NERDGRAM_CORS_ORIGINS: &quot;http://172.16.10.228:8787&quot;");
    expect(docker).toContain("docker compose up -d");
    expect(docker).toContain("cannot see the host");
    expect(docker).toContain("There is no login");
    expect(docker).not.toContain("settings#host");

    const node = renderForbiddenHostPage({
      hostHeader: "172.16.10.228:8787",
      port: 8787,
      docker: false,
    });
    expect(node).toContain("save");
    expect(node).toContain("172.16.10.228");
    expect(node).toContain("http://127.0.0.1:8787/settings#host");
    expect(node).not.toContain("docker compose up -d");
    expect(node).not.toContain("NERDGRAM_ALLOWED_HOSTS: &quot;172.16.10.228&quot;");
  });

  it("serves HTML for a browser GET and JSON for /api, MCP, and other requests", async () => {
    const temp = await makeTempDataDir();
    cleanups.push(temp.cleanup);
    const server = app();
    const html = await request(server)
      .get("/")
      .set("Host", `evil.example"><script>`)
      .set("Accept", "text/html,application/xhtml+xml");
    expect(html.status).toBe(403);
    expect(html.headers["content-type"]).toMatch(/text\/html/);
    expect(html.text).toContain("NerdGram blocked this address");
    expect(html.text).toContain("evil.example&quot;&gt;&lt;script&gt;");
    expect(html.text).not.toContain("<script>");
    expect(html.text).toContain("settings#host");
    expect(html.text).not.toContain(temp.dir);

    const api = await request(server)
      .get("/api/health")
      .set("Host", "evil.example")
      .set("Accept", "text/html");
    expect(api.status).toBe(403);
    expect(api.body).toEqual({ error: "Forbidden host" });

    const mcp = await request(server).get("/mcp").set("Host", "evil.example").set("Accept", "text/html");
    expect(mcp.status).toBe(403);
    expect(mcp.body).toEqual({ error: "Forbidden host" });

    const curl = await request(server).get("/").set("Host", "evil.example").set("Accept", "*/*");
    expect(curl.status).toBe(403);
    expect(curl.body).toEqual({ error: "Forbidden host" });

    const post = await request(server).post("/").set("Host", "evil.example").set("Accept", "text/html");
    expect(post.status).toBe(403);
    expect(post.body).toEqual({ error: "Forbidden host" });
  });

  it("uses the Docker lines when NERDGRAM_INSTALL is docker", async () => {
    const temp = await makeTempDataDir();
    cleanups.push(temp.cleanup);
    process.env.NERDGRAM_INSTALL = "docker";
    const html = await request(app())
      .get("/")
      .set("Host", "172.16.10.228:8787")
      .set("Accept", "text/html");
    expect(html.status).toBe(403);
    expect(html.text).toContain("NERDGRAM_ALLOWED_HOSTS: &quot;172.16.10.228&quot;");
    expect(html.text).toContain("http://172.16.10.228:8787");
    expect(html.text).toContain("cannot see the host");
    expect(html.text).not.toContain("settings#host");
  });
});
