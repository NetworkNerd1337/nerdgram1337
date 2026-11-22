/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ImportDialog } from "../src/components/ImportDialog";
import type { ImportDraft } from "../src/lib/importDrafts";
import type { TreeNode } from "../src/types";

const tree: TreeNode[] = [{ name: "Campus.mmd", path: "Campus.mmd", type: "file", mtimeMs: 1 }];

function draft(id: string, name = "Campus.mmd"): ImportDraft {
  return {
    id,
    sourceName: name,
    text: "flowchart LR\n  a --> b\n",
    diagramName: "Campus.mmd",
  };
}

describe("import rename row", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  function render(drafts: ImportDraft[]) {
    act(() => {
      if (!root) {
        const host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
      }
      root?.render(
        <ImportDialog tree={tree} folder="" drafts={drafts} onFolderChange={() => undefined} onClose={() => undefined} onDone={() => undefined} />,
      );
    });
  }

  it("shows the free name and drops the clash once Rename is chosen", () => {
    render([draft("one")]);
    expect(document.body.textContent).toContain("Saves as Campus.mmd");
    expect(document.body.textContent).toContain("This name is taken");

    const select = document.querySelector("select");
    expect(select).toBeTruthy();
    act(() => {
      const prototype = Object.getPrototypeOf(select) as object;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(select, "rename");
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Saves as Campus 2.mmd");
    expect(document.body.textContent).not.toContain("This name is taken");
    expect(select?.value).toBe("rename");
  });

  it("renames every clash to its own free name", () => {
    render([draft("one", "Campus.mmd"), draft("two", "Other.mmd")]);
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Rename all");
    act(() => button?.click());
    const text = document.body.textContent ?? "";
    expect(text).toContain("Saves as Campus 2.mmd");
    expect(text).toContain("Saves as Campus 3.mmd");
    expect(text).not.toContain("This name is taken");
  });
});
