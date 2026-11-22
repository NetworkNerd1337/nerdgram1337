/**
 * Drop `ch` from both ends. A character walk stays linear when `ch` is
 * repeated. A regex such as `/^\/+|\/+$/` retries the unanchored end
 * alternative at every character.
 *
 * This file stays free of Node builtins. The client typecheck imports server
 * modules that trim paths, and those modules must not pull in `fs` or `path`.
 */
export function trimChar(value: string, ch: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === ch) start += 1;
  while (end > start && value[end - 1] === ch) end -= 1;
  return value.slice(start, end);
}

export function trimSlashes(value: string): string {
  return trimChar(value, "/");
}
