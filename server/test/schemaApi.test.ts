import fs from "node:fs";
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
} from "../src/publishedSchemas.js";
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
});
