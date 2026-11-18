import type { LinkRepairPlan } from "../../server/src/diagramLinks.ts";
import type { StylePreset, StylePresetDocument, StyleSnapshot } from "./lib/stylePresets";
import type { ReplaceApplyResult, ReplacePreview, ReplaceUndoResult } from "./lib/workspaceReplace";
import type { LintDiagnostic } from "../../server/src/diagramLint.ts";
import type { UnreadableDiagram } from "../../server/src/readError.ts";
import type {
  DiagramMeta,
  DiagramSearchResponse,
  FilePayload,
  FileWriteResult,
  SyncStatus,
  TemplateSummary,
  ThumbnailPayload,
  FolderListing,
  ImportFileResult,
  HistoryDiff,
  HistoryList,
  RevisionSummary,
  TrashItem,
  TreeNode,
  UpdateJob,
  UpdateStatus,
  VersionInfo,
} from "./types";

export type ListenHostStatus = {
  saved: string;
  persisted: boolean;
  invalid: boolean;
  effectiveHosts: string[];
  /** Bind the saved Host will use on the next start. 127.0.0.1 means 127.0.0.1 and ::1. */
  savedHosts: string[];
  source: "env" | "saved" | "default";
  envHost: string | null;
  envOverrides: boolean;
  docker: boolean;
  readOnly: boolean;
  /** Address this process started with. The restart notice compares `saved` to this. */
  running: string;
  restartNotice: boolean;
  acceptedHosts: string[];
};

export type DataDirStatus = {
  saved: string;
  running: string;
  persisted: boolean;
  source: "env" | "docker" | "saved" | "default";
  envValue: string | null;
  envSource: "shell" | "docker" | null;
  envManaged: boolean;
  docker: boolean;
  githubSync: boolean;
  readOnly: boolean;
  restartNotice: boolean;
  defaultPath: string;
};

export type InstanceStatus = {
  instanceId: string;
  instanceName: string;
  hostname: string;
  configuredName: string | null;
  nameIsDefault: boolean;
};

export type LockConflict = {
  acquiredAt: string | null;
  heartbeatAt: string | null;
  staleAfterMs: number | null;
  instanceId: string | null;
  instanceName: string | null;
  hostname: string | null;
  sameInstance: boolean;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly path?: string;
  readonly suggestedPath?: string;
  readonly files?: string[];
  readonly errors?: { row?: number; path?: string; message: string }[];
  readonly current?: {
    path?: string;
    content: string;
    mtimeMs: number;
    hash: string;
    size: number;
  };
  readonly lock?: LockConflict;
  readonly errno?: string;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof body.code === "string" ? body.code : undefined;
    this.path = typeof body.path === "string" ? body.path : undefined;
    this.suggestedPath = typeof body.suggestedPath === "string" ? body.suggestedPath : undefined;
    this.files = Array.isArray(body.files)
      ? body.files.filter((item): item is string => typeof item === "string")
      : undefined;
    this.errors = Array.isArray(body.errors)
      ? body.errors.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const message = (item as { message?: unknown }).message;
          if (typeof message !== "string" || !message.trim()) return [];
          const row = (item as { row?: unknown }).row;
          const path = (item as { path?: unknown }).path;
          const issue: { row?: number; path?: string; message: string } = { message };
          if (typeof row === "number" && row > 0) issue.row = row;
          if (typeof path === "string" && path.trim()) issue.path = path.trim();
          return [issue];
        })
      : undefined;
    if (body.current && typeof body.current === "object") {
      const current = body.current as Record<string, unknown>;
      if (
        typeof current.content === "string" &&
        typeof current.hash === "string" &&
        typeof current.mtimeMs === "number"
      ) {
        this.current = {
          path: typeof current.path === "string" ? current.path : undefined,
          content: current.content,
          hash: current.hash,
          mtimeMs: current.mtimeMs,
          size: typeof current.size === "number" ? current.size : current.content.length,
        };
      }
    }
    if (body.lock && typeof body.lock === "object") {
      const lock = body.lock as Record<string, unknown>;
      this.lock = {
        acquiredAt: typeof lock.acquiredAt === "string" ? lock.acquiredAt : null,
        heartbeatAt: typeof lock.heartbeatAt === "string" ? lock.heartbeatAt : null,
        staleAfterMs: typeof lock.staleAfterMs === "number" ? lock.staleAfterMs : null,
        instanceId: typeof lock.instanceId === "string" ? lock.instanceId : null,
        instanceName: typeof lock.instanceName === "string" ? lock.instanceName : null,
        hostname: typeof lock.hostname === "string" ? lock.hostname : null,
        sameInstance: lock.sameInstance !== false,
      };
    }
    this.errno = typeof body.errno === "string" ? body.errno : undefined;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

export const api = {
  tree: () => request<{ tree: TreeNode[] }>("/api/tree"),
  list: (path = "") =>
    request<FolderListing>(`/api/list?path=${encodeURIComponent(path)}`),
  readFile: (path: string) =>
    request<FilePayload>(`/api/file?path=${encodeURIComponent(path)}`),
  thumbnail: (path: string) =>
    request<ThumbnailPayload>(`/api/thumbnail?path=${encodeURIComponent(path)}`),
  saveThumbnail: (path: string, cacheKey: string, svg: string) =>
    request<{ path: string; cacheKey: string; mtimeMs: number }>("/api/thumbnail", {
      method: "PUT",
      body: JSON.stringify({ path, cacheKey, svg }),
    }),
  diagramMeta: () => request<{ diagrams: DiagramMeta[] }>("/api/diagram-meta"),
  tags: () => request<{ tags: { tag: string; count: number }[] }>("/api/tags"),
  fonts: () => request<{ fonts: { fontFamily: string; count: number }[] }>("/api/fonts"),
  colors: () => request<{ colors: { color: string; count: number }[] }>("/api/colors"),
  stylePresets: () => request<StylePresetDocument>("/api/style-presets"),
  createStylePreset: (body: { name: string; style: StyleSnapshot; default?: boolean }) =>
    request<StylePresetDocument & { preset: StylePreset }>("/api/style-presets", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateStylePreset: (id: string, body: { name?: string; style?: StyleSnapshot; default?: boolean }) =>
    request<StylePresetDocument & { preset: StylePreset }>(`/api/style-presets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteStylePreset: (id: string) =>
    request<StylePresetDocument>(`/api/style-presets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: "{}",
    }),
  importStylePresets: (body: {
    version: unknown;
    defaultId?: unknown;
    presets: unknown;
    mode?: "add" | "replace";
  }) =>
    request<StylePresetDocument>("/api/style-presets/import", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  lintSource: (source: string, diagramPaths?: string[], sourcePath?: string) =>
    request<{ diagnostics: LintDiagnostic[] }>("/api/lint", {
      method: "POST",
      body: JSON.stringify({ source, diagramPaths, sourcePath }),
    }),
  diagramLinks: (path: string) =>
    request<{
      path: string;
      linksTo: { path: string | null; target: string; line: number; broken: boolean }[];
      linkedFrom: { path: string; target: string; line: number }[];
    }>(`/api/diagram-links?path=${encodeURIComponent(path)}`),
  diagramLint: () =>
    request<{
      checked: number;
      diagrams: { path: string; diagnostics: LintDiagnostic[] }[];
      unreadable?: UnreadableDiagram[];
      muted?: string[];
    }>("/api/diagram-lint"),
  previewLinkRepairs: () => request<LinkRepairPlan>("/api/link-repairs"),
  applyLinkRepairs: (body: { lockToken?: string | null; choices: { from: string; to: string }[] }) =>
    request<LinkRepairPlan>("/api/link-repairs", {
      method: "POST",
      body: JSON.stringify({
        dryRun: false,
        confirm: true,
        lockToken: body.lockToken ?? undefined,
        choices: body.choices,
      }),
    }),
  search: (query: string, options?: { namesOnly?: boolean; signal?: AbortSignal }) => {
    const params = new URLSearchParams({ q: query });
    if (options?.namesOnly) params.set("names", "1");
    return request<DiagramSearchResponse>(`/api/search?${params.toString()}`, {
      signal: options?.signal,
    });
  },
  writeFile: (
    path: string,
    content: string,
    options?: {
      expectedMtimeMs?: number;
      expectedHash?: string;
      force?: boolean;
      lockToken?: string | null;
    },
  ) =>
    request<FileWriteResult>("/api/file", {
      method: "PUT",
      body: JSON.stringify({
        path,
        content,
        expectedMtimeMs: options?.expectedMtimeMs,
        expectedHash: options?.expectedHash,
        force: options?.force,
        lockToken: options?.lockToken ?? undefined,
      }),
    }),
  createFolder: (path: string) =>
    request<{ path: string }>("/api/folder", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  rename: (from: string, to: string, updateLinks = false) =>
    request<{ path: string; updated?: string[]; dataFiles?: { from: string; to: string }[] }>("/api/rename", {
      method: "PATCH",
      body: JSON.stringify({ from, to, updateLinks }),
    }),
  move: (from: string, toFolder: string, updateLinks = false) =>
    request<{ path: string; updated?: string[]; dataFiles?: { from: string; to: string }[] }>("/api/move", {
      method: "POST",
      body: JSON.stringify({ from, toFolder, updateLinks }),
    }),
  duplicate: (path: string, copyData?: boolean) =>
    request<{ path: string; type: "file" | "folder"; dataFiles?: { from: string; to: string }[] }>("/api/duplicate", {
      method: "POST",
      body: JSON.stringify({ path, ...(copyData == null ? {} : { copyData }) }),
    }),
  previewGenerate: (body: {
    text: string;
    format?: string;
    shape?: string;
    mapping?: Record<string, string>;
    edgesText?: string;
    edgesFormat?: string;
    edgesMapping?: Record<string, string>;
    direction?: string;
    grouping?: boolean;
    groupBy?: string;
    localDevice?: string;
    view?: "l3" | "l2";
    includeDown?: boolean;
    vlan?: number;
    title?: string;
    sourceFile?: string;
    edgesFile?: string;
  }) =>
    request<{
      format: "csv" | "json" | "cdp" | "lldp" | "network";
      shape: "links" | "nodes" | "edges" | "graph";
      headers: string[];
      edgesHeaders: string[];
      mapping: Record<string, string>;
      edgesMapping: Record<string, string>;
      errors: { row?: number; path?: string; message: string }[];
      warnings: { row?: number; path?: string; message: string }[];
      mermaid: string;
      counts: { nodes: number; edges: number; groups: number };
      direction: "TD" | "TB" | "LR" | "RL" | "BT";
      grouping: boolean;
    }>("/api/generate/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createGenerate: (body: {
    text: string;
    path: string;
    format?: string;
    shape?: string;
    mapping?: Record<string, string>;
    edgesText?: string;
    edgesMapping?: Record<string, string>;
    direction?: string;
    grouping?: boolean;
    groupBy?: string;
    localDevice?: string;
    view?: "l3" | "l2";
    includeDown?: boolean;
    vlan?: number;
    title?: string;
    description?: string;
    sourceFile?: string;
    storeData?: boolean;
    dataName?: string;
  }) =>
    request<{ path: string; dataPath: string; edgesPath: string; mermaid: string }>("/api/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  refreshGenerate: (body: {
    path: string;
    diagramText?: string;
    text?: string;
    edgesText?: string;
    writeData?: boolean;
  }) =>
    request<{
      path: string;
      dataPath: string;
      mermaid: string;
      warnings: { row?: number; path?: string; message: string }[];
      counts: { nodes: number; edges: number; groups: number };
      diff: {
        nodes: {
          added: { id: string; label: string }[];
          removed: { id: string; label: string }[];
          changed: { id: string; label: string; before: string; after: string; fields: string[] }[];
        };
        edges: {
          added: { source: string; target: string; label: string }[];
          removed: { source: string; target: string; label: string }[];
          changed: { source: string; target: string; before: string; after: string }[];
        };
      };
    }>("/api/generate/refresh", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  importFiles: (
    folder: string,
    files: { name: string; text: string; onCollision?: "rename" | "skip" | "replace" }[],
  ) =>
    request<{ folder: string; results: ImportFileResult[] }>("/api/import", {
      method: "POST",
      body: JSON.stringify({ folder, files }),
    }),
  delete: (path: string, confirmLinks = false, deleteData?: boolean) =>
    request<{
      path?: string;
      trashed?: boolean;
      message?: string;
      dataKept?: { file: string; diagrams: string[] }[];
    }>(
      `/api/item?path=${encodeURIComponent(path)}${confirmLinks ? "&confirmLinks=1" : ""}${
        deleteData == null ? "" : `&deleteData=${deleteData ? "1" : "0"}`
      }`,
      { method: "DELETE" },
    ),
  favorites: () => request<{ favorites: string[] }>("/api/favorites"),
  toggleFavorite: (path: string) =>
    request<{ favorites: string[]; favorited: boolean; bookmarks?: { folders: { id: string; name: string }[]; items: { path: string; folderId: string | null }[] } }>(
      "/api/favorites/toggle",
      {
        method: "POST",
        body: JSON.stringify({ path }),
      },
    ),
  referenceList: () =>
    request<{
      manifest: {
        lastSyncedAt: string | null;
        attribution: string;
        license: string;
        sources: string[];
        pages: {
          id: string;
          title: string;
          sourceUrl: string;
          filename: string;
        }[];
      };
      pages: {
        id: string;
        title: string;
        sourceUrl: string;
        filename: string;
      }[];
    }>("/api/reference"),
  referencePage: (id: string) =>
    request<{
      id: string;
      title: string;
      sourceUrl: string;
      content: string;
      override: string;
    }>(`/api/reference/page?id=${encodeURIComponent(id)}`),
  referenceOverride: (id: string, text: string) =>
    request<{ override: string }>("/api/reference/override", {
      method: "PUT",
      body: JSON.stringify({ id, text }),
    }),
  trash: () => request<{ items: TrashItem[] }>("/api/trash"),
  restoreTrash: (id: string, options?: { path?: string; overwrite?: boolean }) =>
    request<{ path: string; type: "file" | "folder" }>("/api/trash/restore", {
      method: "POST",
      body: JSON.stringify({
        id,
        path: options?.path,
        overwrite: options?.overwrite,
      }),
    }),
  purgeTrash: (id: string) =>
    request<void>(`/api/trash/item?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  emptyTrash: () =>
    request<{ purged: number }>("/api/trash/empty", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  history: (path: string) =>
    request<HistoryList>(`/api/history?path=${encodeURIComponent(path)}`),
  historyRevision: (path: string, id: string) =>
    request<RevisionSummary & { content: string }>(
      `/api/history/revision?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
    ),
  historyDiff: (path: string, from: string, to: string) =>
    request<HistoryDiff>(
      `/api/history/diff?path=${encodeURIComponent(path)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  saveBaseline: (body: { path: string; id?: string; name: string; note?: string }) =>
    request<RevisionSummary>("/api/history/baseline", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateBaseline: (body: { path: string; id: string; name?: string; note?: string }) =>
    request<RevisionSummary>("/api/history/baseline", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  removeBaseline: (path: string, id: string) =>
    request<{ path: string; id: string; pruned: boolean; revision: RevisionSummary | null }>(
      "/api/history/baseline",
      {
        method: "DELETE",
        body: JSON.stringify({ path, id }),
      },
    ),
  restoreRevision: (path: string, id: string, lockToken?: string | null) =>
    request<FileWriteResult & { content: string }>("/api/history/restore", {
      method: "POST",
      body: JSON.stringify({ path, id, lockToken: lockToken ?? undefined }),
    }),
  acquireLock: (path: string, sessionId: string) =>
    request<{
      path: string;
      token: string;
      sessionId: string;
      heartbeatAt: string;
      acquiredAt: string;
      heartbeatEveryMs: number;
      staleAfterMs: number;
    }>("/api/lock", {
      method: "POST",
      body: JSON.stringify({ path, sessionId }),
    }),
  /**
   * Ask for the lock without a 423 while another window still holds it.
   * A held lock is `{ held: true }` so a retry does not log a failed request.
   */
  pollLock: (path: string, sessionId: string) =>
    request<
      | {
          held: true;
          error: string;
          code: string;
          lock?: LockConflict;
        }
      | {
          path: string;
          token: string;
          sessionId: string;
          heartbeatAt: string;
          acquiredAt: string;
          heartbeatEveryMs: number;
          staleAfterMs: number;
        }
    >("/api/lock", {
      method: "POST",
      body: JSON.stringify({ path, sessionId, poll: true }),
    }),
  heartbeatLock: (path: string, token: string) =>
    request<{
      token: string;
      sessionId: string;
      heartbeatEveryMs: number;
      staleAfterMs: number;
    }>("/api/lock/heartbeat", {
      method: "POST",
      body: JSON.stringify({ path, token }),
    }),
  releaseLock: (path: string, token: string, init?: { keepalive?: boolean }) =>
    request<void>("/api/lock/release", {
      method: "POST",
      body: JSON.stringify({ path, token }),
      keepalive: init?.keepalive,
    }),
  takeoverLock: (path: string, sessionId: string) =>
    request<{
      path: string;
      token: string;
      sessionId: string;
      heartbeatAt: string;
      acquiredAt: string;
      heartbeatEveryMs: number;
      staleAfterMs: number;
    }>("/api/lock/takeover", {
      method: "POST",
      body: JSON.stringify({ path, sessionId }),
    }),
  bookmarks: () => request<{ folders: { id: string; name: string }[]; items: { path: string; folderId: string | null }[] }>("/api/bookmarks"),
  setBookmarks: (body: { folders: { id: string; name: string }[]; items: { path: string; folderId: string | null }[] }) =>
    request<{ folders: { id: string; name: string }[]; items: { path: string; folderId: string | null }[] }>("/api/bookmarks", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  templates: () => request<{ templates: TemplateSummary[] }>("/api/templates"),
  createTemplate: (body: { content?: string; path?: string; name?: string; description?: string; tags?: string[]; replace?: boolean }) =>
    request<TemplateSummary>("/api/templates", { method: "POST", body: JSON.stringify(body) }),
  saveTemplate: (id: string, content: string) =>
    request<TemplateSummary>(`/api/templates/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  renameTemplate: (id: string, name: string) =>
    request<TemplateSummary>(`/api/templates/${encodeURIComponent(id)}/rename`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  deleteTemplate: (id: string) =>
    request<void>(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  template: (id: string) =>
    request<TemplateSummary>(`/api/templates/${encodeURIComponent(id)}`),
  createFromTemplate: (id: string, body: { name?: string; folder?: string }) =>
    request<FileWriteResult & { templateId: string }>(
      `/api/templates/${encodeURIComponent(id)}/use`,
      {
        method: "POST",
        body: JSON.stringify({
          name: body.name ?? "",
          folder: body.folder ?? "",
        }),
      },
    ),
  syncStatus: () => request<SyncStatus>("/api/sync/status"),
  saveGithubClientId: (clientId: string) =>
    request<SyncStatus>("/api/sync/client-id", {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }),
  startGithubDevice: () =>
    request<SyncStatus>("/api/sync/device/start", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  connectGithub: (input: { name?: string; private?: boolean; confirmNonEmpty?: boolean }) =>
    request<SyncStatus>("/api/sync/connect", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  syncNow: () =>
    request<SyncStatus>("/api/sync/now", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  pullGithub: () =>
    request<SyncStatus>("/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  resolveGithub: (choices: { path: string; choice: "local" | "remote" | "both" }[]) =>
    request<SyncStatus>("/api/sync/resolve", {
      method: "POST",
      body: JSON.stringify({ choices }),
    }),
  disableGithub: (confirm: boolean) =>
    request<SyncStatus & { disconnected?: boolean; repoRemains?: boolean; grantRevoked?: boolean; revokeUrl?: string }>(
      "/api/sync/disable",
      {
        method: "POST",
        body: JSON.stringify({ confirm }),
      },
    ),
  version: () => request<VersionInfo>("/api/version"),
  updates: () => request<UpdateStatus>("/api/updates"),
  updateJob: () => request<{ job: UpdateJob | null }>("/api/updates/job"),
  checkUpdates: () =>
    request<UpdateStatus>("/api/updates/check", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  updateSettings: (body: { automatic?: boolean; includePrerelease?: boolean; clearSkipped?: boolean }) =>
    request<UpdateStatus>("/api/updates/settings", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listenHost: () => request<ListenHostStatus>("/api/host"),
  saveListenHost: (host: string) =>
    request<ListenHostStatus>("/api/host", {
      method: "POST",
      body: JSON.stringify({ host }),
    }),
  dataDir: () => request<DataDirStatus>("/api/data-dir"),
  saveDataDir: (path: string) =>
    request<DataDirStatus>("/api/data-dir", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  instance: () => request<InstanceStatus>("/api/instance"),
  saveInstanceName: (name: string) =>
    request<InstanceStatus>("/api/instance", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  skipUpdate: () =>
    request<UpdateStatus>("/api/updates/skip", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  laterUpdate: () =>
    request<UpdateStatus>("/api/updates/later", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  applyUpdate: () =>
    request<{ job: UpdateJob }>("/api/updates/apply", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  listTokens: () =>
    request<{
      tokens: {
        id: string;
        name: string;
        prefix: string;
        scope: "read" | "read-write";
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      }[];
    }>("/api/tokens"),
  createToken: (name: string, scope: "read" | "read-write") =>
    request<{
      token: string;
      tokenMeta: {
        id: string;
        name: string;
        prefix: string;
        scope: "read" | "read-write";
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      };
    }>("/api/tokens", {
      method: "POST",
      body: JSON.stringify({ name, scope }),
    }),
  revokeToken: (id: string) =>
    request<{
      token: {
        id: string;
        name: string;
        prefix: string;
        scope: "read" | "read-write";
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      };
    }>(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  deleteRevokedToken: (id: string) =>
    request<{ deleted: true; id: string }>(`/api/tokens/${encodeURIComponent(id)}/delete`, {
      method: "POST",
      body: "{}",
    }),
  clearRevokedTokens: () =>
    request<{ deleted: number }>("/api/tokens/clear-revoked", {
      method: "POST",
      body: "{}",
    }),
  replacePreview: (body: {
    find: string;
    replace: string;
    matchCase?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    includeFrontMatter?: boolean;
    scope?: { folder?: string; recursive?: boolean; paths?: string[] };
  }) =>
    request<ReplacePreview>("/api/replace/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  replaceApply: (body: {
    find: string;
    replace: string;
    matchCase?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    includeFrontMatter?: boolean;
    files: { path: string; hash: string; skipMatchIds?: string[] }[];
  }) =>
    request<ReplaceApplyResult>("/api/replace/apply", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  replaceUndo: (id: string) =>
    request<ReplaceUndoResult>("/api/replace/undo", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  referenceSync: () =>
    request<{
      manifest: {
        lastSyncedAt: string | null;
        attribution: string;
        license: string;
        sources: string[];
        pages: {
          id: string;
          title: string;
          sourceUrl: string;
          filename: string;
        }[];
      };
      pages: {
        id: string;
        title: string;
        sourceUrl: string;
        filename: string;
      }[];
    }>("/api/reference/sync", { method: "POST" }),
};
