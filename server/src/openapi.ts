import { createRequire } from "node:module";
import { jsonSuccess, REQUEST_EXAMPLES, RESPONSE_SCHEMAS, SHARED_SCHEMAS } from "./openapiShapes.js";
import { graphOpenApiSchemas, networkOpenApiSchemas } from "./publishedSchemas.js";
import { loadedTranslatorIds } from "./translators/registry.js";
import { loadedExporterIds } from "./exporters/registry.js";

const require = createRequire(import.meta.url);
const serverPackage = require("../package.json") as { version: string };

export type V1Method = "get" | "post" | "put" | "patch" | "delete";
export type V1Scope = "public" | "read" | "write";

export type V1Route = {
  method: V1Method;
  /** Path on the `/api/v1` router. */
  path: string;
  scope: V1Scope;
  operationId: string;
  summary: string;
  tag: string;
};

/**
 * Source of truth for `/api/v1` routes and the OpenAPI document.
 * `mountAutomationApi` registers one handler per entry.
 */
export const V1_ROUTES: readonly V1Route[] = [
  {
    method: "get",
    path: "/openapi.json",
    scope: "public",
    operationId: "getOpenApi",
    summary: "OpenAPI document for this API.",
    tag: "Meta",
  },
  {
    method: "get",
    path: "/schema/network.json",
    scope: "public",
    operationId: "getNetworkSchema",
    summary: "JSON Schema for the network document. Same document as docs/schema/network.schema.json, with $id set from this request. No token.",
    tag: "Meta",
  },
  {
    method: "get",
    path: "/schema/graph.json",
    scope: "public",
    operationId: "getGraphSchema",
    summary: "JSON Schema for generic nodes, edges, and links. $id is set from this request. No token.",
    tag: "Meta",
  },
  {
    method: "get",
    path: "/diagrams",
    scope: "read",
    operationId: "listDiagrams",
    summary: "List folders and diagrams in one folder.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/search",
    scope: "read",
    operationId: "searchDiagrams",
    summary: "Search diagram names and text.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/diagrams/content",
    scope: "read",
    operationId: "getDiagram",
    summary: "Read one diagram's source and metadata.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/diagrams",
    scope: "write",
    operationId: "createDiagram",
    summary: "Create a diagram. Fails if the path already exists.",
    tag: "Diagrams",
  },
  {
    method: "put",
    path: "/diagrams",
    scope: "write",
    operationId: "updateDiagram",
    summary: "Create or overwrite a diagram.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/diagrams/rename",
    scope: "write",
    operationId: "renameDiagram",
    summary: "Rename a diagram or folder and update click links.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/diagrams/move",
    scope: "write",
    operationId: "moveDiagram",
    summary: "Move a diagram or folder, update click links, and move a sibling data file with it.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/diagrams/duplicate",
    scope: "write",
    operationId: "duplicateDiagram",
    summary: "Duplicate a diagram or folder. Optional to names the copy. copyData is required when a sibling data file exists.",
    tag: "Diagrams",
  },
  {
    method: "delete",
    path: "/diagrams",
    scope: "write",
    operationId: "deleteDiagram",
    summary: "Move a diagram or folder to the trash. deleteData chooses whether a sibling data file goes too. A file another diagram still uses is kept, and the response names that diagram.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/folders",
    scope: "write",
    operationId: "createFolder",
    summary: "Create a folder. 409 when that folder already exists.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/export",
    scope: "read",
    operationId: "exportDiagrams",
    summary: "Read every diagram under a folder.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/exporters",
    scope: "read",
    operationId: "listExporters",
    summary: "List installed design exporters. Each entry has an id, a display name, an extension, a MIME type, and a description.",
    tag: "Exporters",
  },
  {
    method: "post",
    path: "/export/:target",
    scope: "read",
    operationId: "exportTarget",
    summary:
      "Write a design-export file from canonical network JSON. target is an exporter id. The body is the document, or input, or a workspace path. Credentials in the result are placeholders. Nothing is contacted.",
    tag: "Exporters",
  },
  {
    method: "get",
    path: "/link-repairs",
    scope: "read",
    operationId: "previewLinkRepairs",
    summary: "Preview click-link repairs after a diagram was renamed outside the app. Nothing is written.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/link-repairs",
    scope: "write",
    operationId: "applyLinkRepairs",
    summary: "Preview or apply click-link repairs. dryRun defaults to true, so nothing is written until confirm is true and dryRun is false.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/lint",
    scope: "read",
    operationId: "lintWorkspace",
    summary: "Lint one saved diagram, or every diagram when path is omitted. A file that cannot be read is listed under unreadable, and the other diagrams are still checked.",
    tag: "Lint",
  },
  {
    method: "post",
    path: "/lint",
    scope: "read",
    operationId: "lintSource",
    summary: "Lint Mermaid source that is not necessarily saved.",
    tag: "Lint",
  },
  {
    method: "get",
    path: "/render",
    scope: "read",
    operationId: "renderSavedDiagram",
    summary: "Render a saved diagram to SVG or PNG.",
    tag: "Render",
  },
  {
    method: "post",
    path: "/render",
    scope: "read",
    operationId: "renderDiagram",
    summary: "Render a saved diagram or posted Mermaid source to SVG or PNG.",
    tag: "Render",
  },
  {
    method: "post",
    path: "/generate/preview",
    scope: "read",
    operationId: "previewGenerate",
    summary: "Preview a diagram generated from CSV, JSON, Cisco CDP, LLDP, or network JSON. Nothing is written.",
    tag: "Generate",
  },
  {
    method: "post",
    path: "/generate",
    scope: "write",
    operationId: "generateDiagram",
    summary: "Create a diagram from CSV, JSON, Cisco CDP, LLDP, or network JSON and store the data file beside it. 409 when the path already exists.",
    tag: "Generate",
  },
  {
    method: "post",
    path: "/generate/upsert",
    scope: "write",
    operationId: "upsertDiagram",
    summary:
      "Create a generated diagram, or update its generated block and sibling data file when that path already exists. Text outside the generated markers stays. 409 when the file was not generated from data.",
    tag: "Generate",
  },
  {
    method: "post",
    path: "/generate/refresh",
    scope: "write",
    operationId: "refreshDiagram",
    summary: "Refresh the generated block of a diagram from its data file.",
    tag: "Generate",
  },
  {
    method: "get",
    path: "/translators",
    scope: "read",
    operationId: "listTranslators",
    summary: "List installed translators. Each entry has an id, a display name, a format hint, and a placeholder.",
    tag: "Translators",
  },
  {
    method: "post",
    path: "/convert/:source",
    scope: "read",
    operationId: "convertSource",
    summary:
      "Convert a saved export to canonical network JSON. source is a translator id. A read token can convert. path and view upsert the diagram and need a read-write token. The body is at most 4 MiB. Nothing is fetched from the source tool.",
    tag: "Translators",
  },
  {
    method: "get",
    path: "/history",
    scope: "read",
    operationId: "listHistory",
    summary: "List revisions for one diagram, including baseline name and note.",
    tag: "History",
  },
  {
    method: "get",
    path: "/history/diff",
    scope: "read",
    operationId: "diffHistory",
    summary: "Diff two revisions, or a revision and the current diagram. Does not modify the file.",
    tag: "History",
  },
  {
    method: "post",
    path: "/history/baseline",
    scope: "write",
    operationId: "createBaseline",
    summary: "Name a revision, or save the current diagram as a named baseline.",
    tag: "History",
  },
  {
    method: "patch",
    path: "/history/baseline",
    scope: "write",
    operationId: "updateBaseline",
    summary: "Rename a baseline or change its note.",
    tag: "History",
  },
  {
    method: "delete",
    path: "/history/baseline",
    scope: "write",
    operationId: "deleteBaseline",
    summary: "Remove a baseline name. The revision stays, then the 20-revision limit applies to it again.",
    tag: "History",
  },
  {
    method: "post",
    path: "/replace/preview",
    scope: "read",
    operationId: "previewReplace",
    summary: "Preview a find and replace across diagrams. Nothing is written.",
    tag: "Replace",
  },
  {
    method: "post",
    path: "/replace/apply",
    scope: "write",
    operationId: "applyReplace",
    summary: "Apply a previewed find and replace. Each changed diagram is saved, so the previous text becomes a revision.",
    tag: "Replace",
  },
  {
    method: "post",
    path: "/replace/undo",
    scope: "write",
    operationId: "undoReplace",
    summary: "Undo one replace operation. Files edited since the replace are skipped.",
    tag: "Replace",
  },
];

export function openApiPath(route: V1Route): string {
  return `/api/v1${route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`;
}

const errorSchema = {
  type: "object",
  properties: {
    error: { type: "string" },
    code: { type: "string" },
    lock: {
      type: "object",
      description:
        "Present when code is locked. instanceName, hostname, acquiredAt, and heartbeatAt identify the holder. sameInstance is false when another NerdGram instance holds the diagram.",
      properties: {
        instanceId: { type: "string" },
        instanceName: { type: "string" },
        hostname: { type: "string" },
        acquiredAt: { type: "string" },
        heartbeatAt: { type: "string" },
        sameInstance: { type: "boolean" },
        staleAfterMs: { type: "number" },
      },
    },
  },
  required: ["error"],
};

const pathQuery = {
  name: "path",
  in: "query",
  required: false,
  schema: { type: "string" },
  description: "Workspace path relative to the data directory. Empty is the root.",
};

function jsonBody(
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  examples?: Record<string, { summary: string; value: unknown }>,
): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: "object", description, properties };
  if (required.length > 0) schema.required = required;
  const media: Record<string, unknown> = { schema };
  if (examples) media.examples = examples;
  return {
    required: true,
    content: {
      "application/json": media,
    },
  };
}

function operationBody(operationId: string): Record<string, unknown> | undefined {
  switch (operationId) {
    case "createDiagram":
    case "updateDiagram":
      return jsonBody("Diagram source.", {
        path: { type: "string", description: "Workspace path ending in .mmd." },
        content: { type: "string" },
        force: { type: "boolean", description: "Overwrite an existing file. Update accepts this." },
        expectedHash: { type: "string" },
        expectedMtimeMs: { type: "number" },
      }, ["path", "content"]);
    case "renameDiagram":
      return jsonBody("Rename.", {
        from: { type: "string" },
        to: { type: "string" },
        updateLinks: { type: "boolean", description: "Defaults to true. Rewrites click targets the way the editor does. A sibling data file moves with the diagram and nerdgram.source is updated." },
      }, ["from", "to"]);
    case "moveDiagram":
      return jsonBody("Move.", {
        from: { type: "string" },
        toFolder: { type: "string", description: "Empty moves to the workspace root." },
        updateLinks: { type: "boolean" },
      }, ["from"]);
    case "duplicateDiagram":
      return jsonBody("Duplicate. copyData is required when a CSV, JSON, network JSON, CDP, or LLDP file sits beside the diagram.", {
        path: { type: "string" },
        to: {
          type: "string",
          description: "Workspace path for the copy. Omit it and the name is Name (copy), then Name (copy 2). A path that already exists is 409 and nothing is written.",
        },
        copyData: {
          type: "boolean",
          description: "True copies the data file and points the duplicate at the copy. False shares the original file. Omit it and the call returns 409 with the file list when a sibling data file exists.",
        },
      }, ["path"]);
    case "deleteDiagram":
      return jsonBody("Trash.", {
        path: { type: "string" },
        confirmLinks: { type: "boolean", description: "Defaults to true. False returns 409 when other diagrams link here." },
        deleteData: {
          type: "boolean",
          description: "True moves a sibling data file to the trash with the diagram. False leaves that file in the workspace. Omit it and the call returns 409 with the file list when a sibling data file exists.",
        },
      }, ["path"]);
    case "createFolder":
      return jsonBody("Folder.", { path: { type: "string" } }, ["path"]);
    case "lintSource":
      return jsonBody("Source to lint.", {
        source: { type: "string" },
        sourcePath: { type: "string" },
        diagramPaths: { type: "array", items: { type: "string" } },
        rules: { type: "object", additionalProperties: { type: "boolean" } },
      }, ["source"]);
    case "renderDiagram":
      return jsonBody("What to render. Send path or source.", {
        path: { type: "string" },
        source: { type: "string" },
        format: { type: "string", enum: ["svg", "png"] },
        background: { type: "string", description: "Hex color, such as #ffffff." },
      }, ["format"]);
    case "previewGenerate":
    case "generateDiagram":
    case "upsertDiagram":
      return jsonBody(
        "CSV, JSON, Cisco CDP, LLDP, or network JSON. When format is network, text is a JSON encoding of NetworkDocument. When format is json, text is GraphDocument. Network data also sends view. Upsert creates the diagram or updates the generated block.",
        {
          text: {
            type: "string",
            description:
              "The whole file as text. CSV, CDP, and LLDP are plain text. When format is network, this string is the JSON encoding of NetworkDocument. When format is json, this string is the JSON encoding of GraphDocument.",
          },
          networkDocument: {
            readOnly: true,
            description:
              "The network document encoded in text when format is network. Send that JSON in text. This field is the type of that document.",
            allOf: [{ $ref: "#/components/schemas/NetworkDocument" }],
          },
          graphDocument: {
            readOnly: true,
            description:
              "The generic nodes, edges, or links document encoded in text when format is json. Send that JSON in text. This field is the type of that document.",
            allOf: [{ $ref: "#/components/schemas/GraphDocument" }],
          },
          path: { type: "string", description: "Required for generate and upsert. Diagram path ending in .mmd." },
          format: { type: "string", enum: ["csv", "json", "cdp", "lldp", "network", "route", "arpmac"] },
          view: { type: "string", enum: ["l3", "l2"], description: "Required when format is network. l3 is subnets. l2 is VLANs, trunks, and LAGs." },
          includeDown: { type: "boolean", description: "Network data. Include shutdown or down interfaces. Defaults to false." },
          vlan: { type: "integer", description: "Layer 2 network view. Draw only links that carry this VLAN id." },
          shape: { type: "string" },
          direction: { type: "string", enum: ["TD", "TB", "LR", "RL", "BT"] },
          mapping: { type: "object" },
          grouping: { type: "boolean" },
          groupBy: {
            type: "string",
            enum: ["platform", "capability", "vrf", "site", "role"],
            description:
              "Every group-by value. CDP and LLDP use platform (the default) or capability. Network Layer 3 uses vrf. Network Layer 2 uses site, role, or platform.",
          },
          localDevice: { type: "string", description: "Hostname when CDP, LLDP, or a routing table has no CLI prompt." },
          hosts: {
            type: "string",
            enum: ["ports", "port-counts", "vlan-counts"],
            description: "Routing tables and ARP/MAC tables. Place hosts on switchports, or draw a count per port or per VLAN. ARP without a MAC table does not infer links.",
          },
          title: { type: "string" },
          edgesText: { type: "string" },
          storeData: { type: "boolean" },
        },
        ["text"],
      );
    case "applyLinkRepairs":
      return jsonBody("Link repair. Omit dryRun or set it true to preview. Writes require dryRun false and confirm true.", {
        dryRun: { type: "boolean", description: "Defaults to true. Nothing is written while this is true." },
        confirm: { type: "boolean", description: "Must be true, with dryRun false, before files change." },
        lockToken: { type: "string", description: "Editor lock token when a diagram being saved is open in this window." },
        choices: {
          type: "array",
          description: "from/to pairs the caller previewed. Omit to apply every unambiguous suggestion. Ambiguous matches are never chosen.",
          items: {
            type: "object",
            properties: { from: { type: "string" }, to: { type: "string" } },
            required: ["from", "to"],
          },
        },
      }, []);
    case "refreshDiagram":
      return jsonBody("Refresh.", {
        path: { type: "string" },
        text: {
          type: "string",
          description:
            "Replacement data. Omitted reads the file named in the front matter. When the file is network JSON, the string is a NetworkDocument. When it is generic JSON, the string is a GraphDocument.",
        },
        networkDocument: {
          readOnly: true,
          description: "The network document encoded in text when the stored format is network. Send that JSON in text.",
          allOf: [{ $ref: "#/components/schemas/NetworkDocument" }],
        },
        graphDocument: {
          readOnly: true,
          description: "The generic graph document encoded in text when the stored format is json. Send that JSON in text.",
          allOf: [{ $ref: "#/components/schemas/GraphDocument" }],
        },
        save: { type: "boolean", description: "Write the refreshed diagram. Defaults to false." },
        writeData: { type: "boolean" },
      }, ["path"]);
    case "createBaseline":
      return jsonBody("Name a revision, or omit id to save the current diagram as a new named baseline. The diagram file is not modified.", {
        path: { type: "string" },
        id: { type: "string", description: "Revision id. Omit to snapshot the current saved diagram." },
        name: { type: "string" },
        note: { type: "string" },
      }, ["path", "name"]);
    case "updateBaseline":
      return jsonBody("Rename a baseline or replace its note. Send note as an empty string to clear it.", {
        path: { type: "string" },
        id: { type: "string" },
        name: { type: "string" },
        note: { type: "string" },
      }, ["path", "id"]);
    case "deleteBaseline":
      return jsonBody("Remove the baseline name. The revision remains and is then subject to the 20-revision limit.", {
        path: { type: "string" },
        id: { type: "string" },
      }, ["path", "id"]);
    case "previewReplace":
      return jsonBody("Find and replace preview. Nothing is written. The default scope is every diagram. Body only; set includeFrontMatter to search the YAML header too.", {
        find: { type: "string" },
        replace: { type: "string" },
        matchCase: { type: "boolean" },
        wholeWord: { type: "boolean" },
        regex: { type: "boolean", description: "Replacement may use $1 and named groups." },
        includeFrontMatter: { type: "boolean", description: "Defaults to false. Front matter is skipped." },
        scope: {
          type: "object",
          properties: {
            folder: { type: "string" },
            recursive: { type: "boolean", description: "When folder is set, include subfolders. Defaults to true." },
            paths: { type: "array", items: { type: "string" }, description: "Selected diagrams. Hidden files, .meta, and trash are refused." },
          },
        },
      }, ["find", "replace"]);
    case "applyReplace":
      return jsonBody("Apply selected files from a preview. hash is the preview hash. skipMatchIds omits listed matches; unlisted matches in a selected file are still replaced. Locked files and files whose hash changed are skipped.", {
        find: { type: "string" },
        replace: { type: "string" },
        matchCase: { type: "boolean" },
        wholeWord: { type: "boolean" },
        regex: { type: "boolean" },
        includeFrontMatter: { type: "boolean" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              hash: { type: "string" },
              skipMatchIds: { type: "array", items: { type: "string" } },
            },
            required: ["path", "hash"],
          },
        },
      }, ["find", "replace", "files"]);
    case "undoReplace":
      return jsonBody("Undo a replace operation id returned by apply. A file edited since the replace is skipped.", {
        id: { type: "string" },
      }, ["id"]);
    case "convertSource":
      return jsonBody(
        "The saved export, or a wrapper when path or view is set. A wrapper puts the export in input, or a JSON string in text. Query path and view also upsert a raw export body. The body is at most 4 MiB.",
        {
          input: { description: "The export object. Use this when path or view is set." },
          text: { type: "string", description: "The export as a JSON string. Use this with path and view." },
          path: { type: "string", description: "Diagram path ending in .mmd. Upserts the converted document. Needs a read-write token." },
          view: { type: "string", enum: ["l3", "l2"], description: "Required with path. l3 is subnets. l2 is VLANs, trunks, and LAGs." },
          includeDown: { type: "boolean" },
          vlan: { type: "integer" },
          groupBy: { type: "string", enum: ["platform", "capability", "vrf", "site", "role"] },
          direction: { type: "string", enum: ["TD", "TB", "LR", "RL", "BT"] },
          title: { type: "string" },
          storeData: { type: "boolean" },
          dataName: { type: "string" },
        },
        [],
      );
    case "exportTarget":
      return jsonBody(
        "The network document, or a wrapper. input is the document. path loads a workspace diagram or a .network.json file. mapping is optional rows or a mapping document. The body is at most 4 MiB.",
        {
          input: { description: "Canonical network document. Use this, or send the document as the body." },
          path: { type: "string", description: "Workspace path of a .mmd diagram or a .network.json file." },
          label: { type: "string", description: "Name used in the file. Defaults to the diagram stem, or nerdgram." },
          mapping: { description: "Optional mapping rows for this target, or a document keyed by exporter id." },
        },
        [],
      );
    default:
      return undefined;
  }
}

function operationParameters(operationId: string): Record<string, unknown>[] {
  switch (operationId) {
    case "listDiagrams":
    case "exportDiagrams":
    case "lintWorkspace":
      return [pathQuery];
    case "getDiagram":
      return [{ ...pathQuery, required: true }];
    case "searchDiagrams":
      return [
        { name: "q", in: "query", required: true, schema: { type: "string" } },
        { name: "names", in: "query", schema: { type: "string", enum: ["0", "1"] } },
        { name: "contents", in: "query", schema: { type: "string", enum: ["0", "1"] } },
        { name: "regex", in: "query", schema: { type: "string", enum: ["0", "1"] } },
      ];
    case "renderSavedDiagram":
      return [
        { ...pathQuery, required: true },
        { name: "format", in: "query", required: true, schema: { type: "string", enum: ["svg", "png"] } },
        { name: "background", in: "query", schema: { type: "string" } },
      ];
    case "deleteDiagram":
      return [{ ...pathQuery, required: false, description: "Path, if not sent in the JSON body." }];
    case "listHistory":
      return [{ ...pathQuery, required: true, description: "Diagram path ending in .mmd." }];
    case "convertSource": {
      const ids = loadedTranslatorIds();
      const schema: Record<string, unknown> = {
        type: "string",
        description: "Translator id. GET /api/v1/translators lists the installed ids.",
      };
      if (ids.length > 0) schema.enum = ids;
      return [{ name: "source", in: "path", required: true, schema }];
    }
    case "exportTarget": {
      const ids = loadedExporterIds();
      const schema: Record<string, unknown> = {
        type: "string",
        description: "Exporter id. GET /api/v1/exporters lists the installed ids.",
      };
      if (ids.length > 0) schema.enum = ids;
      return [{ name: "target", in: "path", required: true, schema }];
    }
    case "diffHistory":
      return [
        { ...pathQuery, required: true, description: "Diagram path ending in .mmd." },
        {
          name: "from",
          in: "query",
          required: true,
          schema: { type: "string" },
          description: "Revision id, baseline name, or current.",
        },
        {
          name: "to",
          in: "query",
          required: true,
          schema: { type: "string" },
          description: "Revision id, baseline name, or current.",
        },
      ];
    default:
      return [];
  }
}

export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of V1_ROUTES) {
    const specPath = openApiPath(route);
    const item = paths[specPath] ?? {};
    const successSchema = RESPONSE_SCHEMAS[route.operationId] ?? { type: "object" };
    const responses: Record<string, unknown> = {
      "200": route.operationId.startsWith("render")
        ? {
            description: "SVG or PNG bytes.",
            content: {
              "image/svg+xml": { schema: { type: "string", format: "binary" } },
              "image/png": { schema: { type: "string", format: "binary" } },
            },
          }
        : jsonSuccess(successSchema, route.operationId === "upsertDiagram" ? "Updated an existing generated diagram." : "Success."),
      "400": { description: "The request was rejected.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    };
    if (route.operationId === "convertSource") {
      responses["201"] = jsonSuccess(successSchema, "Created the diagram from the converted document.");
      responses["403"] = {
        description: "A read token cannot upsert. Convert without path is allowed.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
      responses["404"] = {
        description: "Unknown translator id.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
      responses["413"] = {
        description: "The export is larger than 4 MiB.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
    }
    if (route.operationId === "exportTarget") {
      responses["404"] = {
        description: "Unknown exporter id.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
      responses["413"] = {
        description: "The network document is larger than 4 MiB, or it has too many devices or links.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
    }
    if (route.operationId === "upsertDiagram" || route.operationId === "generateDiagram" || route.operationId === "createDiagram" || route.operationId === "duplicateDiagram" || route.operationId === "createFolder" || route.operationId === "createBaseline") {
      responses["201"] = jsonSuccess(
        successSchema,
        route.operationId === "upsertDiagram" ? "Created the generated diagram." : "Created.",
      );
    }
    if (route.scope !== "public") {
      responses["401"] = { description: "Missing, unknown, or revoked token.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    }
    if (route.scope === "write") {
      responses["403"] = { description: "The token is read-only.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
      responses["423"] = {
        description:
          "An editor lock is held. The body names the holding instance (instanceName, hostname, acquiredAt, heartbeatAt) when the lock has one.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
    }
    if (route.tag === "Render") {
      responses["429"] = { description: "Render rate limit.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    }
    const operation: Record<string, unknown> = {
      operationId: route.operationId,
      summary: route.summary,
      tags: [route.tag],
      security: route.scope === "public" ? [] : [{ bearerAuth: [] }],
      responses,
    };
    const parameters = operationParameters(route.operationId);
    if (parameters.length > 0) operation.parameters = parameters;
    const requestBody = operationBody(route.operationId);
    if (requestBody) {
      const examples = REQUEST_EXAMPLES[route.operationId];
      const media = (requestBody.content as { "application/json"?: { examples?: unknown } })["application/json"];
      if (examples && media && !media.examples) media.examples = examples;
      operation.requestBody = requestBody;
    }
    item[route.method] = operation;
    paths[specPath] = item;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "NerdGram1337 automation API",
      version: serverPackage.version,
      description:
        "Versioned API for scripts and CI. Browser routes under /api are unchanged and do not use these tokens. Tokens are created in Settings. The default bind is loopback. A Host setting or HOST can open a tool port on a trusted network. A token does not protect the browser routes.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Meta" },
      { name: "Diagrams" },
      { name: "Lint" },
      { name: "Render" },
      { name: "Generate" },
      { name: "Translators" },
      { name: "Exporters" },
      { name: "History" },
      { name: "Replace" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API token",
          description: "Authorization: Bearer ng_…  Scope is read or read-write. A read-write token can read.",
        },
      },
      schemas: {
        Error: errorSchema,
        ...SHARED_SCHEMAS,
        ...networkOpenApiSchemas(),
        ...graphOpenApiSchemas(),
      },
    },
    paths,
  };
}
