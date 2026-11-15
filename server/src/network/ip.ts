/** IPv4 and IPv6 network addresses. The same address text always yields the same network. */

export function parseIpv4(address: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address.trim());
  if (!match) return null;
  let value = 0;
  for (let index = 1; index <= 4; index += 1) {
    const octet = match[index] ?? "";
    if (octet.length > 1 && octet.startsWith("0")) return null;
    const number = Number(octet);
    if (!Number.isInteger(number) || number < 0 || number > 255) return null;
    value = (value << 8) | number;
  }
  return value >>> 0;
}

export function formatIpv4(value: number): string {
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

/** Network address in canonical form, such as `10.1.0.0/30`. Null when the address or prefix is not IPv4. */
export function ipv4Network(address: string, prefix: number): string | null {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const value = parseIpv4(address);
  if (value == null) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return `${formatIpv4((value & mask) >>> 0)}/${prefix}`;
}

/**
 * Eight hextets. Accepts compressed text and an IPv4 tail (`::ffff:192.0.2.1`).
 * A zone id is rejected.
 */
export function parseIpv6(address: string): Uint16Array | null {
  let text = address.trim().toLowerCase();
  if (!text || text.length > 64 || text.includes("%") || /\s/.test(text)) return null;
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 == null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    text = `${text.slice(0, lastColon)}:${hi}:${lo}`;
  }
  if (text.includes(":::")) return null;
  const pieces = text.split("::");
  if (pieces.length > 2) return null;

  const parseSide = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };

  const left = parseSide(pieces[0] ?? "");
  if (!left) return null;
  if (pieces.length === 1) {
    if (left.length !== 8) return null;
    return Uint16Array.from(left);
  }
  const right = parseSide(pieces[1] ?? "");
  if (!right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return Uint16Array.from([...left, ...new Array<number>(missing).fill(0), ...right]);
}

/** RFC 5952 text. The first longest run of two or more zeros becomes `::`. */
export function formatIpv6(groups: Uint16Array): string {
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let index = 0; index <= groups.length; index += 1) {
    const zero = index < groups.length && groups[index] === 0;
    if (zero && runStart < 0) runStart = index;
    if (!zero && runStart >= 0) {
      const length = index - runStart;
      if (length > bestLength) {
        bestStart = runStart;
        bestLength = length;
      }
      runStart = -1;
    }
  }
  const hex = (group: number) => group.toString(16);
  if (bestLength < 2) return [...groups].map(hex).join(":");
  const left = [...groups.slice(0, bestStart)].map(hex).join(":");
  const right = [...groups.slice(bestStart + bestLength)].map(hex).join(":");
  return `${left}::${right}`;
}

export function ipv6Network(address: string, prefix: number): string | null {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
  const groups = parseIpv6(address);
  if (!groups) return null;
  const out = new Uint16Array(groups);
  for (let bit = prefix; bit < 128; bit += 1) {
    const index = bit >> 4;
    const shift = 15 - (bit & 15);
    out[index] = (out[index]! & ~(1 << shift)) & 0xffff;
  }
  return `${formatIpv6(out)}/${prefix}`;
}

/** Canonical host text, so `2001:0db8::1` and `2001:db8::1` share a label. */
export function canonicalIp(address: string, family: "ipv4" | "ipv6"): string | null {
  if (family === "ipv4") {
    const value = parseIpv4(address);
    return value == null ? null : formatIpv4(value);
  }
  const groups = parseIpv6(address);
  return groups ? formatIpv6(groups) : null;
}
