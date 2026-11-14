import { diffDiagrams, type DiagramDiff } from "./diagramDiff.js";
import * as store from "./fsStore.js";
import {
  baselineCap,
  captureBaseline,
  clearBaseline,
  isNamedRevision,
  listRevisions,
  nameRevision,
  publicRevision,
  readRevision,
  updateBaseline,
  type PublicRevision,
} from "./history.js";
import { REVISION_RETENTION, httpFail, normalizeRelative } from "./storage.js";

/**
 * History listing, named baselines, and revision diffs for `/api` and `/api/v1`.
 * Baselines live in the existing `.meta` revision index. A diff never writes
 * the diagram.
 */

export type HistoryList = {
  path: string;
  retention: number;
  baselineCap: number;
  baselineCount: number;
  revisions: PublicRevision[];
};

export type HistoryEndpoint = {
  ref: string;
  id: string | null;
  name: string | null;
  label: string;
};

export type HistoryComparison = DiagramDiff & {
  path: string;
  from: HistoryEndpoint;
  to: HistoryEndpoint;
};

export async function listHistory(filePath: string): Promise<HistoryList> {
  if (!String(filePath || "").trim()) throw httpFail(400, "path is required", "invalid");
  const revisions = await listRevisions(filePath);
  const published = revisions.map(publicRevision);
  return {
    path: normalizeRelative(filePath),
    retention: REVISION_RETENTION,
    baselineCap: baselineCap(),
    baselineCount: revisions.filter((revision) => isNamedRevision(revision)).length,
    revisions: published,
  };
}

function requirePath(filePath: string): string {
  if (!filePath.trim()) throw httpFail(400, "path is required", "invalid");
  return filePath;
}

export async function createBaseline(
  filePath: string,
  body: { id?: unknown; name?: unknown; note?: unknown },
  noteProvided: boolean,
): Promise<PublicRevision> {
  const file = await store.readFile(requirePath(filePath));
  if (body.id != null && body.id !== "") {
    if (typeof body.id !== "string") throw httpFail(400, "id must be a string", "invalid");
    return nameRevision(file.path, body.id, body.name, body.note, noteProvided);
  }
  return captureBaseline(
    file.path,
    { content: file.content, mtimeMs: file.mtimeMs, size: file.size, hash: file.hash },
    body.name,
    body.note,
    noteProvided,
  );
}

export async function patchBaseline(
  filePath: string,
  body: { id?: unknown; name?: unknown; note?: unknown },
  fields: { name: boolean; note: boolean },
): Promise<PublicRevision> {
  const file = await store.readFile(requirePath(filePath));
  if (typeof body.id !== "string" || !body.id.trim()) throw httpFail(400, "id is required", "invalid");
  return updateBaseline(file.path, body.id, { name: body.name, note: body.note }, fields);
}

export async function deleteBaseline(
  filePath: string,
  id: unknown,
): Promise<{ path: string; id: string; pruned: boolean; revision: PublicRevision | null }> {
  const file = await store.readFile(requirePath(filePath));
  if (typeof id !== "string" || !id.trim()) throw httpFail(400, "id is required", "invalid");
  const cleared = await clearBaseline(file.path, id);
  return { path: file.path, id, pruned: cleared.pruned, revision: cleared.revision };
}

export async function diffHistory(filePath: string, fromRef: unknown, toRef: unknown): Promise<HistoryComparison> {
  if (!String(filePath || "").trim() || typeof fromRef !== "string" || !fromRef.trim() || typeof toRef !== "string" || !toRef.trim()) {
    throw httpFail(400, "path, from, and to are required", "invalid");
  }
  const file = await store.readFile(filePath);
  const from = await resolveEndpoint(file, fromRef.trim());
  const to = await resolveEndpoint(file, toRef.trim());
  const diff = diffDiagrams(from.content, to.content, { from: from.endpoint.label, to: to.endpoint.label });
  return { path: file.path, from: from.endpoint, to: to.endpoint, ...diff };
}

async function resolveEndpoint(
  file: { path: string; content: string },
  ref: string,
): Promise<{ content: string; endpoint: HistoryEndpoint }> {
  if (ref.toLowerCase() === "current") {
    return {
      content: file.content,
      endpoint: { ref, id: null, name: null, label: "Current" },
    };
  }
  const revisions = await listRevisions(file.path);
  const byId = revisions.find((revision) => revision.id === ref);
  const byName = revisions.find((revision) => isNamedRevision(revision) && revision.name === ref);
  const match = byId ?? byName;
  if (!match) throw httpFail(404, "Revision not found", "not_found");
  const stored = await readRevision(file.path, match.id);
  const published = publicRevision(match);
  const label = published.name ?? `Revision ${published.createdAt}`;
  return {
    content: stored.content,
    endpoint: { ref, id: published.id, name: published.name, label },
  };
}
