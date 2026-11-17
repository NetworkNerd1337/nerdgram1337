import { describe, expect, it } from "vitest";
import {
  collapseBreadcrumb,
  editorBreadcrumb,
  editorExitHref,
  fullBreadcrumbTitle,
} from "../src/lib/editorBreadcrumb";
import type { TreeNode } from "../src/types";

function folder(path: string, children: TreeNode[] = []): TreeNode {
  const name = path.split("/").pop() ?? path;
  return { name, path, type: "folder", mtimeMs: 0, children };
}

describe("editor breadcrumb", () => {
  it("links each folder and keeps the file name, not a front matter title, as the last segment", () => {
    const segments = editorBreadcrumb("Field Sites/MTJ - Mitchell VA/MTJ - Mitchell - VA - Site Topology.mmd");
    expect(segments.map((segment) => segment.label)).toEqual([
      "Local files",
      "Field Sites",
      "MTJ - Mitchell VA",
      "MTJ - Mitchell - VA - Site Topology",
    ]);
    expect(segments[0]?.href).toBe("/");
    expect(segments[1]?.href).toBe("/?folder=Field+Sites");
    expect(segments[2]?.href).toBe("/?folder=Field+Sites%2FMTJ+-+Mitchell+VA");
    expect(segments[3]?.href).toBeNull();
    expect(fullBreadcrumbTitle(segments)).toBe(
      "Local files / Field Sites / MTJ - Mitchell VA / MTJ - Mitchell - VA - Site Topology",
    );
  });

  it("updates when the file is renamed or moved", () => {
    const before = editorBreadcrumb("Sites/Atlanta.mmd").map((segment) => segment.label);
    const renamed = editorBreadcrumb("Sites/Core.mmd").map((segment) => segment.label);
    const moved = editorBreadcrumb("Field Sites/Core.mmd").map((segment) => segment.label);
    expect(before).toEqual(["Local files", "Sites", "Atlanta"]);
    expect(renamed).toEqual(["Local files", "Sites", "Core"]);
    expect(moved).toEqual(["Local files", "Field Sites", "Core"]);
  });

  it("collapses the middle of a long path and puts the full path on the ellipsis", () => {
    const segments = editorBreadcrumb("A/B/C/D/Topology.mmd");
    expect(collapseBreadcrumb(segments).map((item) => ("kind" in item ? "…" : item.label))).toEqual([
      "Local files",
      "…",
      "D",
      "Topology",
    ]);
    const ellipsis = collapseBreadcrumb(segments).find((item) => "kind" in item);
    expect(ellipsis && "title" in ellipsis ? ellipsis.title : "").toBe("Local files / A / B / C / D / Topology");
    expect(collapseBreadcrumb(editorBreadcrumb("Sites/Atlanta.mmd"))).toEqual(editorBreadcrumb("Sites/Atlanta.mmd"));
  });

  it("returns to the diagram folder, the root, or the nearest folder that still exists", () => {
    const tree = [
      folder("Field Sites", [folder("Field Sites/MTJ - Mitchell VA", [folder("Field Sites/MTJ - Mitchell VA/Racks")])]),
      folder("Sites"),
    ];
    expect(editorExitHref("Field Sites/MTJ - Mitchell VA/Topology.mmd", tree)).toBe(
      "/?folder=Field+Sites%2FMTJ+-+Mitchell+VA",
    );
    expect(editorExitHref("Welcome.mmd", tree)).toBe("/");
    expect(editorExitHref("Field Sites/Gone/Topology.mmd", tree)).toBe("/?folder=Field+Sites");
    expect(editorExitHref("Missing/Topology.mmd", tree)).toBe("/");
    expect(editorExitHref("Field Sites/MTJ - Mitchell VA/Racks/Topology.mmd", [])).toBe("/");
  });
});
