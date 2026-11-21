import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { documentedSourceNotices, githubHeadingAnchor } from "../src/lib/sourceNotice";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function headings(file: string): Set<string> {
  const text = readFileSync(path.join(repoRoot, file), "utf8");
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match?.[2]) found.add(githubHeadingAnchor(match[2]));
  }
  return found;
}

describe("source notice anchors", () => {
  it("points every From data source at a heading that exists", () => {
    const docs = new Map<string, Set<string>>();
    const notices = documentedSourceNotices();
    expect(notices.length).toBeGreaterThan(8);
    for (const notice of notices) {
      const url = new URL(notice.href);
      expect(url.pathname.endsWith(".md")).toBe(true);
      const file = url.pathname.split("/docs/")[1] ?? "";
      const hash = url.hash.slice(1);
      expect(hash.length).toBeGreaterThan(0);
      const anchors = docs.get(file) ?? headings(`docs/${file}`);
      docs.set(file, anchors);
      expect(anchors.has(hash), `${notice.id} -> ${file}#${hash}`).toBe(true);
    }
  });
});
