import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.js";

/** Default loopback URL. The running server serves this path with no token. */
export const NETWORK_SCHEMA_ID = "http://127.0.0.1:8787/api/v1/schema/network.json";
export const GRAPH_SCHEMA_ID = "http://127.0.0.1:8787/api/v1/schema/graph.json";

export const NETWORK_SCHEMA_FILE = path.join(REPO_ROOT, "docs/schema/network.schema.json");
export const GRAPH_SCHEMA_FILE = path.join(REPO_ROOT, "docs/schema/graph.schema.json");

const DROP = new Set(["$schema", "$id", "$defs", "$comment"]);

export function readPublishedSchema(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

function componentName(prefix: string, defName: string): string {
  const tail = defName.slice(0, 1).toUpperCase() + defName.slice(1);
  return `${prefix}${tail}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * JSON Schema draft 2020-12 to an OpenAPI 3.0 schema object.
 * `const` becomes a one-value enum. `$defs` are returned separately so the
 * caller can place them on `components.schemas`.
 */
export function toOpenApiSchemas(
  document: unknown,
  prefix: string,
): { root: Record<string, unknown>; schemas: Record<string, Record<string, unknown>> } {
  if (!isRecord(document)) throw new Error("Schema document must be an object.");
  const schemas: Record<string, Record<string, unknown>> = {};
  const defs = isRecord(document.$defs) ? document.$defs : {};
  for (const [name, def] of Object.entries(defs)) {
    schemas[componentName(prefix, name)] = convertNode(def, prefix) as Record<string, unknown>;
  }
  const root = convertNode(document, prefix);
  if (!isRecord(root)) throw new Error("Converted schema must be an object.");
  return { root, schemas };
}

function convertNode(node: unknown, prefix: string): unknown {
  if (Array.isArray(node)) return node.map((item) => convertNode(item, prefix));
  if (!isRecord(node)) return node;
  if (typeof node.$ref === "string") {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(node.$ref);
    if (!match?.[1]) return { $ref: node.$ref };
    return { $ref: `#/components/schemas/${componentName(prefix, match[1])}` };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROP.has(key)) continue;
    if (key === "const") {
      out.enum = [value];
      continue;
    }
    out[key] = convertNode(value, prefix);
  }
  return out;
}

export function networkOpenApiSchemas(): Record<string, unknown> {
  const document = JSON.parse(readPublishedSchema(NETWORK_SCHEMA_FILE).toString("utf8")) as unknown;
  const converted = toOpenApiSchemas(document, "Network");
  return { NetworkDocument: converted.root, ...converted.schemas };
}

export function graphOpenApiSchemas(): Record<string, unknown> {
  const document = JSON.parse(readPublishedSchema(GRAPH_SCHEMA_FILE).toString("utf8")) as unknown;
  const converted = toOpenApiSchemas(document, "Graph");
  return { GraphDocument: converted.root, ...converted.schemas };
}
