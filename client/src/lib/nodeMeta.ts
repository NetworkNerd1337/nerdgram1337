import { promptHost } from "../../../server/src/neighbors/clean.ts";

export type NodeMeta = {
  name: string;
  ips: string[];
  platforms: string[];
  interfaces: string[];
};

const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

type Bag = NodeMeta;

function bagFor(map: Map<string, Bag>, name: string): Bag | null {
  const cleaned = name.trim().replace(/\(([A-Za-z0-9_-]{4,})\)\s*$/, "").trim();
  if (!cleaned) return null;
  const key = cleaned.toLowerCase();
  const existing = map.get(key);
  if (existing) return existing;
  const created: Bag = { name: cleaned, ips: [], platforms: [], interfaces: [] };
  map.set(key, created);
  return created;
}

function add(list: string[], value: string) {
  const next = value.trim();
  if (!next || list.some((item) => item.toLowerCase() === next.toLowerCase())) return;
  list.push(next);
}

function addIps(list: string[], text: string) {
  for (const ip of text.match(IP) ?? []) add(list, ip);
}

/** Hostnames, addresses, platforms, and interfaces from a data file beside the diagram. */
export function metaFromSidecar(text: string): NodeMeta[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = metaFromJson(trimmed);
    if (json.length > 0) return json;
  }
  return metaFromCli(trimmed);
}

function metaFromJson(text: string): NodeMeta[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const map = new Map<string, Bag>();
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const devices = Array.isArray(root?.devices) ? root.devices : Array.isArray(parsed) ? parsed : [];
  for (const item of devices) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : typeof record.hostname === "string" ? record.hostname : "";
    const bag = bagFor(map, name);
    if (!bag) continue;
    if (typeof record.managementIp === "string") addIps(bag.ips, record.managementIp);
    if (typeof record.platform === "string") add(bag.platforms, record.platform);
    if (typeof record.model === "string") add(bag.platforms, record.model);
  }
  const interfaces = Array.isArray(root?.interfaces) ? root.interfaces : [];
  for (const item of interfaces) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const device = typeof record.device === "string" ? record.device : "";
    const bag = bagFor(map, device);
    if (!bag) continue;
    if (typeof record.name === "string") add(bag.interfaces, record.name);
    for (const list of [record.ipv4, record.ipv6]) {
      if (!Array.isArray(list)) continue;
      for (const address of list) {
        if (address && typeof address === "object" && typeof (address as { address?: unknown }).address === "string") {
          addIps(bag.ips, (address as { address: string }).address);
        }
      }
    }
  }
  return [...map.values()];
}

function metaFromCli(text: string): NodeMeta[] {
  const map = new Map<string, Bag>();
  let local: Bag | null = null;
  let current: Bag | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const host = promptHost(line);
    if (host) {
      local = bagFor(map, host);
      current = null;
      continue;
    }
    const device = /^(?:Device ID|System Name)\s*:\s*(.*)$/i.exec(line);
    if (device) {
      current = bagFor(map, device[1] ?? "");
      continue;
    }
    const ip = /^(?:IP address|IP|Management Address(?:es)?)\s*:\s*(.*)$/i.exec(line);
    if (ip) {
      addIps((current ?? local)?.ips ?? [], ip[1] || line);
      continue;
    }
    if (/^IP:\s*/i.test(line)) {
      addIps((current ?? local)?.ips ?? [], line);
      continue;
    }
    const platform = /^Platform\s*:\s*(.*)$/i.exec(line);
    if (platform && current) {
      const value = (platform[1] ?? "").replace(/,?\s*Capabilities\s*:.*$/i, "").trim();
      add(current.platforms, value);
      continue;
    }
    const iface = /^(?:Interface|Local Intf)\s*:\s*(.*)$/i.exec(line);
    if (iface) {
      const value = iface[1] ?? "";
      const combined = /^(.*?)\s*,\s*Port ID \(outgoing port\)\s*:\s*(.+)$/i.exec(value);
      const localPort = (combined?.[1] ?? value).replace(/,\s*$/, "").trim();
      const remotePort = combined?.[2]?.trim() ?? "";
      if (local && localPort) add(local.interfaces, localPort);
      if (current && localPort) add(current.interfaces, localPort);
      if (current && remotePort) add(current.interfaces, remotePort);
      continue;
    }
    const port = /^Port ID(?: \(outgoing port\))?\s*:\s*(.*)$/i.exec(line);
    if (port && current) add(current.interfaces, port[1] ?? "");
  }
  return [...map.values()];
}

/** Extra search text for one drawn node. Empty when the file has no row for it. */
export function metaTextForNode(label: string, id: string, meta: readonly NodeMeta[]): string {
  const names = [label.trim().toLowerCase(), id.trim().toLowerCase()].filter(Boolean);
  const hits = meta.filter((item) => {
    const name = item.name.toLowerCase();
    return names.some((candidate) => candidate === name || candidate.startsWith(`${name}.`) || name.startsWith(`${candidate}.`));
  });
  return hits
    .flatMap((item) => [item.name, ...item.ips, ...item.platforms, ...item.interfaces])
    .join(" ");
}
