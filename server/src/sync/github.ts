import { SYNC_DOCS_URL, githubTimeoutMs } from "./constants.js";
import { clientIdOf, loadConfig } from "./configStore.js";
import { readErrorStatus, rememberSecret, redactText } from "./redact.js";
import { readStoredAuth, writeToken, type StoredAuth } from "./secrets.js";
import { httpFail } from "../storage.js";

/** Refresh this long before the access token expires so a push is not cut off. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export const AUTH_REVOKED_MESSAGE =
  "GitHub rejected the saved authorization. It may have been revoked. Connect again.";
export const AUTH_FORBIDDEN_MESSAGE =
  "GitHub refused this request. Check that the authorization still includes repository access.";
export const AUTH_EXPIRED_MESSAGE = "GitHub authorization expired. Connect again.";

const APP_CODES = new Set([
  "auth_revoked",
  "auth_expired",
  "not_connected",
  "offline",
  "rate_limit",
  "not_fast_forward",
  "repo_missing",
  "github",
  "invalid",
  "invalid_client",
  "device_flow_disabled",
  "name_taken",
  "repo_not_empty",
  "conflicts",
  "locked",
]);

export type GithubRepo = {
  owner: string;
  name: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string | null;
};

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

type FetchLike = typeof fetch;

let fetchImpl: FetchLike = globalThis.fetch.bind(globalThis);

export function setGithubFetch(next: FetchLike | null): void {
  fetchImpl = next ?? globalThis.fetch.bind(globalThis);
}

export function githubWeb(): string {
  return (process.env.NERDGRAM_GITHUB_WEB || "https://github.com").replace(/\/$/, "");
}

export function githubApi(): string {
  return (process.env.NERDGRAM_GITHUB_API || "https://api.github.com").replace(/\/$/, "");
}

const DEVICE_HELP =
  "Create an OAuth app in your own GitHub account, enable Device flow, and paste that app's client ID. NerdGram does not ship a client ID or client secret. The steps are on the GitHub sync page.";

export async function requestDeviceCode(clientId: string): Promise<DeviceCode> {
  const response = await githubFetch(`${githubWeb()}/login/device/code`, {
    method: "POST",
    headers: acceptJson({ "Content-Type": "application/json" }),
    body: JSON.stringify({ client_id: clientId, scope: "repo" }),
  });
  const body = await readBody(response);
  if (!response.ok || body.error) {
    throw deviceStartError(response.status, body);
  }
  const deviceCode = stringField(body, "device_code");
  const userCode = stringField(body, "user_code");
  const verificationUri = stringField(body, "verification_uri") || "https://github.com/login/device";
  if (!deviceCode || !userCode) {
    throw httpFail(502, `${DEVICE_HELP} ${SYNC_DOCS_URL}`, "invalid_client");
  }
  rememberSecret(deviceCode);
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn: numberField(body, "expires_in") ?? 900,
    interval: numberField(body, "interval") ?? 5,
  };
}

export type IssuedToken = {
  token: string;
  refreshToken: string | null;
  expiresIn: number | null;
  refreshExpiresIn: number | null;
};

export type DevicePoll =
  | { status: "pending" }
  | { status: "slow_down" }
  | ({ status: "success" } & IssuedToken)
  | { status: "denied" | "expired" };

export async function pollDeviceToken(clientId: string, deviceCode: string): Promise<DevicePoll> {
  const response = await githubFetch(`${githubWeb()}/login/oauth/access_token`, {
    method: "POST",
    headers: acceptJson({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const body = await readBody(response);
  if (body.access_token && typeof body.access_token === "string") {
    return { status: "success", ...issuedFrom(body) };
  }
  const error = typeof body.error === "string" ? body.error : "";
  if (error === "authorization_pending") return { status: "pending" };
  if (error === "slow_down") return { status: "slow_down" };
  if (error === "expired_token") return { status: "expired" };
  if (error === "access_denied") return { status: "denied" };
  if (!response.ok) throw classifyResponse(response.status, body, response.headers);
  throw httpFail(502, "GitHub did not return an authorization result.", "github");
}

/**
 * Exchange a refresh token for a new access token.
 *
 * GitHub's OAuth app docs require `client_secret` on this grant unless the
 * token was issued by the device flow. Pass the secret only when it is set.
 * The secret is never written to disk.
 */
export async function refreshAccessToken(input: {
  clientId: string;
  refreshToken: string;
  clientSecret?: string | null;
}): Promise<IssuedToken> {
  rememberSecret(input.refreshToken);
  const secret = input.clientSecret?.trim() || "";
  if (secret) rememberSecret(secret);
  const payload: Record<string, string> = {
    client_id: input.clientId,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  };
  if (secret) payload.client_secret = secret;
  const response = await githubFetch(`${githubWeb()}/login/oauth/access_token`, {
    method: "POST",
    headers: acceptJson({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const body = await readBody(response);
  if (typeof body.access_token === "string" && body.access_token) return issuedFrom(body);
  throw httpFail(401, AUTH_EXPIRED_MESSAGE, "auth_expired");
}

export async function getAuthenticatedUser(token: string): Promise<{ login: string }> {
  const response = await githubFetch(`${githubApi()}/user`, {
    headers: authHeaders(await liveToken(token)),
  });
  const body = await readBody(response);
  if (!response.ok) throw classifyResponse(response.status, body, response.headers);
  const login = stringField(body, "login");
  if (!login) throw httpFail(502, "GitHub did not return an account login.", "github");
  return { login };
}

export async function createUserRepo(
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<GithubRepo> {
  const response = await githubFetch(`${githubApi()}/user/repos`, {
    method: "POST",
    headers: authHeaders(await liveToken(token), { "Content-Type": "application/json" }),
    body: JSON.stringify({
      name,
      private: isPrivate,
      description: "Diagrams copied from NerdGram1337. The app keeps tokens and local history on this computer.",
      auto_init: false,
    }),
  });
  const body = await readBody(response);
  if (response.status === 422) {
    throw httpFail(422, "A repository with that name already exists.", "name_taken");
  }
  if (!response.ok) throw classifyResponse(response.status, body, response.headers);
  return repoFrom(body);
}

export async function getRepo(token: string, owner: string, name: string): Promise<GithubRepo | null> {
  const response = await githubFetch(`${githubApi()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
    headers: authHeaders(await liveToken(token)),
  });
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }
  const body = await readBody(response);
  if (!response.ok) throw classifyResponse(response.status, body, response.headers);
  return repoFrom(body);
}

/** True when the repository has no commits yet. */
export async function repoIsEmpty(token: string, owner: string, name: string): Promise<boolean> {
  const response = await githubFetch(
    `${githubApi()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=1`,
    { headers: authHeaders(await liveToken(token)) },
  );
  if (response.status === 409) {
    await response.arrayBuffer().catch(() => undefined);
    return true;
  }
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    throw httpFail(404, "That GitHub repository was not found.", "repo_missing");
  }
  const body = await readBody(response);
  if (!response.ok) throw classifyResponse(response.status, body, response.headers);
  return false;
}

/**
 * Revoke the OAuth grant. GitHub requires the client secret for this call,
 * and NerdGram does not ship one. Returns false when the secret is unset.
 */
export async function setDefaultBranch(token: string, owner: string, name: string, branch: string): Promise<void> {
  const response = await githubFetch(`${githubApi()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: authHeaders(await liveToken(token), { "Content-Type": "application/json" }),
    body: JSON.stringify({ default_branch: branch }),
  });
  await response.arrayBuffer().catch(() => undefined);
}

export async function revokeGrant(clientId: string, token: string): Promise<boolean> {
  const secret = process.env.NERDGRAM_GITHUB_CLIENT_SECRET?.trim();
  if (!secret) return false;
  rememberSecret(secret);
  const auth = Buffer.from(`${clientId}:${secret}`, "utf8").toString("base64");
  const response = await githubFetch(`${githubApi()}/applications/${encodeURIComponent(clientId)}/grant`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "User-Agent": "NerdGram1337",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ access_token: token }),
  });
  await response.arrayBuffer().catch(() => undefined);
  return response.ok;
}

function repoFrom(body: Record<string, unknown>): GithubRepo {
  const name = stringField(body, "name");
  const htmlUrl = stringField(body, "html_url");
  const cloneUrl = stringField(body, "clone_url");
  const ownerObj = body.owner;
  const owner =
    ownerObj && typeof ownerObj === "object" && typeof (ownerObj as { login?: unknown }).login === "string"
      ? (ownerObj as { login: string }).login
      : "";
  if (!name || !owner || !cloneUrl) {
    throw httpFail(502, "GitHub returned an unexpected repository response.", "github");
  }
  assertCleanRemoteUrl(cloneUrl);
  return {
    owner,
    name,
    private: body.private !== false,
    htmlUrl: htmlUrl || `https://github.com/${owner}/${name}`,
    cloneUrl,
    defaultBranch: stringField(body, "default_branch"),
  };
}

export function assertCleanRemoteUrl(remoteUrl: string): void {
  if (remoteUrl.includes("\0") || /\s/.test(remoteUrl)) {
    throw httpFail(400, "The Git remote URL is not valid.", "invalid");
  }
  if (/^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(remoteUrl)) {
    throw httpFail(400, "The Git remote URL must not contain a token.", "invalid");
  }
  if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
    let url: URL;
    try {
      url = new URL(remoteUrl);
    } catch {
      throw httpFail(400, "The Git remote URL is not valid.", "invalid");
    }
    if (url.username || url.password || url.hash) {
      throw httpFail(400, "The Git remote URL must not contain a token or password.", "invalid");
    }
    for (const key of ["access_token", "token", "client_secret", "device_code"]) {
      if (url.searchParams.has(key)) {
        throw httpFail(400, "The Git remote URL must not contain a token or password.", "invalid");
      }
    }
    return;
  }
  if (remoteUrl.includes("://")) {
    throw httpFail(400, "The Git remote URL is not valid.", "invalid");
  }
}

function deviceStartError(status: number, body: Record<string, unknown>): Error {
  const error = typeof body.error === "string" ? body.error : "";
  const description = typeof body.error_description === "string" ? body.error_description : "";
  if (
    error === "device_flow_disabled" ||
    /device flow/i.test(description) ||
    /device flow/i.test(error)
  ) {
    return httpFail(
      400,
      `Device flow is not enabled for this OAuth app. ${DEVICE_HELP} ${SYNC_DOCS_URL}`,
      "device_flow_disabled",
    );
  }
  if (
    status === 404 ||
    status === 401 ||
    error === "incorrect_client_credentials" ||
    error === "not_found" ||
    error === "unauthorized_client" ||
    error === "invalid_client"
  ) {
    return httpFail(400, `GitHub rejected this client ID. ${DEVICE_HELP} ${SYNC_DOCS_URL}`, "invalid_client");
  }
  return classifyResponse(status, body, new Headers());
}

function classifyResponse(status: number, body: Record<string, unknown>, headers: Headers): Error {
  const remaining = headers.get("x-ratelimit-remaining");
  const message = typeof body.message === "string" ? body.message : "";
  if (status === 429 || remaining === "0" || /rate limit/i.test(message)) {
    return httpFail(
      429,
      "GitHub rate limit reached. Local commits stay on this computer. Sync again after the limit resets.",
      "rate_limit",
    );
  }
  if (status === 401) return httpFail(401, AUTH_REVOKED_MESSAGE, "auth_revoked");
  if (status === 404) {
    return httpFail(404, "That GitHub repository was not found.", "repo_missing");
  }
  if (status === 403) return httpFail(403, AUTH_FORBIDDEN_MESSAGE, "auth_revoked");
  return httpFail(502, "GitHub sync failed.", "github");
}

export function classifyNetworkError(err: unknown): Error {
  const name = err instanceof Error ? err.name : "";
  const code =
    err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : "";
  const message = redactText(err instanceof Error ? err.message : "");
  const status = httpStatusOf(err) ?? statusFromMessage(message);
  if (code && APP_CODES.has(code) && err instanceof Error) {
    if ("status" in err && typeof (err as { status?: unknown }).status === "number") return err;
    return httpFail(status ?? statusForAppCode(code), err.message || "GitHub sync failed.", code);
  }
  if (status === 401 || code === "HttpError" && status === 401) {
    return httpFail(401, AUTH_REVOKED_MESSAGE, "auth_revoked");
  }
  if (status === 403) return httpFail(403, AUTH_FORBIDDEN_MESSAGE, "auth_revoked");
  if (err instanceof Error && "status" in err && "code" in err && code !== "HttpError") return err;
  if (
    name === "AbortError" ||
    code === "ABORT_ERR" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "ENETUNREACH" ||
    code === "ECONNRESET" ||
    /timeout|network|fetch failed|getaddrinfo/i.test(message)
  ) {
    return httpFail(
      503,
      "The network is unavailable. Local commits stay on this computer and push when the connection returns.",
      "offline",
    );
  }
  if (/non-fast-forward|not fast[- ]forward|rejected non-fast-forward|cannot lock ref/i.test(message)) {
    return httpFail(
      409,
      "The GitHub repository has commits that are not on this computer. NerdGram did not force-push. Pull when you want to reconcile.",
      "not_fast_forward",
    );
  }
  return httpFail(502, "GitHub sync failed.", "github");
}

function acceptJson(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": "NerdGram1337",
    ...extra,
  };
}

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  rememberSecret(token);
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "NerdGram1337",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

async function githubFetch(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  assertNoSecretInUrl(url);
  const timeout = AbortSignal.timeout(githubTimeoutMs());
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal });
  } catch (err) {
    throw classifyNetworkError(err);
  }
  if (attempt === 0 && response.status === 401 && bearerValue(init)) {
    let next: string | null;
    try {
      next = await refreshAfterUnauthorized();
    } catch (err) {
      await response.arrayBuffer().catch(() => undefined);
      throw err;
    }
    if (next) {
      await response.arrayBuffer().catch(() => undefined);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${next}`);
      return githubFetch(url, { ...init, headers }, attempt + 1);
    }
  }
  return response;
}

function bearerValue(init: RequestInit): string | null {
  const value = new Headers(init.headers).get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(value);
  return match?.[1] ?? null;
}

let refreshInflight: Promise<string | null> | null = null;

export function resetTokenRefreshForTests(): void {
  refreshInflight = null;
}

/**
 * Access token to send on the next GitHub call. Refreshes a file-backed token
 * that is inside the expiry window. An environment token is returned as-is.
 */
export async function ensureAccessToken(): Promise<string | null> {
  const auth = await readStoredAuth();
  if (!auth.accessToken) return null;
  if (auth.source !== "file" || auth.expiresAt == null) return auth.accessToken;
  if (auth.expiresAt - Date.now() > REFRESH_SKEW_MS) return auth.accessToken;
  const next = await refreshCoalesced();
  return next ?? auth.accessToken;
}

/** One refresh after a 401. Returns null when there is no refresh token to use. */
export async function refreshAfterUnauthorized(): Promise<string | null> {
  const auth = await readStoredAuth();
  if (auth.source !== "file" || !auth.refreshToken) return null;
  return refreshCoalesced();
}

/**
 * Set when a stored access token is already expired and cannot be refreshed.
 * Device-flow tokens can refresh without a client secret. Any other refresh
 * token needs `NERDGRAM_GITHUB_CLIENT_SECRET`.
 */
export async function authorizationBlock(): Promise<{ code: "auth_expired"; message: string; status: 401 } | null> {
  const auth = await readStoredAuth();
  if (!auth.accessToken || auth.source !== "file") return null;
  if (auth.expiresAt == null || auth.expiresAt > Date.now()) return null;
  if (await canRefresh(auth)) return null;
  return { code: "auth_expired", message: AUTH_EXPIRED_MESSAGE, status: 401 };
}

function refreshCoalesced(): Promise<string | null> {
  if (!refreshInflight) {
    refreshInflight = performRefresh().finally(() => {
      refreshInflight = null;
    });
  }
  return refreshInflight;
}

async function performRefresh(): Promise<string | null> {
  const auth = await readStoredAuth();
  if (!auth.accessToken || auth.source !== "file") return null;
  if (!auth.refreshToken) {
    if (auth.expiresAt != null && auth.expiresAt - Date.now() <= REFRESH_SKEW_MS) {
      throw httpFail(401, AUTH_EXPIRED_MESSAGE, "auth_expired");
    }
    return null;
  }
  if (auth.refreshExpiresAt != null && auth.refreshExpiresAt <= Date.now()) {
    throw httpFail(401, AUTH_EXPIRED_MESSAGE, "auth_expired");
  }
  const secret = readClientSecret();
  // GitHub: client_secret is required unless the token came from the device flow.
  if (!auth.deviceFlow && !secret) throw httpFail(401, AUTH_EXPIRED_MESSAGE, "auth_expired");
  const clientId = await clientIdForRefresh();
  if (!clientId) throw httpFail(401, AUTH_EXPIRED_MESSAGE, "auth_expired");
  const issued = await refreshAccessToken({
    clientId,
    refreshToken: auth.refreshToken,
    clientSecret: secret,
  });
  await writeToken(issued.token, {
    refreshToken: issued.refreshToken ?? auth.refreshToken,
    expiresIn: issued.expiresIn,
    refreshExpiresIn: issued.refreshExpiresIn,
    deviceFlow: auth.deviceFlow,
  });
  return issued.token;
}

async function canRefresh(auth: StoredAuth): Promise<boolean> {
  if (!auth.refreshToken) return false;
  if (auth.refreshExpiresAt != null && auth.refreshExpiresAt <= Date.now()) return false;
  if (!auth.deviceFlow && !readClientSecret()) return false;
  return Boolean(await clientIdForRefresh());
}

async function clientIdForRefresh(): Promise<string | null> {
  const config = await loadConfig();
  return clientIdOf(config).id;
}

function readClientSecret(): string | null {
  const secret = process.env.NERDGRAM_GITHUB_CLIENT_SECRET?.trim() || "";
  if (!secret) return null;
  rememberSecret(secret);
  return secret;
}

function issuedFrom(body: Record<string, unknown>): IssuedToken {
  const token = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = stringField(body, "refresh_token");
  rememberSecret(token);
  if (refreshToken) rememberSecret(refreshToken);
  return {
    token,
    refreshToken,
    expiresIn: numberField(body, "expires_in"),
    refreshExpiresIn: numberField(body, "refresh_token_expires_in"),
  };
}

async function liveToken(fallback: string): Promise<string> {
  const fresh = await ensureAccessToken();
  return fresh || fallback;
}

function httpStatusOf(err: unknown): number | null {
  return readErrorStatus(err);
}

function statusFromMessage(message: string): number | null {
  const match = /\bHTTP Error:\s*(401|403)\b/.exec(message);
  return match ? Number(match[1]) : null;
}

function statusForAppCode(code: string): number {
  if (code === "auth_revoked" || code === "auth_expired" || code === "not_connected") return 401;
  if (code === "offline") return 503;
  if (code === "rate_limit") return 429;
  if (code === "not_fast_forward" || code === "conflicts" || code === "repo_not_empty") return 409;
  if (code === "repo_missing") return 404;
  if (code === "locked") return 423;
  if (code === "invalid" || code === "invalid_client" || code === "device_flow_disabled" || code === "name_taken") {
    return 400;
  }
  return 502;
}

function assertNoSecretInUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw httpFail(400, "The GitHub URL is not valid.", "invalid");
  }
  if (url.username || url.password) {
    throw httpFail(400, "Refusing to send a token in a URL.", "invalid");
  }
  for (const key of ["access_token", "token", "client_secret", "device_code"]) {
    if (url.searchParams.has(key)) {
      throw httpFail(400, "Refusing to send a token in a URL.", "invalid");
    }
  }
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
