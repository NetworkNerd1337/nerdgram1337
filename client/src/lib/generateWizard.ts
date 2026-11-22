import {
  EDGE_FIELDS,
  SHAPE_FIELDS,
  suggestMapping,
  type ColumnMapping,
  type DataFormat,
  type DataShape,
  type FieldSpec,
  type FlowDirection,
  type NetworkView,
  type RowIssue,
} from "../../../server/src/diagramData.ts";
import { ensureMmd, joinPath } from "./paths";

export type WizardStep = "input" | "map" | "preview";

export type WizardFormat = "auto" | DataFormat;

export type WizardGroupBy = "" | "platform" | "capability" | "vrf" | "site" | "role";

export type WizardInspection = {
  format: DataFormat;
  shape: DataShape;
  headers: string[];
  edgesHeaders: string[];
  mapping: ColumnMapping;
  edgesMapping: ColumnMapping;
  errors: RowIssue[];
  warnings: RowIssue[];
  mermaid: string;
  counts: { nodes: number; edges: number; groups: number };
  direction: FlowDirection;
  grouping: boolean;
};

export type MapperWarning = { path: string; message: string };

export type TranslatorChoice = {
  id: string;
  name: string;
  formatHint: string;
  placeholder: string;
};

export type WizardState = {
  step: WizardStep;
  text: string;
  fileName: string;
  /** Installed translator id. Empty for CSV, JSON, network JSON, CDP, and LLDP. */
  translatorId: string;
  /** Canonical network JSON from the last convert. Empty until convert succeeds. */
  documentText: string;
  mapperWarnings: MapperWarning[];
  edgesText: string;
  edgesFileName: string;
  format: WizardFormat;
  shape: "auto" | DataShape;
  mapping: ColumnMapping;
  edgesMapping: ColumnMapping;
  direction: FlowDirection;
  grouping: boolean;
  groupBy: WizardGroupBy;
  view: NetworkView;
  includeDown: boolean;
  vlan: string;
  localDevice: string;
  diagramName: string;
  folder: string;
  title: string;
  headers: string[];
  edgesHeaders: string[];
  errors: RowIssue[];
  warnings: RowIssue[];
  mermaid: string;
  counts: { nodes: number; edges: number; groups: number };
  detectedShape: DataShape | "";
  detectedFormat: DataFormat | "";
  fatal: string | null;
  /** Empty keeps Mermaid's rank layout. Compact and radial are stored on the new file. */
  hubLayout: "" | "compact" | "radial";
  /** Routing tables. ports draws each host. Counts draw one node per port or VLAN. */
  hosts: "ports" | "port-counts" | "vlan-counts";
};

export type WizardAction =
  | { type: "text"; text: string; fileName?: string }
  | { type: "edges"; text: string; fileName?: string }
  | { type: "format"; format: WizardState["format"] }
  | { type: "translator"; id: string }
  | { type: "translatorResult"; documentText: string; mapperWarnings: MapperWarning[] }
  | { type: "localDevice"; localDevice: string }
  | { type: "groupBy"; groupBy: WizardGroupBy }
  | { type: "view"; view: NetworkView }
  | { type: "includeDown"; includeDown: boolean }
  | { type: "vlan"; vlan: string }
  | { type: "shape"; shape: WizardState["shape"] }
  | { type: "mapping"; field: string; column: string }
  | { type: "edgesMapping"; field: string; column: string }
  | { type: "direction"; direction: FlowDirection }
  | { type: "grouping"; grouping: boolean }
  | { type: "meta"; diagramName?: string; folder?: string; title?: string }
  | { type: "result"; result: WizardInspection; step: "map" | "preview" }
  | { type: "fatal"; message: string }
  | { type: "back" }
  | { type: "hubLayout"; hubLayout: WizardState["hubLayout"] }
  | { type: "hosts"; hosts: WizardState["hosts"] };

export function initialWizardState(folder = ""): WizardState {
  return {
    step: "input",
    text: "",
    fileName: "",
    translatorId: "",
    documentText: "",
    mapperWarnings: [],
    edgesText: "",
    edgesFileName: "",
    format: "auto",
    shape: "auto",
    mapping: {},
    edgesMapping: {},
    direction: "LR",
    grouping: true,
    groupBy: "platform",
    view: "l3",
    includeDown: false,
    vlan: "",
    localDevice: "",
    diagramName: "",
    folder,
    title: "",
    headers: [],
    edgesHeaders: [],
    errors: [],
    warnings: [],
    mermaid: "",
    counts: { nodes: 0, edges: 0, groups: 0 },
    detectedShape: "",
    detectedFormat: "",
    fatal: null,
    hubLayout: "",
    hosts: "ports",
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "text": {
      const stem = stemFromFile(action.fileName);
      const untouched = state.diagramName.trim() === "" || state.diagramName === stemFromFile(state.fileName);
      const guessed = state.format === "auto" ? formatFromName(action.fileName) : null;
      const format = guessed ?? state.format;
      return {
        ...state,
        text: action.text,
        fileName: action.fileName ?? state.fileName,
        documentText: "",
        mapperWarnings: [],
        format,
        groupBy: guessed ? groupForFormat({ ...state, format }, guessed) : state.groupBy,
        diagramName: action.fileName && untouched && stem ? stem : state.diagramName,
        title: state.title || stem || state.title,
        fatal: null,
      };
    }
    case "edges":
      return {
        ...state,
        edgesText: action.text,
        edgesFileName: action.fileName ?? state.edgesFileName,
        fatal: null,
      };
    case "format":
      return {
        ...state,
        format: action.format,
        translatorId: "",
        documentText: "",
        mapperWarnings: [],
        groupBy: groupForFormat(state, action.format),
        fatal: null,
      };
    case "translator":
      return {
        ...state,
        translatorId: action.id,
        documentText: "",
        mapperWarnings: [],
        fatal: null,
      };
    case "translatorResult":
      return {
        ...state,
        documentText: action.documentText,
        mapperWarnings: action.mapperWarnings,
        fatal: null,
      };
    case "localDevice":
      return { ...state, localDevice: action.localDevice, fatal: null };
    case "groupBy":
      return { ...state, groupBy: action.groupBy, fatal: null };
    case "view":
      return {
        ...state,
        view: action.view,
        groupBy:
          action.view === "l3"
            ? state.groupBy === "vrf"
              ? "vrf"
              : ""
            : state.groupBy === "site" || state.groupBy === "role" || state.groupBy === "platform"
              ? state.groupBy
              : "",
        fatal: null,
      };
    case "includeDown":
      return { ...state, includeDown: action.includeDown, fatal: null };
    case "vlan":
      return { ...state, vlan: action.vlan, fatal: null };
    case "shape":
      return {
        ...state,
        shape: action.shape,
        mapping: remap(state.headers, action.shape, state.detectedShape),
        fatal: null,
      };
    case "mapping":
      return { ...state, mapping: setColumn(state.mapping, action.field, action.column), fatal: null };
    case "edgesMapping":
      return { ...state, edgesMapping: setColumn(state.edgesMapping, action.field, action.column), fatal: null };
    case "direction":
      return { ...state, direction: action.direction, fatal: null };
    case "grouping":
      return { ...state, grouping: action.grouping, fatal: null };
    case "meta":
      return {
        ...state,
        diagramName: action.diagramName ?? state.diagramName,
        folder: action.folder ?? state.folder,
        title: action.title ?? state.title,
      };
    case "result":
      return {
        ...state,
        step: action.step,
        headers: action.result.headers,
        edgesHeaders: action.result.edgesHeaders,
        mapping: action.result.mapping,
        edgesMapping: action.result.edgesMapping,
        errors: action.result.errors,
        warnings: action.result.warnings,
        mermaid: action.result.mermaid,
        counts: action.result.counts,
        detectedShape: action.result.shape,
        direction: action.result.direction,
        grouping: action.result.grouping,
        shape: state.shape === "auto" ? action.result.shape : state.shape,
        detectedFormat: action.result.format,
        fatal: null,
      };
    case "fatal":
      return { ...state, fatal: action.message };
    case "hubLayout":
      return { ...state, hubLayout: action.hubLayout };
    case "hosts":
      return { ...state, hosts: action.hosts };
    case "back":
      if (state.step === "preview") return { ...state, step: "map", fatal: null };
      if (state.step === "map") return { ...state, step: "input", fatal: null };
      return state;
    default:
      return state;
  }
}

/** Network JSON lists fields. CSV, JSON tables, CDP, and LLDP list rows. */
export function issueListTitle(format: string, detectedFormat = ""): string {
  return format === "network" || detectedFormat === "network" ? "Fields to fix" : "Rows to fix";
}

/** Show a JSON path, or a real row number. A missing row is not "row 0". */
export function listedIssueText(issue: { row?: number; path?: string; message: string }): string {
  const message = issue.message.trim();
  const field = issue.path?.trim() ?? "";
  if (field && !message.includes(field)) return `${field}: ${message}`;
  const row = issue.row ?? 0;
  if (row > 0 && !new RegExp(`\\brow ${row}\\b`, "i").test(message)) return `Row ${row}: ${message}`;
  return message;
}

export function canInspect(state: WizardState): boolean {
  return state.text.trim().length > 0;
}

export function canCreate(state: WizardState): boolean {
  return state.step === "preview" && state.errors.length === 0 && state.mermaid.trim().length > 0 && state.diagramName.trim().length > 0;
}

export function activeShape(state: WizardState): DataShape {
  if (state.shape !== "auto") return state.shape;
  return state.detectedShape || "links";
}

export function fieldsFor(state: WizardState): readonly FieldSpec[] {
  const shape = activeShape(state);
  if (shape === "graph") return SHAPE_FIELDS.nodes;
  return SHAPE_FIELDS[shape];
}

export function showEdgeFields(state: WizardState): boolean {
  const shape = activeShape(state);
  return shape === "graph" || shape === "nodes" || state.edgesText.trim().length > 0;
}

export function edgeFields(): readonly FieldSpec[] {
  return EDGE_FIELDS;
}

export function previewRequest(state: WizardState): {
  text: string;
  format: string;
  shape: string;
  mapping: ColumnMapping;
  edgesText?: string;
  edgesMapping: ColumnMapping;
  direction: FlowDirection;
  grouping: boolean;
  groupBy?: WizardGroupBy;
  localDevice?: string;
  view?: NetworkView;
  includeDown?: boolean;
  vlan?: number;
  title: string;
  sourceFile: string;
  hosts?: WizardState["hosts"];
} {
  const translated = Boolean(state.translatorId && state.documentText);
  const network = isNetworkSource(state);
  const vlan = network && state.view === "l2" && /^\d+$/.test(state.vlan.trim()) ? Number(state.vlan.trim()) : undefined;
  return {
    text: translated ? state.documentText : state.text,
    format: translated ? "network" : state.format,
    shape: isNeighborSource(state) || isRouteSource(state) || isArpMacSource(state) || network ? "links" : state.shape,
    mapping: state.mapping,
    edgesText: isNeighborSource(state) || isRouteSource(state) || isArpMacSource(state) || network || !state.edgesText.trim() ? undefined : state.edgesText,
    edgesMapping: state.edgesMapping,
    direction: state.direction,
    grouping: state.grouping,
    groupBy: state.groupBy || undefined,
    localDevice: state.localDevice.trim() || undefined,
    view: network ? state.view : undefined,
    includeDown: network ? state.includeDown : undefined,
    vlan,
    title: state.title.trim() || state.diagramName.trim() || "Diagram",
    sourceFile: dataFilePath(state),
    hosts: isRouteSource(state) || isArpMacSource(state) ? state.hosts : undefined,
  };
}

export function isRouteSource(state: WizardState): boolean {
  if (state.translatorId) return false;
  if (state.format === "route") return true;
  if (state.format === "auto") return state.detectedFormat === "route";
  return false;
}

export function isArpMacSource(state: WizardState): boolean {
  if (state.translatorId) return false;
  if (state.format === "arpmac") return true;
  if (state.format === "auto") return state.detectedFormat === "arpmac";
  return false;
}

export function isNeighborSource(state: WizardState): boolean {
  if (state.translatorId) return false;
  if (state.format === "cdp" || state.format === "lldp") return true;
  if (state.format === "auto") return state.detectedFormat === "cdp" || state.detectedFormat === "lldp";
  return false;
}

export function isNetworkSource(state: WizardState): boolean {
  if (state.translatorId) return true;
  if (state.format === "network") return true;
  if (state.format === "auto") return state.detectedFormat === "network";
  return false;
}

export function diagramFilePath(state: WizardState): string {
  return joinPath(state.folder.trim(), ensureMmd(state.diagramName));
}

export function noticeStorageKey(id: string): string {
  return `nerdgram.generate.notice.${id}`;
}

export function translatorDocsHref(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs/translators.md#${slug}`;
}

export function dataFilePath(state: WizardState): string {
  if (state.translatorId) {
    const stem = (state.diagramName.trim() || "data").replace(/\.mmd$/i, "");
    return joinPath(state.folder.trim(), `${stem}.network.json`);
  }
  const selected = state.format === "auto" ? state.detectedFormat : state.format;
  const ext =
    selected === "network"
      ? "network.json"
      : selected === "json" || selected === "cdp" || selected === "lldp" || selected === "route" || selected === "arpmac"
        ? selected
        : state.fileName.toLowerCase().endsWith(".network.json")
          ? "network.json"
          : state.fileName.toLowerCase().endsWith(".json")
            ? "json"
            : "csv";
  const stem = (state.diagramName.trim() || "data").replace(/\.mmd$/i, "");
  return joinPath(state.folder.trim(), `${stem}.${ext}`);
}

function remap(headers: readonly string[], shape: WizardState["shape"], detected: DataShape | ""): ColumnMapping {
  const chosen = shape === "auto" ? detected || "links" : shape;
  if (chosen === "edges") return suggestMapping(headers, "edges");
  const mapping = suggestMapping(headers, chosen === "graph" ? "nodes" : chosen);
  return mapping;
}

function setColumn(mapping: ColumnMapping, field: string, column: string): ColumnMapping {
  const next: ColumnMapping = { ...mapping };
  if (!column) delete next[field as keyof ColumnMapping];
  else next[field as keyof ColumnMapping] = column;
  return next;
}

function stemFromFile(fileName: string | undefined): string {
  if (!fileName) return "";
  const base = fileName.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.network\.json$/i, "").replace(/\.(csv|json|txt|cdp|lldp|route|arpmac)$/i, "").trim();
}

function formatFromName(fileName: string | undefined): WizardFormat | null {
  const lower = fileName?.toLowerCase() ?? "";
  if (lower.endsWith(".network.json")) return "network";
  if (lower.endsWith(".cdp")) return "cdp";
  if (lower.endsWith(".lldp")) return "lldp";
  if (lower.endsWith(".arpmac")) return "arpmac";
  if (lower.endsWith(".route")) return "route";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  return null;
}

/** Lines above the first diagram declaration. The preview starts on that line. */
export function mermaidPreviewScrollLines(value: string): number {
  const match =
    /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|kanban)\b/m.exec(
      value,
    );
  if (!match || match.index === 0) return 0;
  return value.slice(0, match.index).split("\n").length - 1;
}

function groupForFormat(state: WizardState, format: WizardFormat): WizardGroupBy {
  const networkGroups = new Set<WizardGroupBy>(["", "vrf", "site", "role"]);
  if (state.view === "l2") networkGroups.add("platform");
  const neighborGroups = new Set<WizardGroupBy>(["platform", "capability"]);
  if (format === "network") return networkGroups.has(state.groupBy) ? state.groupBy : "";
  if (format === "cdp" || format === "lldp") return neighborGroups.has(state.groupBy) ? state.groupBy : "platform";
  return state.groupBy;
}
