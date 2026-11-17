import { describe, expect, it } from "vitest";
import { diagramCardLabel, folderCountLabel } from "../src/lib/diagramLabel";
import type { TreeNode } from "../src/types";

function folder(path: string, children: TreeNode[] = []): TreeNode {
  const name = path.split("/").pop() ?? path;
  return { name, path, type: "folder", mtimeMs: 0, children };
}

function file(path: string): TreeNode {
  const name = path.split("/").pop() ?? path;
  return { name, path, type: "file", mtimeMs: 0 };
}

describe("diagram card labels", () => {
  it("uses the file name and adds a title line only when the title differs", () => {
    expect(diagramCardLabel("Sites/Atlanta.mmd", null)).toEqual({ name: "Atlanta", subtitle: null });
    expect(diagramCardLabel("Sites/Atlanta.mmd", "  ")).toEqual({ name: "Atlanta", subtitle: null });
    expect(diagramCardLabel("Sites/Atlanta.mmd", "Atlanta")).toEqual({ name: "Atlanta", subtitle: null });
    expect(diagramCardLabel("Sites/Atlanta.mmd", "Atlanta site")).toEqual({
      name: "Atlanta",
      subtitle: "Atlanta site",
    });
  });
});

describe("folder card counts", () => {
  it("counts direct diagrams and subfolders, and hides a zero folder count", () => {
    const onlyFiles = folder("Lab", [file("Lab/A.mmd")]);
    expect(folderCountLabel(onlyFiles)).toBe("1 diagram");

    const nested = folder("Field Sites", [
      folder("Field Sites/MTJ", [file("Field Sites/MTJ/Rack.mmd"), folder("Field Sites/MTJ/Spare")]),
      folder("Field Sites/Other"),
    ]);
    expect(folderCountLabel(nested)).toBe("0 diagrams · 2 folders");

    const mixed = folder("Sites", [file("Sites/Atlanta.mmd"), folder("Sites/Labs")]);
    expect(folderCountLabel(mixed)).toBe("1 diagram · 1 folder");

    expect(folderCountLabel(folder("Empty"))).toBe("0 diagrams");
  });
});
