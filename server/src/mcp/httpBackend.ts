import { httpFail } from "../storage.js";
import type { GenerateArgs, McpBackend, RefreshArgs, RenderArgs } from "./backend.js";

type TreeNode = { type?: string; path?: string; children?: TreeNode[] };

/**
 * stdio `nerdgram mcp` talks only to `/api/v1`. It does not call the
 * unauthenticated browser routes under `/api`.
 */
export function createHttpBackend(options: { base: string; token: string }): McpBackend {
  const base = options.base.replace(/\/+$/, "");
  const token = options.token;

  async function call(method: string, apiPath: string, body?: unknown): Promise<{ json: unknown; bytes: Buffer; contentType: string }> {
    if (!apiPath.startsWith("/api/v1")) {
      throw httpFail(500, "The MCP proxy only calls /api/v1.", "invalid");
    }
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || method !== "GET") headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(`${base}${apiPath}`, {
        method,
        headers,
        body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body),
        redirect: "error",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw httpFail(503, `Could not reach ${base}. ${message}`, "unreachable");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    let json: unknown;
    if (contentType.includes("json") || (!contentType.includes("image/") && bytes.length > 0 && bytes[0] === 0x7b)) {
      try {
        json = JSON.parse(bytes.toString("utf8")) as unknown;
      } catch {
        json = undefined;
      }
    }
    if (!response.ok) {
      const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const message = typeof record.error === "string" ? record.error : `Request failed (${response.status})`;
      const code = typeof record.code === "string" ? record.code : "invalid";
      const details: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (key !== "error" && key !== "code") details[key] = value;
      }
      throw httpFail(response.status, message, code, details);
    }
    return { json, bytes, contentType };
  }

  function flag(value: boolean | undefined): string | undefined {
    if (value == null) return undefined;
    return value ? "1" : "0";
  }

  function generateBody(input: GenerateArgs): Record<string, unknown> {
    return {
      text: input.data,
      format: input.format,
      path: input.path,
      ...(input.view != null ? { view: input.view } : {}),
      ...(input.includeDown != null ? { includeDown: input.includeDown } : {}),
      ...(input.vlan != null ? { vlan: input.vlan } : {}),
      ...(input.direction != null ? { direction: input.direction } : {}),
      ...(input.groupBy != null ? { groupBy: input.groupBy } : {}),
      ...(input.localDevice != null ? { localDevice: input.localDevice } : {}),
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.edgesText != null ? { edgesText: input.edgesText } : {}),
      ...(input.storeData != null ? { storeData: input.storeData } : {}),
    };
  }

  function walk(nodes: TreeNode[] | undefined, out: string[]): void {
    for (const node of nodes ?? []) {
      if (node.type === "file" && node.path) out.push(node.path);
      else if (node.type === "folder") walk(node.children, out);
    }
  }

  return {
    async list(folder) {
      const result = await call("GET", `/api/v1/diagrams?path=${encodeURIComponent(folder)}`);
      return result.json;
    },
    async search(input) {
      const query = new URLSearchParams({ q: input.q });
      const names = flag(input.names);
      const contents = flag(input.contents);
      const regex = flag(input.regex);
      if (names) query.set("names", names);
      if (contents) query.set("contents", contents);
      if (regex) query.set("regex", regex);
      const result = await call("GET", `/api/v1/search?${query.toString()}`);
      return result.json;
    },
    async get(filePath) {
      const result = await call("GET", `/api/v1/diagrams/content?path=${encodeURIComponent(filePath)}`);
      return result.json;
    },
    async exportFolder(folder) {
      const result = await call("GET", `/api/v1/export?path=${encodeURIComponent(folder)}`);
      return result.json;
    },
    async lint(input) {
      if (input.path && input.source != null) throw httpFail(400, "Send path or source, not both.", "invalid");
      if (input.source != null) {
        const result = await call("POST", "/api/v1/lint", { source: input.source });
        return result.json;
      }
      const query = input.path ? `?path=${encodeURIComponent(input.path)}` : "";
      const result = await call("GET", `/api/v1/lint${query}`);
      return result.json;
    },
    async render(input: RenderArgs) {
      const result = await call("POST", "/api/v1/render", {
        ...(input.path != null ? { path: input.path } : {}),
        ...(input.source != null ? { source: input.source } : {}),
        format: input.format,
        ...(input.background != null ? { background: input.background } : {}),
      });
      if (input.format === "svg") return { format: "svg", svg: result.bytes.toString("utf8") };
      return { format: "png", png: result.bytes };
    },
    async history(filePath) {
      const result = await call("GET", `/api/v1/history?path=${encodeURIComponent(filePath)}`);
      return result.json;
    },
    async diff(input) {
      const query = new URLSearchParams({ path: input.path, from: input.from, to: input.to });
      const result = await call("GET", `/api/v1/history/diff?${query.toString()}`);
      return result.json;
    },
    async create(input) {
      const result = await call("POST", "/api/v1/diagrams", input);
      return result.json;
    },
    async put(input) {
      const body = input.expectedHash
        ? { path: input.path, content: input.content, expectedHash: input.expectedHash }
        : { path: input.path, content: input.content, force: true };
      const result = await call("PUT", "/api/v1/diagrams", body);
      return result.json;
    },
    async mkdir(folder) {
      const result = await call("POST", "/api/v1/folders", { path: folder });
      return result.json;
    },
    async rename(input) {
      const result = await call("POST", "/api/v1/diagrams/rename", {
        from: input.from,
        to: input.to,
        updateLinks: input.updateLinks !== false,
      });
      return result.json;
    },
    async move(input) {
      const result = await call("POST", "/api/v1/diagrams/move", {
        from: input.from,
        toFolder: input.toFolder ?? "",
        updateLinks: input.updateLinks !== false,
      });
      return result.json;
    },
    async duplicate(input) {
      const result = await call("POST", "/api/v1/diagrams/duplicate", {
        path: input.path,
        ...(input.copyData != null ? { copyData: input.copyData } : {}),
      });
      return result.json;
    },
    async trash(input) {
      const result = await call("DELETE", "/api/v1/diagrams", {
        path: input.path,
        ...(input.deleteData != null ? { deleteData: input.deleteData } : {}),
        ...(input.confirmLinks != null ? { confirmLinks: input.confirmLinks } : {}),
      });
      return result.json;
    },
    async generate(input) {
      const result = await call("POST", "/api/v1/generate", generateBody(input));
      return result.json;
    },
    async upsert(input) {
      const result = await call("POST", "/api/v1/generate/upsert", generateBody(input));
      return result.json;
    },
    async refresh(input: RefreshArgs) {
      const result = await call("POST", "/api/v1/generate/refresh", {
        path: input.path,
        ...(input.data != null ? { text: input.data } : {}),
        ...(input.edgesText != null ? { edgesText: input.edgesText } : {}),
        writeData: input.data != null,
        save: true,
      });
      return result.json;
    },
    async replacePreview(input) {
      const result = await call("POST", "/api/v1/replace/preview", input);
      return result.json;
    },
    async replaceApply(input) {
      const result = await call("POST", "/api/v1/replace/apply", input);
      return result.json;
    },
    async baseline(input) {
      const result = await call("POST", "/api/v1/history/baseline", {
        path: input.path,
        ...(input.name != null ? { name: input.name } : {}),
        ...(input.note != null ? { note: input.note } : {}),
        ...(input.id != null ? { id: input.id } : {}),
      });
      return result.json;
    },
    async diagramPaths() {
      const result = await call("GET", "/api/v1/diagrams?path=");
      const body = result.json as { folders?: TreeNode[]; files?: TreeNode[] };
      const paths: string[] = [];
      walk(body.files, paths);
      walk(body.folders, paths);
      return paths;
    },
  };
}

/** Read vs read-write, without writing. A missing path is 400 only after the scope check. */
export async function probeTokenScope(base: string, token: string): Promise<"read" | "read-write"> {
  const backend = createHttpBackend({ base, token });
  try {
    await backend.mkdir("");
    throw httpFail(500, "Scope probe wrote a folder.", "invalid");
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? (err as { status?: unknown }).status : undefined;
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined;
    if (status === 401) throw httpFail(401, "Unauthorized", "unauthorized");
    if (status === 403 && code === "forbidden") return "read";
    if (status === 400) return "read-write";
    throw err;
  }
}
