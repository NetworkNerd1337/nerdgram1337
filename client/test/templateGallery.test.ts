import { describe, expect, it } from "vitest";
import { filterTemplates, folderInTree, groupTemplateSections, uniqueSorted } from "../src/lib/templateGallery";
import type { TreeNode } from "../src/types";

const cards = [
  {
    id: "network-topology",
    title: "Network topology",
    description: "A campus access path",
    tags: ["network", "vlan"],
    category: "Network",
    diagramType: "Flowchart",
  },
  {
    id: "home-lab",
    title: "Home lab",
    description: "Hypervisor and storage",
    tags: ["lab", "nas"],
    category: "Lab",
    diagramType: "Architecture",
  },
  {
    id: "sequence-starter",
    title: "Sequence starter",
    description: "A few participants",
    tags: ["sequence", "starter"],
    category: "Starter",
    diagramType: "Sequence",
  },
];

const tree: TreeNode[] = [
  {
    name: "Lab",
    path: "Lab",
    type: "folder",
    mtimeMs: 0,
    children: [
      { name: "Notes.mmd", path: "Lab/Notes.mmd", type: "file", mtimeMs: 0 },
      { name: "Nested", path: "Lab/Nested", type: "folder", mtimeMs: 0, children: [] },
    ],
  },
];

describe("template gallery filters", () => {
  it("matches name, description, tags, category, and diagram type", () => {
    expect(filterTemplates(cards, { query: "campus" }).map((item) => item.id)).toEqual([
      "network-topology",
    ]);
    expect(filterTemplates(cards, { query: "nas" }).map((item) => item.id)).toEqual(["home-lab"]);
    expect(filterTemplates(cards, { query: "starter" }).map((item) => item.id)).toEqual([
      "sequence-starter",
    ]);
    expect(filterTemplates(cards, { query: "architecture" }).map((item) => item.id)).toEqual([
      "home-lab",
    ]);
    expect(filterTemplates(cards, { query: "network" }).map((item) => item.id)).toEqual([
      "network-topology",
    ]);
    expect(filterTemplates(cards, {}).map((item) => item.id)).toEqual(cards.map((item) => item.id));
  });

  it("stacks category, type, and tag filters with the query", () => {
    expect(filterTemplates(cards, { category: "starter", diagramType: "Sequence" }).map((item) => item.id)).toEqual([
      "sequence-starter",
    ]);
    expect(filterTemplates(cards, { tag: "VLAN", query: "path" }).map((item) => item.id)).toEqual([
      "network-topology",
    ]);
    expect(filterTemplates(cards, { category: "Lab", query: "campus" })).toEqual([]);
    expect(uniqueSorted(["Starter", " lab ", "Lab", ""])).toEqual(["lab", "Starter"]);
  });

  it("recognizes folders in the workspace tree", () => {
    expect(folderInTree(tree, "")).toBe(true);
    expect(folderInTree(tree, "Lab")).toBe(true);
    expect(folderInTree(tree, "Lab/Nested")).toBe(true);
    expect(folderInTree(tree, "Lab/Notes.mmd")).toBe(false);
    expect(folderInTree(tree, "Missing")).toBe(false);
  });

  it("keeps every category, including empty ones, until a search is active", () => {
    const sections = groupTemplateSections(cards, {});
    expect(sections.map((section) => section.category)).toEqual([
      "Network",
      "Software",
      "Internet & Cloud",
      "Security",
      "OT & Industrial",
      "Data Center",
      "Operations & Planning",
      "User created",
      "Lab",
      "Starter",
    ]);
    expect(sections.find((section) => section.category === "User created")?.templates).toEqual([]);
    expect(sections.find((section) => section.category === "Network")?.templates.map((item) => item.id)).toEqual([
      "network-topology",
    ]);
    const filtered = groupTemplateSections(cards, { query: "campus" });
    expect(filtered.map((section) => section.category)).toEqual(["Network"]);
  });
});
