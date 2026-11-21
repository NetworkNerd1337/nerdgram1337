import { createRequire } from "node:module";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { TokenScope } from "../tokens.js";
import type { GenerateArgs, McpBackend, RefreshArgs } from "./backend.js";
import { toolCall, toolFailure, writeRenderPng } from "./result.js";

const require = createRequire(import.meta.url);
const serverPackage = require("../../package.json") as { version: string };

const PATH_RULES =
  "path is a workspace path such as Sites/Campus.mmd. It stays inside the data directory. A hidden path, .meta, a null byte, or a path that escapes the data directory is rejected. A diagram file ends in .mmd.";

const MERMAID_RULES =
  "content is Mermaid source. A flowchart is the usual diagram. YAML front matter, when present, sits between --- lines at the top. Lint with nerdgram_lint before saving. A diagram that would not parse should not be written.";

const SAVE_RULES =
  "Use nerdgram_create when the path must not already exist. Use nerdgram_put to overwrite Mermaid source, and pass expectedHash from nerdgram_get so a file that changed on disk is a conflict. Use nerdgram_generate, nerdgram_upsert, or nerdgram_refresh for CSV, JSON, CDP, LLDP, or network data. Those take the raw text in data, not a file path on this computer. Upsert keeps notes outside the generated markers. Generate fails when the path exists. Refresh rewrites only the generated block of a diagram that was built from data.";

export type McpToolScope = "read" | "write";

export type McpToolAnnotation = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
};

export type McpToolCatalogEntry = {
  name: string;
  scope: McpToolScope;
  title: string;
  annotations: McpToolAnnotation;
};

const readHints: McpToolAnnotation = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const writeHints: McpToolAnnotation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const destructiveHints: McpToolAnnotation = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const formatSchema = z
  .enum(["csv", "json", "cdp", "lldp", "network", "route"])
  .describe(
    "csv, json, cdp, lldp, network, or route. cdp and lldp are raw neighbor command output. network is network JSON. route is Cisco show ip route text.",
  );

const generateFields = {
  path: z.string().describe(`Diagram path to create. ${PATH_RULES}`),
  data: z.string().describe("The raw CSV, JSON, CDP, LLDP, or network JSON text. Paste command output here. This is not a file path."),
  format: formatSchema,
  view: z.enum(["l3", "l2"]).optional().describe("Required when format is network. l3 is subnets. l2 is VLANs, trunks, and LAGs. Ignored for other formats."),
  includeDown: z.boolean().optional().describe("Draw shutdown and down interfaces. Off by default."),
  vlan: z.number().int().optional().describe("Layer 2 only. Keep links that carry this VLAN id, from 1 to 4094."),
  direction: z.string().optional().describe("Mermaid flowchart direction, such as LR or TB."),
  groupBy: z.string().optional().describe("cdp and lldp: platform or capability. network l3: vrf. network l2: site, role, or platform."),
  localDevice: z.string().optional().describe("Local device name when a CDP, LLDP, or routing-table paste has no prompt."),
  hosts: z
    .enum(["ports", "port-counts", "vlan-counts"])
    .optional()
    .describe("Routing tables only. ports places each host. port-counts and vlan-counts draw a count instead. ARP alone never infers links."),
  title: z.string().optional().describe("Diagram title."),
  edgesText: z.string().optional().describe("Optional second table of edges, as text."),
  storeData: z.boolean().optional().describe("Write the data file beside the diagram. Default is true."),
};

function asGenerate(args: Record<string, unknown>): GenerateArgs {
  return args as GenerateArgs;
}

function asRefresh(args: Record<string, unknown>): RefreshArgs {
  return { path: String(args.path), data: typeof args.data === "string" ? args.data : undefined, edgesText: typeof args.edgesText === "string" ? args.edgesText : undefined };
}

type ToolDef = {
  name: string;
  scope: McpToolScope;
  title: string;
  description: string;
  annotations: McpToolAnnotation;
  inputSchema: Record<string, z.ZodType>;
  run: (backend: McpBackend, args: Record<string, unknown>) => Promise<CallToolResult>;
};

const replaceFields = {
  find: z.string().describe("Text to find."),
  replace: z.string().describe("Replacement text. An empty string deletes the match."),
  matchCase: z.boolean().optional().describe("Match case. Default is false."),
  wholeWord: z.boolean().optional().describe("Match a whole word. Default is false."),
  regex: z.boolean().optional().describe("Treat find as a regular expression. Default is false."),
  includeFrontMatter: z.boolean().optional().describe("Also search YAML front matter. Default is the diagram body only."),
  scope: z
    .object({
      folder: z.string().optional().describe("Limit the search to this workspace folder."),
      recursive: z.boolean().optional().describe("Include subfolders. Default is true."),
      paths: z.array(z.string()).optional().describe("Only these diagram paths."),
    })
    .optional()
    .describe("Where to search. Hidden files, .meta, trash, and templates are skipped."),
};

const TOOLS: ToolDef[] = [
  {
    name: "nerdgram_list",
    scope: "read",
    title: "List diagrams",
    annotations: readHints,
    description: `List folders and diagrams in one workspace folder. An empty path is the root. ${PATH_RULES} The result is the folder listing, not file contents. Use nerdgram_get to read a diagram.`,
    inputSchema: {
      path: z.string().optional().describe("Folder path. Omit or pass an empty string for the workspace root."),
    },
    run: (backend, args) => toolCall(() => backend.list(typeof args.path === "string" ? args.path : "")),
  },
  {
    name: "nerdgram_search",
    scope: "read",
    title: "Search diagrams",
    annotations: readHints,
    description:
      "Search diagram names and text. q is required. names true searches names only. contents false skips diagram text and still searches titles, tags, descriptions, and notes. regex true treats q as a regular expression. Trash is not searched.",
    inputSchema: {
      q: z.string().describe("Search text."),
      names: z.boolean().optional().describe("Search file names and paths only."),
      contents: z.boolean().optional().describe("Search diagram text. Default is true."),
      regex: z.boolean().optional().describe("Treat q as a regular expression."),
    },
    run: (backend, args) =>
      toolCall(() =>
        backend.search({
          q: String(args.q ?? ""),
          names: args.names === true,
          contents: args.contents !== false,
          regex: args.regex === true,
        }),
      ),
  },
  {
    name: "nerdgram_get",
    scope: "read",
    title: "Read a diagram",
    annotations: readHints,
    description: `Read one diagram. The result includes the Mermaid source and the content hash. Pass that hash as expectedHash to nerdgram_put. ${PATH_RULES}`,
    inputSchema: { path: z.string().describe(PATH_RULES) },
    run: (backend, args) => toolCall(() => backend.get(String(args.path))),
  },
  {
    name: "nerdgram_export",
    scope: "read",
    title: "Export diagram source",
    annotations: readHints,
    description: `Read every diagram under a folder, including the Mermaid source. An empty path is the whole workspace. A folder that is too large is rejected. ${PATH_RULES} This is not a lab or inventory export.`,
    inputSchema: { path: z.string().optional().describe("Folder path. Omit for the whole workspace.") },
    run: (backend, args) => toolCall(() => backend.exportFolder(typeof args.path === "string" ? args.path : "")),
  },
  {
    name: "nerdgram_lint",
    scope: "read",
    title: "Lint Mermaid",
    annotations: readHints,
    description: `Lint Mermaid before saving. Pass path to lint a saved diagram, or source to lint text that is not saved. Do not send both. Omit both to lint the workspace. Warnings are omitted when the file contains %% nerdgram: warnings=muted. Errors stay. ${MERMAID_RULES}`,
    inputSchema: {
      path: z.string().optional().describe("Saved diagram to lint."),
      source: z.string().optional().describe("Mermaid source that is not necessarily saved."),
    },
    run: (backend, args) =>
      toolCall(() =>
        backend.lint({
          path: typeof args.path === "string" ? args.path : undefined,
          source: typeof args.source === "string" ? args.source : undefined,
        }),
      ),
  },
  {
    name: "nerdgram_render",
    scope: "read",
    title: "Render a diagram",
    annotations: readHints,
    description:
      "Render a saved diagram or Mermaid source. format is svg or png. Send path or source, not both. SVG comes back as text. PNG is written to a file and returned as a path and a resource link, not as base64. background is a CSS hex color. More than 30 renders a minute for one token is refused.",
    inputSchema: {
      path: z.string().optional().describe("Saved diagram to render."),
      source: z.string().optional().describe("Mermaid source to render without reading a file."),
      format: z.enum(["svg", "png"]).describe("svg returns text. png returns a file path."),
      background: z.string().optional().describe("CSS hex background color."),
    },
    run: async (backend, args) => {
      try {
        const rendered = await backend.render({
          path: typeof args.path === "string" ? args.path : undefined,
          source: typeof args.source === "string" ? args.source : undefined,
          format: args.format === "png" ? "png" : "svg",
          background: typeof args.background === "string" ? args.background : undefined,
        });
        if (rendered.format === "svg") {
          return { content: [{ type: "text", text: rendered.svg }] };
        }
        const file = await writeRenderPng(rendered.png);
        return {
          content: [
            { type: "text", text: `PNG written to ${file.filePath}` },
            { type: "resource_link", uri: file.uri, name: "diagram.png", mimeType: "image/png" },
          ],
        };
      } catch (err) {
        return toolFailure(err);
      }
    },
  },
  {
    name: "nerdgram_history",
    scope: "read",
    title: "List revisions",
    annotations: readHints,
    description: `List revisions for one diagram, including baseline name and note. The file is not modified. ${PATH_RULES}`,
    inputSchema: { path: z.string().describe(PATH_RULES) },
    run: (backend, args) => toolCall(() => backend.history(String(args.path))),
  },
  {
    name: "nerdgram_diff",
    scope: "read",
    title: "Diff revisions",
    annotations: readHints,
    description:
      "Diff two revisions, or a revision and the current diagram. from and to are a revision id, a baseline name, or current. The file is not modified.",
    inputSchema: {
      path: z.string().describe(PATH_RULES),
      from: z.string().describe("Revision id, baseline name, or current."),
      to: z.string().describe("Revision id, baseline name, or current."),
    },
    run: (backend, args) =>
      toolCall(() => backend.diff({ path: String(args.path), from: String(args.from), to: String(args.to) })),
  },
  {
    name: "nerdgram_create",
    scope: "write",
    title: "Create a diagram",
    annotations: writeHints,
    description: `Create a diagram. Fails when the path already exists. ${PATH_RULES} ${MERMAID_RULES} ${SAVE_RULES}`,
    inputSchema: {
      path: z.string().describe(PATH_RULES),
      content: z.string().describe(MERMAID_RULES),
    },
    run: (backend, args) => toolCall(() => backend.create({ path: String(args.path), content: String(args.content) })),
  },
  {
    name: "nerdgram_put",
    scope: "write",
    title: "Overwrite a diagram",
    annotations: destructiveHints,
    description: `Overwrite a diagram. This replaces the file. Pass expectedHash from nerdgram_get. A hash that does not match the file on disk is a conflict and nothing is written. Omitting expectedHash overwrites whatever is there. The previous text is kept as a revision. ${PATH_RULES} ${MERMAID_RULES} ${SAVE_RULES}`,
    inputSchema: {
      path: z.string().describe(PATH_RULES),
      content: z.string().describe(MERMAID_RULES),
      expectedHash: z.string().optional().describe("Content hash from nerdgram_get. A mismatch is a conflict."),
    },
    run: (backend, args) =>
      toolCall(() =>
        backend.put({
          path: String(args.path),
          content: String(args.content),
          expectedHash: typeof args.expectedHash === "string" ? args.expectedHash : undefined,
        }),
      ),
  },
  {
    name: "nerdgram_mkdir",
    scope: "write",
    title: "Create a folder",
    annotations: writeHints,
    description: `Create a workspace folder. Fails when that folder already exists. ${PATH_RULES}`,
    inputSchema: { path: z.string().describe("Folder path to create.") },
    run: (backend, args) => toolCall(() => backend.mkdir(String(args.path))),
  },
  {
    name: "nerdgram_rename",
    scope: "write",
    title: "Rename a diagram",
    annotations: writeHints,
    description: `Rename a diagram or folder. Click links that point at it are updated unless updateLinks is false. A sibling CSV, JSON, network JSON, CDP, or LLDP file moves with a diagram, and nerdgram.source is updated. ${PATH_RULES}`,
    inputSchema: {
      from: z.string().describe("Current path."),
      to: z.string().describe("New path."),
      updateLinks: z.boolean().optional().describe("Update click links. Default is true."),
    },
    run: (backend, args) =>
      toolCall(() =>
        backend.rename({
          from: String(args.from),
          to: String(args.to),
          updateLinks: typeof args.updateLinks === "boolean" ? args.updateLinks : undefined,
        }),
      ),
  },
  {
    name: "nerdgram_move",
    scope: "write",
    title: "Move a diagram",
    annotations: writeHints,
    description: `Move a diagram or folder into toFolder. An empty toFolder is the workspace root. Click links are updated unless updateLinks is false. A sibling data file moves with the diagram. Moving into the folder the item is already in is a conflict. ${PATH_RULES}`,
    inputSchema: {
      from: z.string().describe("Path to move."),
      toFolder: z.string().optional().describe("Destination folder. Empty is the workspace root."),
      updateLinks: z.boolean().optional().describe("Update click links. Default is true."),
    },
    run: (backend, args) =>
      toolCall(() =>
        backend.move({
          from: String(args.from),
          toFolder: typeof args.toFolder === "string" ? args.toFolder : "",
          updateLinks: typeof args.updateLinks === "boolean" ? args.updateLinks : undefined,
        }),
      ),
  },
  {
    name: "nerdgram_duplicate",
    scope: "write",
    title: "Duplicate a diagram",
    annotations: writeHints,
    description:
      "Duplicate a diagram or folder. The copy does not keep history. Omit to and the copy is Name (copy), then Name (copy 2), beside the original. to is an optional workspace path for the copy. A path that already exists is a conflict and nothing is written. When a sibling data file exists, copyData is required: true copies the data file, false keeps both diagrams on the original file. Omitting it is a conflict that names the file.",
    inputSchema: {
      path: z.string().describe(PATH_RULES),
      to: z
        .string()
        .optional()
        .describe("Workspace path for the copy. Omit it to use Name (copy). An existing path is a conflict."),
      copyData: z.boolean().optional().describe("Required when a sibling data file exists."),
    },
    run: (backend, args) =>
      toolCall(() =>
        backend.duplicate({
          path: String(args.path),
          to: typeof args.to === "string" ? args.to : undefined,
          copyData: typeof args.copyData === "boolean" ? args.copyData : undefined,
        }),
      ),
  },
  {
    name: "nerdgram_trash",
    scope: "write",
    title: "Move to trash",
    annotations: destructiveHints,
    description:
      "Move a diagram or folder to the trash. This is destructive. When a sibling data file exists, deleteData is required: true trashes that file too, false leaves it. A data file another diagram still uses is kept, and the result names that diagram. confirmLinks defaults to true.",
    inputSchema: {
      path: z.string().describe(PATH_RULES),
      deleteData: z.boolean().optional().describe("Required when a sibling data file exists."),
      confirmLinks: z.boolean().optional().describe("Update links that pointed here. Default is true."),
    },
    run: (backend, args) =>
      toolCall(() =>
        backend.trash({
          path: String(args.path),
          deleteData: typeof args.deleteData === "boolean" ? args.deleteData : undefined,
          confirmLinks: typeof args.confirmLinks === "boolean" ? args.confirmLinks : undefined,
        }),
      ),
  },
  {
    name: "nerdgram_generate",
    scope: "write",
    title: "Generate a diagram",
    annotations: writeHints,
    description: `Create a diagram from data. Fails when the path already exists. Use nerdgram_upsert to update an existing generated diagram. data is raw CSV, JSON, CDP, LLDP, routing table, or network JSON text, not a file path. ${PATH_RULES} ${SAVE_RULES}`,
    inputSchema: generateFields,
    run: (backend, args) => toolCall(() => backend.generate(asGenerate(args))),
  },
  {
    name: "nerdgram_upsert",
    scope: "write",
    title: "Create or update a generated diagram",
    annotations: writeHints,
    description: `Create a generated diagram, or update its generated block and the sibling data file when the path exists. Notes outside the generated markers stay. Fails when the file exists and was not generated from data. data is raw text, not a file path. ${SAVE_RULES}`,
    inputSchema: generateFields,
    run: (backend, args) => toolCall(() => backend.upsert(asGenerate(args))),
  },
  {
    name: "nerdgram_refresh",
    scope: "write",
    title: "Refresh a generated diagram",
    annotations: writeHints,
    description:
      "Replace the generated block of an existing diagram and save it, so the previous text is a revision. data is the new raw text. Omit data to reread the stored data file. format and view are already in the diagram and are not arguments. A device or link left out of the new data drops off the diagram. Notes outside the generated markers stay.",
    inputSchema: {
      path: z.string().describe("Generated diagram to refresh."),
      data: z.string().optional().describe("Replacement raw CSV, JSON, CDP, LLDP, or network JSON. Omit to use the stored data file."),
      edgesText: z.string().optional().describe("Replacement edges table, when the diagram has one."),
    },
    run: (backend, args) => toolCall(() => backend.refresh(asRefresh(args))),
  },
  {
    name: "nerdgram_replace_preview",
    scope: "write",
    title: "Preview find and replace",
    annotations: { ...readHints, idempotentHint: true },
    description:
      "Preview a find and replace. Nothing is written. The result lists each diagram, its hash, and the matches. Pass that hash back to nerdgram_replace_apply for the diagrams you want to change. A match in a node id, a click target, or a path is called out. Hidden files, .meta, trash, and templates are skipped.",
    inputSchema: replaceFields,
    run: (backend, args) => toolCall(() => backend.replacePreview(args)),
  },
  {
    name: "nerdgram_replace_apply",
    scope: "write",
    title: "Apply find and replace",
    annotations: destructiveHints,
    description:
      "Apply a previewed find and replace. This rewrites every listed diagram and saves a revision first. Pass the same find and replace as the preview, and files from that preview (path and hash, and skipMatchIds for matches to leave). A file that changed since the preview is skipped. This is destructive.",
    inputSchema: {
      ...replaceFields,
      files: z
        .array(
          z.object({
            path: z.string(),
            hash: z.string().describe("Hash from the preview. A mismatch skips the file."),
            skipMatchIds: z.array(z.string()).optional().describe("Match ids from the preview to leave unchanged."),
          }),
        )
        .describe("Diagrams to change, copied from the preview."),
    },
    run: (backend, args) => toolCall(() => backend.replaceApply(args)),
  },
  {
    name: "nerdgram_baseline",
    scope: "write",
    title: "Save a baseline",
    annotations: writeHints,
    description:
      "Name the current diagram as a baseline, or name an existing revision when id is set. Names are kept when the 20-revision limit drops older saves. This does not rename or delete a baseline.",
    inputSchema: {
      path: z.string().describe(PATH_RULES),
      name: z.string().optional().describe("Baseline name. Required when id is omitted."),
      note: z.string().optional().describe("Note stored with the baseline."),
      id: z.string().optional().describe("Existing revision id to name, instead of saving the current diagram."),
    },
    run: (backend, args) =>
      toolCall(() =>
        backend.baseline({
          path: String(args.path),
          name: typeof args.name === "string" ? args.name : undefined,
          note: typeof args.note === "string" ? args.note : undefined,
          id: typeof args.id === "string" ? args.id : undefined,
        }),
      ),
  },
];

export const MCP_TOOL_CATALOG: readonly McpToolCatalogEntry[] = TOOLS.map((tool) => ({
  name: tool.name,
  scope: tool.scope,
  title: tool.title,
  annotations: tool.annotations,
}));

export const READ_TOOL_NAMES = MCP_TOOL_CATALOG.filter((tool) => tool.scope === "read").map((tool) => tool.name);
export const WRITE_TOOL_NAMES = MCP_TOOL_CATALOG.filter((tool) => tool.scope === "write").map((tool) => tool.name);

function visibleTools(scope: TokenScope): ToolDef[] {
  if (scope === "read-write") return TOOLS;
  return TOOLS.filter((tool) => tool.scope === "read");
}

export function createNerdgramMcpServer(options: { scope: TokenScope; backend: McpBackend }): McpServer {
  const server = new McpServer(
    { name: "nerdgram", version: serverPackage.version },
    {
      instructions: `${PATH_RULES} ${MERMAID_RULES} ${SAVE_RULES}`,
    },
  );

  for (const tool of visibleTools(options.scope)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => tool.run(options.backend, args as Record<string, unknown>),
    );
  }

  server.registerResource(
    "diagram",
    new ResourceTemplate("nerdgram://diagram/{+path}", {
      list: async () => {
        const paths = await options.backend.diagramPaths();
        return {
          resources: paths.map((filePath) => ({
            uri: diagramUri(filePath),
            name: filePath,
            mimeType: "text/plain",
          })),
        };
      },
    }),
    {
      description: `A saved Mermaid diagram. ${PATH_RULES}`,
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const filePath = resourcePath(variables.path);
      const file = await options.backend.get(filePath);
      const content = file && typeof file === "object" && "content" in file ? String((file as { content: unknown }).content) : "";
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: content }] };
    },
  );

  server.registerPrompt(
    "diagram_from_lldp",
    {
      title: "Diagram from LLDP",
      description:
        "Turn raw LLDP neighbor output into a NerdGram diagram. In NetClaw this prompt is the skill mcp__nerdgram__diagram_from_lldp.",
      argsSchema: {
        path: z.string().describe("Workspace path ending in .mmd, such as Network/Core.mmd."),
        text: z.string().describe("Raw LLDP output from one or more devices, one after another."),
        local_device: z.string().optional().describe("Local device name when the paste has no prompt."),
      },
    },
    async (args) => ({
      description: "Create or update a diagram from LLDP text.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Build a NerdGram diagram from this LLDP output.",
              "Call nerdgram_upsert with format lldp. data is the raw text below, not a file path.",
              `path: ${args.path}`,
              args.local_device ? `localDevice: ${args.local_device}` : "Omit localDevice when a device prompt is in the paste.",
              "Lint is not required before upsert. The generator writes the Mermaid.",
              "If the path must not already exist, call nerdgram_generate instead. That fails when the path exists.",
              "",
              args.text,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "lint_and_fix",
    {
      title: "Lint and fix",
      description:
        "Lint a diagram and fix errors before saving. In NetClaw this prompt is the skill mcp__nerdgram__lint_and_fix.",
      argsSchema: {
        path: z.string().describe("Workspace path of the diagram to check."),
      },
    },
    async (args) => ({
      description: "Lint a diagram and save a fix only when the lint is clean.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Lint ${args.path} with nerdgram_lint.`,
              "Read it with nerdgram_get and keep the content hash.",
              "Fix errors in the Mermaid. Do not invent devices that are not already in the file.",
              "Lint the edited source with nerdgram_lint before writing.",
              "Save with nerdgram_put and expectedHash from the get. A conflict means the file changed. Read it again instead of forcing the write.",
              "Do not call nerdgram_trash.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

function diagramUri(filePath: string): string {
  const encoded = filePath.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `nerdgram://diagram/${encoded}`;
}

function resourcePath(value: unknown): string {
  const raw = Array.isArray(value) ? value.join("/") : String(value ?? "");
  return raw.split("/").map((part) => decodeURIComponent(part)).join("/");
}
