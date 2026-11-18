/**
 * Response bodies and request examples for the OpenAPI document.
 * Field names match the JSON the handlers return.
 */

const rowIssue = {
  type: "object",
  properties: {
    row: { type: "integer", description: "1-based source row. Omitted for a network JSON field." },
    message: { type: "string" },
    path: { type: "string", description: "JSON pointer, such as /devices/0/serial." },
  },
  required: ["message"],
};

const counts = {
  type: "object",
  properties: {
    nodes: { type: "integer" },
    edges: { type: "integer" },
    groups: { type: "integer" },
  },
  required: ["nodes", "edges", "groups"],
};

const diagramFile = {
  type: "object",
  properties: {
    path: { type: "string" },
    name: { type: "string" },
    content: { type: "string" },
    mtimeMs: { type: "number" },
    size: { type: "integer" },
    hash: { type: "string" },
  },
  required: ["path", "content"],
};

const writtenFile = {
  type: "object",
  properties: {
    path: { type: "string" },
    mtimeMs: { type: "number" },
    size: { type: "integer" },
    hash: { type: "string" },
    unchanged: { type: "boolean" },
  },
  required: ["path", "mtimeMs", "size", "hash"],
};

const revision = {
  type: "object",
  properties: {
    id: { type: "string" },
    createdAt: { type: "string" },
    mtimeMs: { type: "number" },
    size: { type: "integer" },
    hash: { type: "string" },
    name: { type: "string", nullable: true },
    note: { type: "string", nullable: true },
    namedAt: { type: "string", nullable: true },
  },
  required: ["id", "createdAt", "mtimeMs", "size", "hash"],
};

const treeNode = {
  type: "object",
  properties: {
    name: { type: "string" },
    path: { type: "string" },
    type: { type: "string", enum: ["file", "folder"] },
    mtimeMs: { type: "number" },
    size: { type: "integer" },
    children: { type: "array", items: { type: "object" } },
  },
  required: ["name", "path", "type", "mtimeMs"],
};

const generatedResult = {
  type: "object",
  properties: {
    path: { type: "string" },
    dataPath: { type: "string" },
    edgesPath: { type: "string" },
    mermaid: { type: "string" },
    counts,
    warnings: { type: "array", items: rowIssue },
    created: {
      type: "boolean",
      description: "True when this upsert created the diagram. False when it updated the generated block. Create-only generate omits this.",
    },
  },
  required: ["path", "mermaid", "counts", "warnings"],
};

const previewResult = {
  type: "object",
  properties: {
    format: { type: "string" },
    shape: { type: "string" },
    headers: { type: "array", items: { type: "string" } },
    edgesHeaders: { type: "array", items: { type: "string" } },
    mapping: { type: "object", additionalProperties: { type: "string" } },
    edgesMapping: { type: "object", additionalProperties: { type: "string" } },
    errors: { type: "array", items: rowIssue },
    warnings: { type: "array", items: rowIssue },
    model: { type: "object" },
    mermaid: { type: "string" },
    counts,
    direction: { type: "string" },
    grouping: { type: "boolean" },
    source: { type: "object" },
  },
  required: ["format", "shape", "mermaid", "counts", "errors", "warnings"],
};

const lintDiagnostic = {
  type: "object",
  properties: {
    ruleId: { type: "string" },
    severity: { type: "string", enum: ["error", "warning"] },
    message: { type: "string" },
    from: { type: "integer" },
    to: { type: "integer" },
    line: { type: "integer" },
    column: { type: "integer" },
    subject: { type: "string" },
    fixes: { type: "array", items: { type: "object" } },
  },
  required: ["ruleId", "severity", "message", "line", "column"],
};

export const RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  getOpenApi: { type: "object", description: "This OpenAPI 3.0 document." },
  getNetworkSchema: {
    type: "object",
    description:
      "JSON Schema for the network document. The same document as docs/schema/network.schema.json. $id is http://127.0.0.1:8787/api/v1/schema/network.json.",
  },
  getGraphSchema: {
    type: "object",
    description:
      "JSON Schema for generic nodes, edges, and links. $id is http://127.0.0.1:8787/api/v1/schema/graph.json.",
  },
  listDiagrams: {
    type: "object",
    properties: {
      path: { type: "string" },
      folders: { type: "array", items: treeNode },
      files: { type: "array", items: treeNode },
    },
    required: ["path", "folders", "files"],
  },
  searchDiagrams: {
    type: "object",
    properties: {
      query: { type: "string" },
      truncated: { type: "boolean" },
      hits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            name: { type: "string" },
            title: { type: "string", nullable: true },
            rank: { type: "number" },
            field: { type: "string" },
            element: { type: "string", nullable: true },
            label: { type: "string" },
            line: { type: "integer", nullable: true },
            snippet: { type: "string" },
            matchStart: { type: "integer" },
            matchLength: { type: "integer" },
          },
          required: ["path", "name", "snippet"],
        },
      },
    },
    required: ["query", "truncated", "hits"],
  },
  getDiagram: diagramFile,
  createDiagram: writtenFile,
  updateDiagram: writtenFile,
  renameDiagram: {
    type: "object",
    properties: {
      path: { type: "string" },
      updated: { type: "array", items: { type: "string" } },
      dataFiles: {
        type: "array",
        items: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" } },
          required: ["from", "to"],
        },
      },
    },
    required: ["path", "updated", "dataFiles"],
  },
  moveDiagram: {
    type: "object",
    properties: {
      path: { type: "string" },
      updated: { type: "array", items: { type: "string" } },
      dataFiles: { type: "array", items: { type: "object" } },
    },
    required: ["path", "updated"],
  },
  duplicateDiagram: {
    type: "object",
    properties: {
      path: { type: "string" },
      type: { type: "string", enum: ["file", "folder"] },
      dataFiles: { type: "array", items: { type: "object" } },
    },
    required: ["path", "type"],
  },
  deleteDiagram: {
    type: "object",
    properties: {
      path: { type: "string" },
      trashed: { type: "boolean" },
      message: { type: "string" },
      dataKept: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: { type: "string" },
            diagrams: { type: "array", items: { type: "string" } },
          },
          required: ["file", "diagrams"],
        },
      },
    },
    required: ["path", "trashed"],
  },
  createFolder: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  exportDiagrams: {
    type: "object",
    properties: {
      path: { type: "string" },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    },
    required: ["path", "files"],
  },
  previewLinkRepairs: { $ref: "#/components/schemas/LinkRepairPlan" },
  applyLinkRepairs: { $ref: "#/components/schemas/LinkRepairPlan" },
  lintWorkspace: {
    type: "object",
    description: "One diagram returns path and diagnostics. The whole workspace returns checked, diagrams, and unreadable.",
    properties: {
      path: { type: "string" },
      diagnostics: { type: "array", items: lintDiagnostic },
      checked: { type: "integer" },
      diagrams: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            diagnostics: { type: "array", items: lintDiagnostic },
          },
          required: ["path", "diagnostics"],
        },
      },
      unreadable: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            code: { type: "string" },
            message: { type: "string" },
          },
          required: ["path", "code", "message"],
        },
      },
    },
  },
  lintSource: {
    type: "object",
    properties: { diagnostics: { type: "array", items: lintDiagnostic } },
    required: ["diagnostics"],
  },
  previewGenerate: previewResult,
  generateDiagram: generatedResult,
  upsertDiagram: generatedResult,
  refreshDiagram: {
    type: "object",
    properties: {
      path: { type: "string" },
      mermaid: { type: "string" },
      saved: { type: "boolean" },
      mtimeMs: { type: "number" },
      hash: { type: "string" },
      counts: counts,
      warnings: { type: "array", items: rowIssue },
    },
    required: ["path", "mermaid", "saved"],
  },
  listHistory: {
    type: "object",
    properties: {
      path: { type: "string" },
      retention: { type: "integer" },
      baselineCap: { type: "integer" },
      baselineCount: { type: "integer" },
      revisions: { type: "array", items: revision },
    },
    required: ["path", "retention", "revisions"],
  },
  diffHistory: {
    type: "object",
    properties: {
      path: { type: "string" },
      semantic: { type: "boolean" },
      diagramType: { type: "string" },
      from: { type: "object" },
      to: { type: "object" },
      text: { type: "object" },
      nodes: { type: "object" },
      edges: { type: "object" },
    },
    required: ["path", "from", "to"],
  },
  createBaseline: revision,
  updateBaseline: revision,
  deleteBaseline: {
    type: "object",
    properties: {
      path: { type: "string" },
      id: { type: "string" },
      pruned: { type: "boolean" },
      revision: { nullable: true },
    },
    required: ["path", "id", "pruned"],
  },
  previewReplace: { type: "object", description: "Find-and-replace preview. files lists matches. Nothing is written." },
  applyReplace: {
    type: "object",
    properties: {
      operationId: { type: "string", nullable: true },
      changed: { type: "array", items: { type: "object" } },
      skipped: { type: "array", items: { type: "object" } },
      errors: { type: "array", items: { type: "object" } },
      totals: { type: "object" },
    },
    required: ["changed", "skipped", "errors", "totals"],
  },
  undoReplace: {
    type: "object",
    properties: {
      id: { type: "string" },
      restored: { type: "array", items: { type: "object" } },
      skipped: { type: "array", items: { type: "object" } },
      errors: { type: "array", items: { type: "object" } },
    },
    required: ["id", "restored", "skipped", "errors"],
  },
};

export const SHARED_SCHEMAS: Record<string, unknown> = {
  LinkRepairPlan: {
    type: "object",
    properties: {
      suggestions: { type: "array", items: { type: "object" } },
      changes: { type: "array", items: { type: "object" } },
      dataFiles: { type: "array", items: { type: "object" } },
      applied: { type: "boolean" },
      saved: { type: "array", items: { type: "string" } },
    },
    required: ["suggestions", "changes", "dataFiles", "applied", "saved"],
  },
};

const networkExample = {
  schemaVersion: 1,
  format: "network",
  devices: [
    { name: "core", platform: "ios-xe", role: "router", site: "HQ" },
    { name: "dist", platform: "nxos", role: "switch", site: "HQ" },
  ],
  interfaces: [
    { device: "core", name: "Gi0/0", description: "to dist", ipv4: [{ address: "10.0.0.1", prefix: 30 }] },
    { device: "dist", name: "Gi0/1", description: "to core", ipv4: [{ address: "10.0.0.2", prefix: 30 }] },
  ],
  links: [{ a: { device: "core", interface: "Gi0/0" }, b: { device: "dist", interface: "Gi0/1" }, label: "uplink" }],
};

const networkText = JSON.stringify(networkExample);

export const REQUEST_EXAMPLES: Record<string, Record<string, { summary: string; value: unknown }>> = {
  createDiagram: {
    flowchart: {
      summary: "Create a flowchart",
      value: { path: "WAN.mmd", content: "flowchart LR\n  A-->B\n" },
    },
  },
  updateDiagram: {
    overwrite: {
      summary: "Overwrite an existing diagram",
      value: { path: "WAN.mmd", content: "flowchart LR\n  A-->B\n", force: true },
    },
  },
  renameDiagram: {
    rename: { summary: "Rename a diagram", value: { from: "WAN.mmd", to: "Edge.mmd" } },
  },
  moveDiagram: {
    move: { summary: "Move into a folder", value: { from: "Edge.mmd", toFolder: "Sites" } },
  },
  duplicateDiagram: {
    copy: { summary: "Duplicate and copy the data file", value: { path: "Campus-L3.mmd", copyData: true } },
  },
  deleteDiagram: {
    trash: { summary: "Trash a diagram and its data file", value: { path: "Notes.mmd", deleteData: true } },
  },
  createFolder: {
    folder: { summary: "Create a folder", value: { path: "Sites" } },
  },
  lintSource: {
    source: { summary: "Lint unsaved source", value: { source: "flowchart LR\n  A-->B\n" } },
  },
  renderDiagram: {
    svg: { summary: "Render posted source to SVG", value: { source: "flowchart LR\n  A-->B\n", format: "svg" } },
  },
  previewGenerate: {
    networkLayer2: {
      summary: "Preview a network document grouped by platform",
      value: {
        format: "network",
        view: "l2",
        groupBy: "platform",
        text: networkText,
      },
    },
    genericGraph: {
      summary: "Preview a generic nodes and edges document",
      value: {
        format: "json",
        text: JSON.stringify({
          nodes: [{ id: "core", label: "Core" }],
          edges: [{ source: "core", target: "edge", label: "uplink" }],
        }),
      },
    },
  },
  generateDiagram: {
    networkCreate: {
      summary: "Create-only. 409 when the path exists.",
      value: { path: "Campus-L3.mmd", format: "network", view: "l3", text: networkText },
    },
  },
  upsertDiagram: {
    networkCreateOrUpdate: {
      summary: "Create the diagram, or update it on the next post of the same path",
      value: {
        path: "Campus-L2.mmd",
        format: "network",
        view: "l2",
        groupBy: "platform",
        text: networkText,
      },
    },
    groupBySite: {
      summary: "Layer 2 grouped by site",
      value: { path: "Campus-L2.mmd", format: "network", view: "l2", groupBy: "site", text: networkText },
    },
  },
  refreshDiagram: {
    save: {
      summary: "Refresh from posted text and write the diagram",
      value: { path: "Campus-L3.mmd", text: networkText, save: true, writeData: true },
    },
  },
  applyLinkRepairs: {
    preview: { summary: "Preview repairs", value: { dryRun: true } },
    apply: { summary: "Apply the preview", value: { dryRun: false, confirm: true } },
  },
  createBaseline: {
    name: { summary: "Save the current diagram as a baseline", value: { path: "WAN.mmd", name: "before-change" } },
  },
  updateBaseline: {
    note: { summary: "Set a baseline note", value: { path: "WAN.mmd", id: "rev-id", note: "Checked the edge." } },
  },
  deleteBaseline: {
    clear: { summary: "Remove a baseline name", value: { path: "WAN.mmd", id: "rev-id" } },
  },
  previewReplace: {
    find: { summary: "Preview a replace", value: { find: "Core", replace: "HQ-Core" } },
  },
  applyReplace: {
    apply: {
      summary: "Apply one file from the preview",
      value: { find: "Core", replace: "HQ-Core", files: [{ path: "WAN.mmd", hash: "preview-hash" }] },
    },
  },
  undoReplace: {
    undo: { summary: "Undo a replace", value: { id: "replace-id" } },
  },
};

export function jsonSuccess(schema: Record<string, unknown>, description = "Success."): Record<string, unknown> {
  return { description, content: { "application/json": { schema } } };
}
