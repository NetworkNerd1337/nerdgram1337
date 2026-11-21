import type { RenderFormat } from "../renderDiagram.js";

export type GenerateArgs = {
  path: string;
  data: string;
  format: string;
  view?: string;
  includeDown?: boolean;
  vlan?: number;
  direction?: string;
  groupBy?: string;
  localDevice?: string;
  hosts?: string;
  title?: string;
  edgesText?: string;
  storeData?: boolean;
};

export type RefreshArgs = {
  path: string;
  data?: string;
  edgesText?: string;
};

export type RenderArgs = {
  path?: string;
  source?: string;
  format: RenderFormat;
  background?: string;
};

export type RenderPayload = { format: "svg"; svg: string } | { format: "png"; png: Buffer };

/**
 * The operations behind the MCP tools. The HTTP server calls the same
 * services as `/api/v1`. The stdio proxy calls `/api/v1` and nothing else.
 */
export type McpBackend = {
  list(path: string): Promise<unknown>;
  search(input: { q: string; names?: boolean; contents?: boolean; regex?: boolean }): Promise<unknown>;
  get(path: string): Promise<unknown>;
  exportFolder(path: string): Promise<unknown>;
  lint(input: { path?: string; source?: string }): Promise<unknown>;
  render(input: RenderArgs): Promise<RenderPayload>;
  history(path: string): Promise<unknown>;
  diff(input: { path: string; from: string; to: string }): Promise<unknown>;
  create(input: { path: string; content: string }): Promise<unknown>;
  put(input: { path: string; content: string; expectedHash?: string }): Promise<unknown>;
  mkdir(path: string): Promise<unknown>;
  rename(input: { from: string; to: string; updateLinks?: boolean }): Promise<unknown>;
  move(input: { from: string; toFolder?: string; updateLinks?: boolean }): Promise<unknown>;
  duplicate(input: { path: string; copyData?: boolean; to?: string }): Promise<unknown>;
  trash(input: { path: string; deleteData?: boolean; confirmLinks?: boolean }): Promise<unknown>;
  generate(input: GenerateArgs): Promise<unknown>;
  upsert(input: GenerateArgs): Promise<unknown>;
  refresh(input: RefreshArgs): Promise<unknown>;
  replacePreview(input: unknown): Promise<unknown>;
  replaceApply(input: unknown): Promise<unknown>;
  baseline(input: { path: string; name?: string; note?: string; id?: string }): Promise<unknown>;
  diagramPaths(): Promise<string[]>;
};
