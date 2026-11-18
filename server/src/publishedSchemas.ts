import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.js";
import { parseHostHeader } from "./security.js";

/**
 * `$id` in the repository files. The running server rewrites `$id` to the
 * host and port of the request. These constants stay the default-port names.
 */
export const NETWORK_SCHEMA_ID = "http://127.0.0.1:8787/api/v1/schema/network.json";
export const GRAPH_SCHEMA_ID = "http://127.0.0.1:8787/api/v1/schema/graph.json";

export const NETWORK_SCHEMA_FILE = path.join(REPO_ROOT, "docs/schema/network.schema.json");
export const GRAPH_SCHEMA_FILE = path.join(REPO_ROOT, "docs/schema/graph.schema.json");

const DROP = new Set(["$schema", "$id", "$defs", "$comment"]);

export function readPublishedSchema(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

/**
 * `$id` for a schema response. Built from the Host header the Host check
 * already allowed, plus the request protocol. A missing port uses `fallbackPort`
 * (the socket port). The repository file is not changed.
 */
export function schemaIdForRequest(
  kind: "network" | "graph",
  hostHeader: string | undefined,
  protocol: string | undefined,
  fallbackPort: number,
): string {
  const parsed = hostHeader ? parseHostHeader(hostHeader) : null;
  const hostname = parsed?.hostname || "127.0.0.1";
  let port = parsed?.port ?? null;
  if (port == null || !/^[0-9]+$/.test(port)) {
    const fallback = Number.isInteger(fallbackPort) && fallbackPort >= 1 && fallbackPort <= 65535 ? fallbackPort : 8787;
    port = String(fallback);
  }
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  const proto = protocol === "https" ? "https" : "http";
  const file = kind === "network" ? "network.json" : "graph.json";
  return `${proto}://${host}:${port}/api/v1/schema/${file}`;
}

/** Replace the document `$id` when it differs. The same id returns the original bytes. */
export function withRequestSchemaId(body: Buffer, id: string): Buffer {
  const text = body.toString("utf8");
  let current: unknown;
  try {
    current = (JSON.parse(text) as { $id?: unknown }).$id;
  } catch {
    return body;
  }
  if (typeof current !== "string" || current === id) return body;
  const needle = `"$id": ${JSON.stringify(current)}`;
  const next = `"$id": ${JSON.stringify(id)}`;
  const at = text.indexOf(needle);
  if (at < 0) return body;
  return Buffer.from(text.slice(0, at) + next + text.slice(at + needle.length));
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
