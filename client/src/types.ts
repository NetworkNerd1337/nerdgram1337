export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  mtimeMs: number;
  size?: number;
  children?: TreeNode[];
};

export type FilePayload = {
  path: string;
  name: string;
  content: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

export type FileWriteResult = {
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  content?: string;
  unchanged?: boolean;
  revisionId?: string;
};

export type TrashItem = {
  id: string;
  originalPath: string;
  name: string;
  type: "file" | "folder";
  deletedAt: string;
  favorites: string[];
};

export type RevisionSummary = {
  id: string;
  createdAt: string;
  mtimeMs: number;
  size: number;
  hash: string;
  name?: string | null;
  note?: string | null;
  namedAt?: string | null;
  /** Instance that saved this revision. Null or absent means unknown. */
  instanceName?: string | null;
};

export type HistoryList = {
  path: string;
  retention: number;
  baselineCap: number;
  baselineCount: number;
  revisions: RevisionSummary[];
};

export type HistoryDiff = {
  path: string;
  semantic: boolean;
  diagramType: string;
  note: string | null;
  from: { ref: string; id: string | null; name: string | null; label: string; createdAt?: string | null };
  to: { ref: string; id: string | null; name: string | null; label: string; createdAt?: string | null };
  nodes?: {
    added: { id: string }[];
    removed: { id: string }[];
    changed: { id: string }[];
  };
  edges?: {
    added: { from: string; to: string; index: number }[];
    removed: { from: string; to: string; index: number }[];
    changed: { from: string; to: string; index: number }[];
  };
  text: {
    unified: string;
    rows: {
      kind: "same" | "add" | "remove" | "change";
      left: string | null;
      right: string | null;
      leftLine: number | null;
      rightLine: number | null;
    }[];
  };
  summary: string[];
  markdown: string;
  visualSource: string | null;
  fromSource: string;
  toSource: string;
};

export type DiagramMeta = {
  path: string;
  title: string | null;
  description: string;
  notes: string;
  tags: string[];
  theme: string | null;
  look: string | null;
  layout: string | null;
  malformed: boolean;
  error: string | null;
  /** 1-based file line when the settings block failed. Null when it is readable. */
  errorLine: number | null;
  cacheKey: string;
};

export type DiagramSearchHit = {
  path: string;
  name: string;
  title: string | null;
  rank: number;
  field: string;
  element: string | null;
  label: string;
  line: number | null;
  snippet: string;
  matchStart: number;
  matchLength: number;
};

export type DiagramSearchResponse = {
  query: string;
  truncated: boolean;
  hits: DiagramSearchHit[];
};

export type TemplateSummary = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  theme: string | null;
  diagramType: string;
  cacheKey: string;
  malformed: boolean;
  error: string | null;
  source: string;
  /** Shipped templates are builtin. Create as template writes user. */
  origin?: "builtin" | "user";
};

export type ThumbnailPayload = {
  hit: boolean;
  path: string;
  cacheKey: string;
  mtimeMs: number;
  svg?: string;
};

export type FolderListing = {
  path: string;
  folders: TreeNode[];
  files: TreeNode[];
};

export type ImportFileResult = {
  name: string;
  status: "created" | "renamed" | "replaced" | "skipped" | "collision" | "error";
  path?: string;
  suggestedPath?: string;
  code?: string;
  error?: string;
};

export type SyncConflict = {
  path: string;
  reason: "both_changed" | "locked" | "remote_deleted" | "local_deleted";
  locked: boolean;
  localPreview: string | null;
  remotePreview: string | null;
};

export type SyncStatus = {
  enabled: boolean;
  login: string | null;
  clientId: string | null;
  clientIdSource: "env" | "config" | null;
  tokenSource: "env" | "file" | null;
  repo: { owner: string; name: string; private: boolean; htmlUrl: string } | null;
  lastSyncAt: string | null;
  pending: boolean;
  ahead: number;
  behind: number;
  idleMs: number;
  syncing: boolean;
  error: { code: string; message: string; docsUrl?: string } | null;
  conflicts: SyncConflict[];
  device: { userCode: string; verificationUri: string; expiresAt: string } | null;
  docsUrl: string;
  mirror: string;
  disconnected?: boolean;
  repoRemains?: boolean;
  grantRevoked?: boolean;
  revokeUrl?: string;
};

export type InstallKind = "git" | "docker" | "zip" | "unknown";

export type DataHealthIssue = {
  code: string;
  severity: "info" | "warn" | "degraded";
  message: string;
  file?: string;
};

export type InstanceConflict = {
  instanceId: string;
  hostname: string;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
};

export type QuarantineSet = {
  id: string;
  path: string;
  file: string;
  reason: string;
};

export type NameClash = {
  kind: "case" | "conflict-copy";
  paths: string[];
};

export type UpgradeBlocker = {
  code: "not-writable" | "low-space" | "instance-conflict" | "newer-schema";
  message: string;
};

export type DataDoctorReport = {
  ok: boolean;
  dataDir: string;
  status: "ok" | "warn" | "degraded";
  issues: DataHealthIssue[];
  syncFolder: boolean;
  instanceConflict: InstanceConflict | null;
  freeBytes: number | null;
  quarantined: number;
  writable: boolean;
  tempsRemoved: number;
  quarantineSets: QuarantineSet[];
  clashes: NameClash[];
  caseInsensitive: boolean;
  blockers: UpgradeBlocker[];
};

export type VersionInfo = {
  name: string;
  version: string;
  codename: string | null;
  commit: string | null;
  installKind: InstallKind;
};

export type UpdateRelease = {
  tag: string;
  version: string;
  codename: string | null;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
};

export type UpdateStatus = {
  enabled: boolean;
  automatic: boolean;
  includePrerelease: boolean;
  installKind: InstallKind;
  currentVersion: string;
  codename: string | null;
  commit: string | null;
  phase: "disabled" | "current" | "available" | "ahead" | "unknown" | "no_release";
  updateAvailable: boolean;
  skipped: boolean;
  dismissed: boolean;
  skippedVersions: string[];
  latest: UpdateRelease | null;
  checkedAt: string | null;
  error: { code: string; message: string } | null;
  canApply: boolean;
  matchesLatest: boolean;
  docker: {
    image: string;
    tag: string;
    steps: { title: string; command: string }[];
    compose: { title: string; command: string }[];
    composeNote: string;
    persistNote: string;
  } | null;
};

export type UpdateJob = {
  running: boolean;
  phase: string;
  lines: string[];
  error: { code: string; message: string } | null;
  result: {
    ok: true;
    previousCommit: string;
    commit: string;
    version: string;
    tag: string;
    restart: { required: true; mode: string; instructions: string };
  } | null;
};
