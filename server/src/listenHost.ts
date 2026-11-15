import net from "node:net";
import os from "node:os";
import path from "node:path";
import { getMetaPath } from "./paths.js";
import {
  isLoopbackBindHost,
  normalizeHostname,
  resolveBindHosts,
} from "./security.js";
import { atomicWriteJson, readJsonFile } from "./storage.js";

/**
 * The Host setting shown in the UI. Saving this value keeps today's default:
 * listen on 127.0.0.1 and ::1. It is not the same as HOST=127.0.0.1, which
 * binds IPv4 loopback only. The HOST environment variable wins when it is set.
 */
export const DEFAULT_LISTEN_HOST = "127.0.0.1";

/** Persisted under the data directory, next to the other `.meta` settings. */
export const LISTEN_HOST_FILE = "listen-host.json";

export type ListenHostSource = "env" | "saved" | "default";

export type SavedListenHost = {
  persisted: boolean;
  /** Valid saved address, or null when the file is missing or unusable. */
  host: string | null;
  invalid: boolean;
};

export type HostParse = { ok: true; host: string } | { ok: false; error: string };

const HOST_ERROR =
  "Host must be an IPv4 or IPv6 address, 0.0.0.0, or ::. A hostname is not accepted here; add a DNS name with NERDGRAM_ALLOWED_HOSTS.";

export function listenHostPath(): string {
  return path.join(getMetaPath(), LISTEN_HOST_FILE);
}

/**
 * Accept an IPv4 or IPv6 address, including the wildcard binds 0.0.0.0 and ::.
 * Bracketed IPv6 is accepted and stored without brackets, which is what
 * `server.listen` expects. Hostnames are rejected.
 */
export function parseListenHostInput(value: unknown): HostParse {
  if (typeof value !== "string") return { ok: false, error: HOST_ERROR };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Host is required." };
  if (trimmed.includes("%") || trimmed.includes("/") || trimmed.includes("\\") || /\s/.test(trimmed)) {
    return { ok: false, error: HOST_ERROR };
  }
  let body = trimmed;
  if (body.startsWith("[") && body.endsWith("]") && body.length > 2) {
    body = body.slice(1, -1);
    if (body.includes("[") || body.includes("]")) return { ok: false, error: HOST_ERROR };
  }
  const kind = net.isIP(body);
  if (kind !== 4 && kind !== 6) return { ok: false, error: HOST_ERROR };
  return { ok: true, host: kind === 6 ? body.toLowerCase() : body };
}

export function isWildcardBind(host: string): boolean {
  const name = normalizeHostname(host);
  return name === "0.0.0.0" || name === "::";
}

/**
 * HOST, when set, wins. A saved address other than 127.0.0.1 is next.
 * A missing file, or a saved 127.0.0.1, is today's loopback pair.
 */
export function resolveEffectiveBind(input: {
  envHost: string | undefined;
  savedHost: string | null;
}): { hosts: string[]; source: ListenHostSource; envOverrides: boolean } {
  const env = input.envHost?.trim() ?? "";
  if (env) {
    return { hosts: resolveBindHosts(env), source: "env", envOverrides: true };
  }
  if (input.savedHost && input.savedHost !== DEFAULT_LISTEN_HOST) {
    return { hosts: resolveBindHosts(input.savedHost), source: "saved", envOverrides: false };
  }
  return { hosts: resolveBindHosts(undefined), source: "default", envOverrides: false };
}

/**
 * The Host value this process was started with.
 * HOST wins. The default loopback pair is reported as 127.0.0.1, which is
 * the saved value that produces that pair.
 */
export function runningListenHost(input: {
  envHost: string | undefined;
  boundHosts: readonly string[];
}): string {
  const env = input.envHost?.trim() ?? "";
  if (env) {
    const parsed = parseListenHostInput(env);
    return parsed.ok ? parsed.host : env;
  }
  const hosts = input.boundHosts.map((host) => host.trim()).filter(Boolean);
  const loopbackPair =
    hosts.length === 2 && hosts.includes("127.0.0.1") && hosts.includes("::1");
  if (hosts.length === 0 || loopbackPair) return DEFAULT_LISTEN_HOST;
  if (hosts.length === 1) {
    const parsed = parseListenHostInput(hosts[0] ?? "");
    return parsed.ok ? parsed.host : hosts[0] ?? DEFAULT_LISTEN_HOST;
  }
  return DEFAULT_LISTEN_HOST;
}

/**
 * True only while a persisted Host differs from the address this process
 * started with. A restart that is already listening on the saved address
 * clears it, including when that address is not 127.0.0.1.
 */
export function hostRestartNotice(savedHost: string | null, runningHost: string): boolean {
  if (savedHost == null) return false;
  return savedHost !== runningHost;
}

/**
 * Non-loopback addresses on this machine. Link-local zone ids are stripped
 * because a Host header does not carry them. Loopback and internal interfaces
 * are skipped. 0.0.0.0 and :: are bind wildcards, not Host names.
 */
export function listNonLoopbackInterfaceAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue;
      let address = entry.address.trim();
      const zone = address.indexOf("%");
      if (zone !== -1) address = address.slice(0, zone);
      const kind = net.isIP(address);
      if (kind === 6) address = address.toLowerCase();
      if (kind !== 4 && kind !== 6) continue;
      if (isLoopbackBindHost(address) || isWildcardBind(address)) continue;
      if (seen.has(address)) continue;
      seen.add(address);
      found.push(address);
    }
  }
  return found;
}

/**
 * Host names implied by the address actually bound.
 * A specific IP is allowed as itself. `IP:port` is the same name plus the
 * listen port, which the Host check compares separately.
 * 0.0.0.0 and :: are not Host names. Callers use the machine's non-loopback
 * interface addresses, discovered at startup, instead.
 * Loopback names are added by `buildAllowedHostnames` and are not repeated here.
 */
export function hostsFromListenAddress(
  bindHosts: readonly string[],
  interfaceAddresses: readonly string[],
): string[] {
  const extra: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const name = normalizeHostname(value);
    if (!name || name === "*" || name === "0.0.0.0" || name === "::") return;
    if (isLoopbackBindHost(name)) return;
    if (seen.has(name)) return;
    seen.add(name);
    extra.push(name);
  };
  if (bindHosts.some((host) => isWildcardBind(host))) {
    for (const address of interfaceAddresses) add(address);
  }
  for (const host of bindHosts) {
    if (isWildcardBind(host)) continue;
    add(host);
  }
  return extra;
}

/**
 * Setting-derived names first, then NERDGRAM_ALLOWED_HOSTS. Duplicates drop.
 * `*`, `0.0.0.0`, and `::` stay ignored, matching the Host check.
 */
export function mergeAllowedHosts(
  settingHosts: readonly string[],
  configuredHosts: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const host of [...settingHosts, ...configuredHosts]) {
    const name = normalizeHostname(host);
    if (!name || name === "*" || name === "0.0.0.0" || name === "::") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    merged.push(name);
  }
  return merged;
}

export function formatListenHostLog(input: {
  hosts: readonly string[];
  source: ListenHostSource;
  envHost: string | null;
  savedHost: string | null;
}): string {
  const list = input.hosts.join(", ");
  if (input.source === "env") {
    const saved =
      input.savedHost && input.savedHost !== DEFAULT_LISTEN_HOST
        ? ` It overrides the saved Host setting ${input.savedHost}.`
        : " A saved Host setting is not used while HOST is set.";
    return `Listen host: ${list} (HOST=${input.envHost}).${saved}`;
  }
  if (input.source === "saved") {
    return `Listen host: ${list} (saved Host setting). A change applies on the next manual start. NerdGram does not restart itself.`;
  }
  return `Listen host: ${list} (default). HOST is unset and the saved Host setting is ${input.savedHost ?? DEFAULT_LISTEN_HOST}.`;
}

export async function readSavedListenHost(): Promise<SavedListenHost> {
  let file: unknown;
  try {
    file = await readJsonFile<unknown>(listenHostPath());
  } catch {
    return { persisted: true, host: null, invalid: true };
  }
  if (file == null) return { persisted: false, host: null, invalid: false };
  if (typeof file !== "object" || Array.isArray(file)) {
    return { persisted: true, host: null, invalid: true };
  }
  const parsed = parseListenHostInput((file as { host?: unknown }).host);
  if (!parsed.ok) return { persisted: true, host: null, invalid: true };
  return { persisted: true, host: parsed.host, invalid: false };
}

export async function writeSavedListenHost(host: string): Promise<void> {
  await atomicWriteJson(listenHostPath(), { host });
}

export type ListenHostStatus = {
  /** Value in the text box. A missing file is shown as 127.0.0.1. */
  saved: string;
  persisted: boolean;
  invalid: boolean;
  /** Addresses this process was asked to bind. */
  effectiveHosts: string[];
  source: ListenHostSource;
  envHost: string | null;
  /** True when HOST is set, even if it matches the saved value. */
  envOverrides: boolean;
  docker: boolean;
  /** Docker installs cannot change the bind from the UI. */
  readOnly: boolean;
  /**
   * Host value this process started with. The UI shows the restart notice
   * only while `saved` differs from this.
   */
  running: string;
  /**
   * True only while a persisted Host differs from `running`.
   * A missing file does not ask for a restart.
   */
  restartNotice: boolean;
  /**
   * Non-loopback Host names this process accepts because of the bind.
   * Empty on the default loopback bind. Discovery is included for 0.0.0.0 and ::.
   */
  acceptedHosts: string[];
};

export function describeListenHost(input: {
  envHost: string | undefined;
  saved: SavedListenHost;
  boundHosts: readonly string[];
  docker: boolean;
  interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}): ListenHostStatus {
  const decision = resolveEffectiveBind({
    envHost: input.envHost,
    savedHost: input.saved.invalid ? null : input.saved.host,
  });
  const effectiveHosts = input.boundHosts.length > 0 ? [...input.boundHosts] : decision.hosts;
  const discovered = effectiveHosts.some((host) => isWildcardBind(host))
    ? listNonLoopbackInterfaceAddresses(input.interfaces)
    : [];
  const envHost = input.envHost?.trim() ? input.envHost.trim() : null;
  const running = runningListenHost({ envHost: input.envHost, boundHosts: effectiveHosts });
  return {
    saved: input.saved.host ?? DEFAULT_LISTEN_HOST,
    persisted: input.saved.persisted,
    invalid: input.saved.invalid,
    effectiveHosts,
    source: decision.source,
    envHost,
    envOverrides: decision.envOverrides,
    docker: input.docker,
    readOnly: input.docker,
    running,
    restartNotice: hostRestartNotice(input.saved.invalid ? null : input.saved.host, running),
    acceptedHosts: hostsFromListenAddress(effectiveHosts, discovered),
  };
}
