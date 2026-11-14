/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceReplaceDialog } from "../src/components/WorkspaceReplaceDialog";

const replacePreview = vi.hoisted(() => vi.fn());
const replaceApply = vi.hoisted(() => vi.fn());
const replaceUndo = vi.hoisted(() => vi.fn());

vi.mock("../src/api", () => ({
  api: { replacePreview, replaceApply, replaceUndo },
  ApiError: class ApiError extends Error {},
}));

const preview = {
  find: "CORE-SW1",
  replace: "ATL-CORE-01",
  matchCase: false,
  wholeWord: false,
  regex: false,
  includeFrontMatter: false,
  scope: { folder: null, recursive: true, paths: null },
  totals: { replacements: 2, diagrams: 2, shown: 2 },
  truncated: false,
  message: null,
  excluded: [],
  files: [
    {
      path: "Live.mmd",
      hash: "hash-live",
      mtimeMs: 1,
      matchCount: 1,
      shownCount: 1,
      truncated: false,
      selected: true,
      generated: true,
      dataFile: "Live.csv",
      generatedWarning: "Generated from Live.csv. Refresh from data would overwrite this change.",
      lint: { invalid: false, newlyInvalid: false, messages: [] },
      matches: [
        {
          id: "10:18",
          line: 2,
          column: 3,
          before: "  CORE-SW1[Core]",
          after: "  ATL-CORE-01[Core]",
          matchStart: 2,
          matchLength: 8,
          replaceLength: 11,
          contextBefore: "flowchart LR",
          contextAfter: null,
          warnings: ["node-id"],
          selected: true,
        },
      ],
    },
    {
      path: "Broken.mmd",
      hash: "hash-bad",
      mtimeMs: 1,
      matchCount: 1,
      shownCount: 1,
      truncated: false,
      selected: false,
      generated: false,
      dataFile: null,
      generatedWarning: null,
      lint: { invalid: true, newlyInvalid: true, messages: ["Parse error"] },
      matches: [
        {
          id: "0:4",
          line: 1,
          column: 1,
          before: "nope CORE",
          after: "nope EDGE",
          matchStart: 5,
          matchLength: 4,
          replaceLength: 4,
          contextBefore: null,
          contextAfter: null,
          warnings: [],
          selected: true,
        },
      ],
    },
  ],
};

describe("workspace replace dialog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    replacePreview.mockReset();
    replaceApply.mockReset();
    replaceUndo.mockReset();
  });

  it("previews, leaves an invalid diagram unchecked, applies the rest, and undoes the batch", async () => {
    replacePreview.mockResolvedValue(preview);
    replaceApply.mockResolvedValue({
      operationId: "op-1",
      changed: [{ path: "Live.mmd", revisionId: "rev-1", hash: "after", replacements: 1 }],
      skipped: [],
      errors: [],
      totals: { diagrams: 1, replacements: 1 },
    });
    replaceUndo.mockResolvedValue({ id: "op-1", restored: [{ path: "Live.mmd", hash: "before" }], skipped: [], errors: [] });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<WorkspaceReplaceDialog seed={{ find: "CORE-SW1", replace: "ATL-CORE-01" }} onClose={() => undefined} />);
    });

    expect(container.querySelector<HTMLInputElement>("#replace-find")?.value).toBe("CORE-SW1");
    const form = container.querySelector("form");
    await act(async () => {
      form?.requestSubmit();
    });

    expect(replacePreview).toHaveBeenCalledWith(expect.objectContaining({ find: "CORE-SW1", replace: "ATL-CORE-01" }));
    expect(container.textContent).toContain("2 replacements in 2 diagrams");
    expect(container.textContent).toContain("Refresh from data");
    expect(container.textContent).toContain("node id");
    expect(container.textContent).toContain("would make the diagram invalid");
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input[type='checkbox']")];
    const fileBoxes = boxes.filter((box) => box.closest(".replace-file-label"));
    expect(fileBoxes[0]?.checked).toBe(true);
    expect(fileBoxes[1]?.checked).toBe(false);

    const applyButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Replace");
    await act(async () => {
      applyButton?.click();
    });
    expect(replaceApply).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ path: "Live.mmd", hash: "hash-live" })],
      }),
    );
    const sent = replaceApply.mock.calls[0]?.[0] as { files: { path: string }[] };
    expect(sent.files.map((file) => file.path)).toEqual(["Live.mmd"]);
    expect(container.textContent).toContain("Undo this replace");

    const undo = [...container.querySelectorAll("button")].find((button) => button.textContent === "Undo this replace");
    await act(async () => {
      undo?.click();
    });
    expect(replaceUndo).toHaveBeenCalledWith("op-1");
    expect(container.textContent).toContain("undone");
  });
});
