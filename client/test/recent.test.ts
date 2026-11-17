import { describe, expect, it } from "vitest";
import { pruneRecent, rewriteRecent, touchRecent, type RecentEntry } from "../src/lib/recent";

describe("recent diagrams", () => {
  it("keeps the ten newest, follows a rename, and drops missing files", () => {
    let entries: RecentEntry[] = [];
    for (let index = 0; index < 12; index += 1) {
      entries = touchRecent(entries, `File ${index}.mmd`, index);
    }
    expect(entries).toHaveLength(10);
    expect(entries[0]?.path).toBe("File 11.mmd");
    entries = touchRecent(entries, "File 5.mmd", 20);
    expect(entries[0]?.path).toBe("File 5.mmd");
    expect(entries.filter((item) => item.path === "File 5.mmd")).toHaveLength(1);

    const renamed = rewriteRecent(entries, "Sites", "Archive/Sites", true);
    expect(renamed.find((item) => item.path.startsWith("Archive/"))).toBeUndefined();
    const moved = rewriteRecent([{ path: "Sites/Atlanta.mmd", at: 1 }], "Sites", "Archive/Sites", true);
    expect(moved[0]?.path).toBe("Archive/Sites/Atlanta.mmd");

    const existing = new Set(["File 11.mmd"]);
    expect(pruneRecent(entries, existing).map((item) => item.path)).toEqual(["File 11.mmd"]);
  });
});
