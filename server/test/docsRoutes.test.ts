import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openApiPath, V1_ROUTES, type V1Scope } from "../src/openapi.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function scopeLabel(scope: V1Scope): string {
  if (scope === "write") return "read-write";
  return scope;
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from, to);
}

function routeRows(block: string): { method: string; path: string; scope: string }[] {
  const rows: { method: string; path: string; scope: string }[] = [];
  for (const line of block.split("\n")) {
    const match = /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/i.exec(line);
    if (!match) continue;
    rows.push({ method: match[1].toLowerCase(), path: match[2], scope: match[3] });
  }
  return rows;
}

describe("automation docs stay aligned with V1_ROUTES", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const cli = fs.readFileSync(path.join(repoRoot, "docs/cli.md"), "utf8");
  const serverCli = fs.readFileSync(path.join(repoRoot, "server/src/cli.ts"), "utf8");

  it("lists every V1 route in the README endpoint table", () => {
    const rows = routeRows(between(readme, "<!-- v1-route-table -->", "<!-- /v1-route-table -->"));
    const expected = V1_ROUTES.map((route) => `${route.method} ${openApiPath(route)}`).sort();
    const found = rows.map((row) => `${row.method} ${row.path}`).sort();
    expect(found).toEqual(expected);
    expect(new Set(found).size).toBe(found.length);

    for (const route of V1_ROUTES) {
      const row = rows.find((item) => item.method === route.method && item.path === openApiPath(route));
      expect(row?.scope, openApiPath(route)).toBe(scopeLabel(route.scope));
    }
  });

  it("maps every V1 route and every nerdgram command in docs/cli.md", () => {
    const block = between(cli, "<!-- cli-route-map -->", "<!-- /cli-route-map -->");
    const routes = [...block.matchAll(/\|\s*`((?:GET|POST|PUT|PATCH|DELETE) \/api\/v1[^`]*)`\s*\|/g)].map(
      (match) => match[1].toLowerCase(),
    );
    const expected = V1_ROUTES.map((route) => `${route.method} ${openApiPath(route)}`.toLowerCase()).sort();
    expect([...routes].sort()).toEqual(expected);

    const commandSwitch = serverCli.slice(
      serverCli.indexOf("switch (parsed.command)"),
      serverCli.indexOf("default:", serverCli.indexOf("switch (parsed.command)")),
    );
    const commands = [...commandSwitch.matchAll(/case "([^"]+)":/g)].map((match) => match[1]);
    expect(commands.length).toBeGreaterThan(10);
    for (const command of commands) {
      expect(block, command).toContain(`nerdgram ${command}`);
    }
  });
});
