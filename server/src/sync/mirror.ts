import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import type { GitHttpRequest } from "isomorphic-git/http/node";
import { httpFail } from "../storage.js";
import { BRANCH, githubTimeoutMs } from "./constants.js";
import {
  AUTH_FORBIDDEN_MESSAGE,
  AUTH_REVOKED_MESSAGE,
  assertCleanRemoteUrl,
  classifyNetworkError,
  ensureAccessToken,
  refreshAfterUnauthorized,
} from "./github.js";
import { isBoilerplate, isSyncedFile, listUserFiles } from "./layout.js";
import { rememberSecret, scrubError } from "./redact.js";

const nodeFs = fs;
const PERSON = { name: "NerdGram1337", email: "nerdgram@localhost" };

const gitHttp = {
  async request(request: GitHttpRequest) {
    try {
      return await gitRequest(request, true);
    } catch (err) {
      throw classifyNetworkError(scrubError(err));
    }
  },
};

/**
 * Git smart HTTP on GitHub rejects a Device Flow token sent as Bearer.
 * Basic `x-access-token:<token>` is the form that git-receive-pack accepts.
 * The token stays out of the remote URL.
 */
export function gitBasicAuthorization(token: string): string {
  rememberSecret(token);
  return `Basic ${Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")}`;
}

async function gitRequest(
  request: GitHttpRequest,
  allowRefresh: boolean,
): Promise<Awaited<ReturnType<typeof http.request>>> {
  assertCleanRemoteUrl(request.url);
  const token = await ensureAccessToken();
  const headers = { ...(request.headers ?? {}) };
  if (token) headers.Authorization = gitBasicAuthorization(token);
  const timeout = AbortSignal.timeout(githubTimeoutMs());
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const response = await http.request({ ...request, headers, signal });
  if (response.statusCode === 401 && allowRefresh) {
    await drainBody(response.body);
    const next = await refreshAfterUnauthorized();
    if (next) return gitRequest(request, false);
  }
  if (response.statusCode === 401 || response.statusCode === 403) {
    await drainBody(response.body);
    throw response.statusCode === 401
      ? httpFail(401, AUTH_REVOKED_MESSAGE, "auth_revoked")
      : httpFail(403, AUTH_FORBIDDEN_MESSAGE, "auth_revoked");
  }
  return response;
}

async function drainBody(body: AsyncIterable<Uint8Array> | undefined): Promise<void> {
  if (!body) return;
  try {
    for await (const _chunk of body) {
      /* discard */
    }
  } catch {
    /* The status is what the caller needs. */
  }
}

export async function initMirror(dir: string, remoteUrl: string): Promise<void> {
  assertCleanRemoteUrl(remoteUrl);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await git.init({ fs: nodeFs, dir, defaultBranch: BRANCH });
  await git.addRemote({ fs: nodeFs, dir, remote: "origin", url: remoteUrl });
  await fsp.chmod(dir, 0o700);
}

export async function cloneMirror(dir: string, remoteUrl: string): Promise<void> {
  assertCleanRemoteUrl(remoteUrl);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(dir), { recursive: true });
  try {
    await git.clone({
      fs: nodeFs,
      http: gitHttp,
      dir,
      url: remoteUrl,
      ref: BRANCH,
      singleBranch: true,
      headers: await authHeaders(),
    });
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw classifyNetworkError(scrubError(err));
  }
  await fsp.chmod(dir, 0o700);
}

export async function setRemoteUrl(dir: string, remoteUrl: string): Promise<void> {
  assertCleanRemoteUrl(remoteUrl);
  await git.setConfig({ fs: nodeFs, dir, path: "remote.origin.url", value: remoteUrl });
}

export async function readRemoteUrl(dir: string): Promise<string | null> {
  try {
    const value = await git.getConfig({ fs: nodeFs, dir, path: "remote.origin.url" });
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

const README = `# NerdGram diagrams

This repository is a copy of diagrams from NerdGram1337.

The files are Mermaid \`.mmd\` diagrams, plus \`.csv\`, \`.json\`, \`.network.json\`, \`.cdp\`, and \`.lldp\` data files stored next to a generated diagram. Favorites, syntax overrides, trash, version history, thumbnails, the search index, and the GitHub token stay on the computer that runs NerdGram. They are not in this repository.

Editing a file on GitHub does not change NerdGram until you pull in the app. NerdGram will not force-push over commits made here.
`;

const GITIGNORE = `# Tokens, trash, history, and caches are not copied into this repository.
.meta/
`;

const GITATTRIBUTES = `*.mmd text eol=lf
*.csv text eol=lf
*.json text eol=lf
*.cdp text eol=lf
*.lldp text eol=lf
`;

export async function ensureBoilerplate(dir: string): Promise<void> {
  await writeIfChanged(path.join(dir, "README.md"), README);
  await writeIfChanged(path.join(dir, ".gitignore"), GITIGNORE);
  await writeIfChanged(path.join(dir, ".gitattributes"), GITATTRIBUTES);
}

/** Copy user diagrams into the mirror and delete mirror diagrams that are gone locally. */
export async function copyDataToMirror(dataRoot: string, dir: string): Promise<string[]> {
  const desired = await listUserFiles(dataRoot);
  await ensureBoilerplate(dir);
  const changed: string[] = [];
  for (const [rel, content] of desired) {
    const abs = mirrorFile(dir, rel);
    const current = await readTextIfFile(abs);
    if (current === content) continue;
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, "utf8");
    changed.push(rel);
  }
  await deleteExtra(dir, dir, desired);
  return changed;
}

export async function commitMirror(dir: string, message: string, parents?: string[]): Promise<string | null> {
  const matrix = await git.statusMatrix({ fs: nodeFs, dir });
  let dirty = false;
  for (const [filepath, head, workdir, stage] of matrix) {
    if (head === 1 && workdir === 1 && stage === 1) continue;
    if (head === 0 && workdir === 0) continue;
    dirty = true;
    if (workdir === 0) await git.remove({ fs: nodeFs, dir, filepath });
    else await git.add({ fs: nodeFs, dir, filepath });
  }
  if (!dirty && !parents) return null;

  const head = await headOid(dir);
  const parentOids = parents && parents.length > 0 ? parents : head ? [head] : [];
  const text = message.trim() || "Update diagrams";
  // A one-parent commit whose tree matches that parent is an empty commit.
  // A merge still records both parents when the tree matches one side.
  const onlyParentIsHead = parentOids.length === 1 && parentOids[0] === head;
  if (!parents || onlyParentIsHead) {
    try {
      return await git.commit({
        fs: nodeFs,
        dir,
        message: text,
        author: PERSON,
        committer: PERSON,
        parent: parents,
        disallowEmpty: parentOids.length === 1,
      });
    } catch (err) {
      if (isEmptyCommit(err)) return null;
      throw err;
    }
  }

  const oid = await git.commit({
    fs: nodeFs,
    dir,
    message: text,
    author: PERSON,
    committer: PERSON,
    parent: parents,
    noUpdateBranch: true,
  });
  if (parentOids.length === 1) {
    const [created, parentCommit] = await Promise.all([
      git.readCommit({ fs: nodeFs, dir, oid }),
      git.readCommit({ fs: nodeFs, dir, oid: parentOids[0] }),
    ]);
    if (created.commit.tree === parentCommit.commit.tree) return null;
  }
  const branch = await git.currentBranch({ fs: nodeFs, dir, fullname: true });
  await git.writeRef({
    fs: nodeFs,
    dir,
    ref: typeof branch === "string" ? branch : "HEAD",
    value: oid,
    force: true,
  });
  return oid;
}

function isEmptyCommit(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String(err.code) : "";
  const name = "name" in err ? String(err.name) : "";
  return code === "EmptyCommitError" || name === "EmptyCommitError";
}

export async function fetchRemote(dir: string): Promise<void> {
  try {
    await git.fetch({
      fs: nodeFs,
      http: gitHttp,
      dir,
      remote: "origin",
      ref: BRANCH,
      singleBranch: true,
      tags: false,
      headers: await authHeaders(),
    });
  } catch (err) {
    throw classifyNetworkError(scrubError(err));
  }
}

export async function pushBranch(dir: string): Promise<void> {
  let result: Awaited<ReturnType<typeof git.push>>;
  try {
    result = await git.push({
      fs: nodeFs,
      http: gitHttp,
      dir,
      remote: "origin",
      ref: BRANCH,
      remoteRef: BRANCH,
      // Never force-push. A rejected update stays rejected.
      force: false,
      headers: await authHeaders(),
    });
  } catch (err) {
    throw classifyNetworkError(scrubError(err));
  }
  if (!result.ok) {
    const detail = result.error || Object.values(result.refs ?? {})[0]?.error || "";
    throw classifyNetworkError(new Error(detail || "push rejected"));
  }
}

export async function fastForwardBranch(dir: string): Promise<void> {
  try {
    await git.merge({
      fs: nodeFs,
      dir,
      ours: BRANCH,
      theirs: `remotes/origin/${BRANCH}`,
      fastForwardOnly: true,
      abortOnConflict: true,
      author: PERSON,
      committer: PERSON,
    });
  } catch (err) {
    throw classifyNetworkError(scrubError(err));
  }
}

export async function headOid(dir: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs: nodeFs, dir, ref: "HEAD" });
  } catch {
    return null;
  }
}

export async function remoteOid(dir: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs: nodeFs, dir, ref: `refs/remotes/origin/${BRANCH}` });
  } catch {
    return null;
  }
}

export async function mergeBase(dir: string, local: string, remote: string): Promise<string | null> {
  try {
    const bases = await git.findMergeBase({ fs: nodeFs, dir, oids: [local, remote] });
    return bases[0] ?? null;
  } catch {
    return null;
  }
}

export async function isAncestor(dir: string, ancestor: string, oid: string): Promise<boolean> {
  if (ancestor === oid) return true;
  try {
    return await git.isDescendent({ fs: nodeFs, dir, oid, ancestor });
  } catch {
    return false;
  }
}

export async function readUserFilesAt(dir: string, ref: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let oid = ref;
  try {
    oid = await git.resolveRef({ fs: nodeFs, dir, ref });
  } catch {
    return out;
  }
  let files: string[] = [];
  try {
    files = await git.listFiles({ fs: nodeFs, dir, ref: oid });
  } catch {
    return out;
  }
  for (const filepath of files) {
    if (!isSyncedFile(filepath)) continue;
    const { blob } = await git.readBlob({ fs: nodeFs, dir, oid, filepath });
    out.set(filepath, Buffer.from(blob).toString("utf8"));
  }
  return out;
}

export async function listHeadFiles(dir: string): Promise<string[]> {
  try {
    const files = await git.listFiles({ fs: nodeFs, dir, ref: "HEAD" });
    return files;
  } catch {
    return [];
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await ensureAccessToken();
  if (!token) return {};
  return { Authorization: gitBasicAuthorization(token) };
}

function mirrorFile(dir: string, relativePath: string): string {
  if (!isSyncedFile(relativePath)) {
    throw httpFail(400, "Invalid path", "invalid");
  }
  return path.join(dir, ...relativePath.split("/"));
}

async function readTextIfFile(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function writeIfChanged(file: string, content: string): Promise<void> {
  const current = await readTextIfFile(file);
  if (current === content) return;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, "utf8");
}

async function deleteExtra(mirror: string, dir: string, desired: Map<string, string>): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(mirror, abs).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) {
        await fsp.rm(abs, { recursive: true, force: true });
        continue;
      }
      await deleteExtra(mirror, abs, desired);
      const left = await fsp.readdir(abs).catch(() => ["keep"]);
      if (left.length === 0) await fsp.rmdir(abs).catch(() => undefined);
      continue;
    }
    if (isBoilerplate(rel)) continue;
    if (entry.name.startsWith(".") || !isSyncedFile(rel) || !desired.has(rel)) {
      await fsp.rm(abs, { force: true });
    }
  }
}
