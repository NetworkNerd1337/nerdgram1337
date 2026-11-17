import { describe, expect, it } from "vitest";
import { suggestTags, tagMatchParts, type TagCount } from "../src/lib/tagSuggestions";

const catalog: TagCount[] = [
  { tag: "firewall", count: 12 },
  { tag: "Firewall", count: 2 },
  { tag: "edge", count: 4 },
  { tag: "wifi", count: 1 },
  { tag: "lab", count: 9 },
];

describe("tag suggestions", () => {
  it("shows the most-used tags when the query is empty and skips tags already on the diagram", () => {
    const rows = suggestTags(catalog, "", ["firewall"]);
    expect(rows.map((row) => (row.kind === "tag" ? row.tag : row.text))).toEqual(["lab", "edge", "wifi"]);
    expect(rows.every((row) => row.kind === "tag")).toBe(true);
  });

  it("ranks a case-only match, then prefixes, then substrings, and offers create", () => {
    const rows = suggestTags(catalog, "Fire", []);
    expect(rows.map((row) => (row.kind === "tag" ? `${row.rank}:${row.tag}` : row.text))).toEqual([
      "prefix:firewall",
      "prefix:Firewall",
      "Fire",
    ]);
    const exactCase = suggestTags(catalog, "FIREWALL", []);
    expect(exactCase[0]).toMatchObject({ kind: "tag", tag: "firewall", rank: "case" });
    expect(exactCase.at(-1)).toEqual({ kind: "create", text: "FIREWALL" });
    expect(suggestTags(catalog, "firewall", []).some((row) => row.kind === "create")).toBe(false);
  });

  it("highlights the matched characters", () => {
    expect(tagMatchParts("firewall", "re")).toEqual([
      { text: "fi", match: false },
      { text: "re", match: true },
      { text: "wall", match: false },
    ]);
  });
});
