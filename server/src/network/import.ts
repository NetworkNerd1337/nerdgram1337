import {
  dataFail,
  graphNodeId,
  renderNewDiagram,
  type DataSourceConfig,
  type FlowDirection,
  type GraphModel,
  type ImportInput,
  type ImportResult,
  type NetworkGroupBy,
  type NetworkView,
  type RowIssue,
} from "../diagramData.js";
import { buildNetwork, type BuiltEdge, type BuiltNode } from "./generate.js";
import { validateNetwork } from "./validate.js";

const VIEWS = new Set<NetworkView>(["l3", "l2"]);
const GROUPS = new Set<NetworkGroupBy>(["vrf", "site", "role", "platform"]);

export function importNetworkFormat(input: ImportInput, text: string): ImportResult {
  const view = resolveView(input.view);
  const groupBy = resolveNetworkGroup(input.groupBy);
  const includeDown = input.includeDown === true;
  const vlan = resolveVlan(input.vlan, view);
  const direction = resolveDirection(input.direction);
  const grouping = input.grouping !== false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw dataFail(400, "This is not valid JSON.", "invalid");
  }
  const validated = validateNetwork(parsed);
  const errors = issues(validated.issues);
  const warnings: RowIssue[] = [];
  let model: GraphModel = { nodes: [], edges: [] };
  if (validated.document && errors.length === 0) {
    const built = buildNetwork(validated.document, {
      view,
      includeDown,
      groupBy,
      vlan,
      grouping,
      localDevice: cleanLocalDevice(input.localDevice),
    });
    errors.push(...built.errors);
    warnings.push(...built.warnings);
    if (errors.length === 0) model = toModel(built.nodes, built.edges);
  }
  if (errors.length === 0 && model.nodes.length === 0 && model.edges.length === 0) {
    errors.push({ row: 0, message: "No devices were found." });
  }
  const usable = errors.length === 0 ? model : { nodes: [], edges: [] };
  const source = networkSource(input, { view, direction, grouping, groupBy, includeDown, vlan, localDevice: cleanLocalDevice(input.localDevice) });
  const mermaid =
    errors.length === 0
      ? renderNewDiagram({
          model: usable,
          source,
          title: clipTitle(input.title),
          description: clipTitle(input.description) || (source.file ? `Generated from ${source.file}` : undefined),
        })
      : "";
  return {
    format: "network",
    shape: "links",
    headers: [],
    edgesHeaders: [],
    mapping: {},
    edgesMapping: {},
    errors,
    warnings,
    model: usable,
    mermaid,
    counts: {
      nodes: usable.nodes.length,
      edges: usable.edges.length,
      groups: new Set(usable.nodes.map((node) => node.group).filter(Boolean)).size,
    },
    direction,
    grouping,
    source,
  };
}

function toModel(nodes: BuiltNode[], edges: BuiltEdge[]): GraphModel {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  const ordered = [...nodes].sort((a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key));
  for (const node of ordered) ids.set(node.key, graphNodeId(node.key, used));
  return {
    nodes: ordered.map((node) => ({
      id: ids.get(node.key) ?? node.key,
      label: node.label,
      group: node.group,
      className: node.className,
      diagram: node.diagram,
    })),
    edges: edges.map((edge) => ({
      source: ids.get(edge.source) ?? edge.source,
      target: ids.get(edge.target) ?? edge.target,
      label: edge.label,
    })),
  };
}

function networkSource(
  input: ImportInput,
  options: {
    view: NetworkView;
    direction: FlowDirection;
    grouping: boolean;
    groupBy: NetworkGroupBy | "";
    includeDown: boolean;
    vlan: number | null;
    localDevice: string;
  },
): DataSourceConfig {
  const source: DataSourceConfig = {
    file: cleanStoredName(input.sourceFile) || "data.network.json",
    format: "network",
    shape: "links",
    mapping: {},
    direction: options.direction,
    grouping: options.grouping,
    diagramType: "flowchart",
    view: options.view,
    includeDown: options.includeDown,
  };
  if (options.groupBy) source.groupBy = options.groupBy;
  if (options.vlan != null) source.vlan = options.vlan;
  if (options.localDevice) source.localDevice = options.localDevice;
  return source;
}

function resolveView(value: string | undefined): NetworkView {
  const raw = value?.trim().toLowerCase() ?? "";
  if (!VIEWS.has(raw as NetworkView)) throw dataFail(400, "view must be l3 or l2.", "invalid");
  return raw as NetworkView;
}

function resolveNetworkGroup(value: string | undefined): NetworkGroupBy | "" {
  const raw = value?.trim().toLowerCase() ?? "";
  if (!raw || raw === "none") return "";
  if (!GROUPS.has(raw as NetworkGroupBy)) {
    throw dataFail(400, "Group by for network data must be vrf, site, role, or platform.", "invalid");
  }
  return raw as NetworkGroupBy;
}

function resolveVlan(value: number | undefined, view: NetworkView): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 4094) {
    throw dataFail(400, "vlan must be an integer from 1 to 4094.", "invalid");
  }
  if (view !== "l2") throw dataFail(400, "vlan applies to the Layer 2 view.", "invalid");
  return value;
}

function resolveDirection(value: string | undefined): FlowDirection {
  if (value == null || value.trim() === "") return "LR";
  const upper = value.trim().toUpperCase();
  if (upper !== "TD" && upper !== "TB" && upper !== "LR" && upper !== "RL" && upper !== "BT") {
    throw dataFail(400, "Direction must be TD, TB, LR, RL, or BT.", "invalid");
  }
  return upper;
}

function cleanLocalDevice(value: string | undefined): string {
  if (!value) return "";
  return [...value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim()].slice(0, 200).join("");
}

function cleanStoredName(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((part) => part === "." || part === ".." || part.startsWith("."))) return "";
  return normalized.toLowerCase().endsWith(".network.json") ? normalized : "";
}

function issues(items: { path: string; message: string }[]): RowIssue[] {
  return items.map((item) => ({
    row: 0,
    path: item.path,
    message: item.path ? `${item.path}: ${item.message}` : item.message,
  }));
}

function clipTitle(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const cleaned = [...value.normalize("NFKC")]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  if (!cleaned) return undefined;
  return [...cleaned].slice(0, 200).join("");
}
