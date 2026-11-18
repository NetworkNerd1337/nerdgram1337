import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildOpenApiSpec } from "../src/openapi.js";
import {
  GRAPH_SCHEMA_FILE,
  GRAPH_SCHEMA_ID,
  NETWORK_SCHEMA_FILE,
  NETWORK_SCHEMA_ID,
  schemaIdForRequest,
  withRequestSchemaId,
} from "../src/publishedSchemas.js";
import { REPO_ROOT } from "../src/paths.js";
import { makeTempDataDir } from "./helpers.js";

const require = createRequire(import.meta.url);
const HOST = "127.0.0.1:8787";

function app() {
  return createApp({
    mode: "production",
    port: 8787,
    bindHosts: ["127.0.0.1", "::1"],
  });
}

describe("published schemas", () => {
  let cleanup = async () => {};

  afterEach(async () => {
    await cleanup();
  });

  it("serves the network schema without a token and rejects a foreign Host", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const server = app();
    const disk = fs.readFileSync(NETWORK_SCHEMA_FILE);
    const served = await request(server).get("/api/v1/schema/network.json").set("Host", HOST);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toMatch(/application\/schema\+json/);
    const servedText = served.text || (Buffer.isBuffer(served.body) ? served.body.toString("utf8") : JSON.stringify(served.body));
    const diskText = disk.toString("utf8");
    if (servedText !== diskText) expect(JSON.parse(servedText)).toEqual(JSON.parse(diskText));
    else expect(servedText).toBe(diskText);
    expect(JSON.parse(diskText).$id).toBe(NETWORK_SCHEMA_ID);

    const foreign = await request(server).get("/api/v1/schema/network.json").set("Host", "evil.example");
    expect(foreign.status).toBe(403);

    const graphDisk = fs.readFileSync(GRAPH_SCHEMA_FILE, "utf8");
    const graph = await request(server).get("/api/v1/schema/graph.json").set("Host", HOST);
    expect(graph.status).toBe(200);
    expect(graph.text).toBe(graphDisk);
    expect(JSON.parse(graphDisk).$id).toBe(GRAPH_SCHEMA_ID);
    const graphForeign = await request(server).get("/api/v1/schema/graph.json").set("Host", "evil.example");
    expect(graphForeign.status).toBe(403);
  });

  it("sets $id from the request host and port and leaves the repository file alone", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const server = createApp({
      mode: "production",
      port: 8816,
      bindHosts: ["127.0.0.1", "::1"],
    });
    const disk = JSON.parse(fs.readFileSync(NETWORK_SCHEMA_FILE, "utf8")) as { $id: string };
    expect(disk.$id).toBe(NETWORK_SCHEMA_ID);
    expect(schemaIdForRequest("network", "127.0.0.1:8816", "http", 8816)).toBe(
      "http://127.0.0.1:8816/api/v1/schema/network.json",
    );
    expect(schemaIdForRequest("graph", "[::1]:8816", "http", 8816)).toBe(
      "http://[::1]:8816/api/v1/schema/graph.json",
    );
    expect(schemaIdForRequest("network", "localhost", "https", 8816)).toBe(
      "https://localhost:8816/api/v1/schema/network.json",
    );

    const served = await request(server).get("/api/v1/schema/network.json").set("Host", "127.0.0.1:8816");
    expect(served.status).toBe(200);
    const body = JSON.parse(served.text) as { $id: string };
    expect(body.$id).toBe("http://127.0.0.1:8816/api/v1/schema/network.json");
    const { $id: servedId, ...servedRest } = body;
    const { $id: diskId, ...diskRest } = disk;
    expect(servedId).not.toBe(diskId);
    expect(servedRest).toEqual(diskRest);

    const graph = await request(server).get("/api/v1/schema/graph.json").set("Host", "127.0.0.1:8816");
    expect(JSON.parse(graph.text).$id).toBe("http://127.0.0.1:8816/api/v1/schema/graph.json");

    const foreign = await request(server).get("/api/v1/schema/network.json").set("Host", "evil.example");
    expect(foreign.status).toBe(403);

    const same = withRequestSchemaId(fs.readFileSync(NETWORK_SCHEMA_FILE), NETWORK_SCHEMA_ID);
    expect(same.equals(fs.readFileSync(NETWORK_SCHEMA_FILE))).toBe(true);
  });

  it("validates the OpenAPI document and the generic samples", async () => {
    const { default: OpenAPISchemaValidator } = require("openapi-schema-validator") as {
      default: new (options: { version: number }) => { validate(spec: unknown): { errors: { message?: string }[] } };
    };
    const validator = new OpenAPISchemaValidator({ version: 3 });
    const spec = buildOpenApiSpec();
    const result = validator.validate(spec);
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
    expect(spec.openapi).toBe("3.0.3");

    const schemas = (spec.components as { schemas: Record<string, { properties?: Record<string, unknown> }> }).schemas;
    expect(schemas.NetworkDocument).toBeTruthy();
    expect(schemas.GraphDocument).toBeTruthy();
    const upsert = (
      spec.paths as Record<string, { post: { requestBody: { content: { "application/json": { schema: { properties: { groupBy: { enum: string[] } } } } } } } }>
    )["/api/v1/generate/upsert"].post;
    expect(upsert.requestBody.content["application/json"].schema.properties.groupBy.enum).toEqual([
      "platform",
      "capability",
      "vrf",
      "site",
      "role",
    ]);
    const serialized = JSON.stringify(upsert);
    expect(serialized).toContain("#/components/schemas/NetworkDocument");
    expect(serialized).toContain("platform");

    const { default: Ajv2020 } = require("ajv/dist/2020.js") as {
      default: new (options?: { allErrors?: boolean; strict?: boolean }) => {
        compile(schema: unknown): (data: unknown) => boolean;
        errorsText(): string;
      };
    };
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const graphSchema = JSON.parse(fs.readFileSync(GRAPH_SCHEMA_FILE, "utf8")) as unknown;
    const validate = ajv.compile(graphSchema);
    const samples = path.join(path.dirname(GRAPH_SCHEMA_FILE), "../samples");
    const campus = JSON.parse(fs.readFileSync(path.join(samples, "campus.json"), "utf8")) as unknown;
    expect(validate(campus), ajv.errorsText()).toBe(true);
    const links = {
      links: [{ localDevice: "Core", remoteDevice: "Atlanta", localPort: "Gi0/0", remotePort: "Gi0/1" }],
    };
    expect(validate(links), ajv.errorsText()).toBe(true);
  });

  it("passes the Redocly recommended ruleset with no errors and no unused schemas", () => {
    const spec = buildOpenApiSpec();
    const file = path.join(os.tmpdir(), `nerdgram-openapi-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(spec));
    const lint = spawnSync(path.join(REPO_ROOT, "server/node_modules/.bin/redocly"), ["lint", file], {
      encoding: "utf8",
    });
    fs.rmSync(file, { force: true });
    const output = `${lint.stdout ?? ""}\n${lint.stderr ?? ""}`;
    expect(lint.status, output).toBe(0);
    expect(output).not.toMatch(/\berror\b/i);
    expect(output).not.toContain("is never used");

    const emptyRequired: string[] = [];
    const nullableWithoutType: string[] = [];
    const refs = new Set<string>();
    walk(spec, "", (value, pointer) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.required) && record.required.length === 0) emptyRequired.push(pointer);
      if (record.nullable === true && record.type == null && record.$ref == null && record.allOf == null && record.oneOf == null && record.anyOf == null) {
        nullableWithoutType.push(pointer);
      }
      if (typeof record.$ref === "string" && record.$ref.startsWith("#/components/schemas/")) refs.add(record.$ref);
    });
    expect(emptyRequired).toEqual([]);
    expect(nullableWithoutType).toEqual([]);
    const schemas = (spec.components as { schemas: Record<string, object> }).schemas;
    const unused = Object.keys(schemas).filter((name) => !refs.has(`#/components/schemas/${name}`));
    expect(unused).toEqual([]);
    const repairs = at(spec, ["paths", "/api/v1/link-repairs", "post", "requestBody", "content", "application/json", "schema"]);
    expect(repairs.required).toBeUndefined();
    const baseline = at(spec, [
      "paths",
      "/api/v1/history/baseline",
      "delete",
      "responses",
      "200",
      "content",
      "application/json",
      "schema",
      "properties",
      "revision",
    ]);
    expect(baseline.type).toBe("object");
    expect(baseline.nullable).toBe(true);
  });
});

function at(root: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  let current: unknown = root;
  for (const key of keys) {
    current = (current as Record<string, unknown>)[key];
  }
  return current as Record<string, unknown>;
}

function walk(value: unknown, pointer: string, visit: (value: unknown, pointer: string) => void): void {
  visit(value, pointer);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${pointer}/${index}`, visit));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) walk(child, `${pointer}/${key}`, visit);
  }
}
