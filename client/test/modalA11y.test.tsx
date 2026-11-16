/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal } from "../src/components/Modal";
import { MoveDialog } from "../src/components/MoveDialog";
import type { TreeNode } from "../src/types";

const tree: TreeNode[] = [
  {
    type: "folder",
    name: "Sites",
    path: "Sites",
    mtimeMs: 0,
    children: [],
  },
];

describe("dialog keyboard access", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it("closes the shared modal on Escape and marks it as a dialog", async () => {
    let open = true;
    const render = () => {
      root?.render(
        open
          ? createElement(
              Modal,
              {
                title: "New folder",
                onClose: () => {
                  open = false;
                },
                onConfirm: () => undefined,
              },
              createElement("p", null, "Folder name"),
            )
          : createElement("p", null, "closed"),
      );
    };
    await act(async () => {
      render();
    });
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => {
      render();
    });
    expect(document.body.textContent).toContain("closed");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("focuses the Move dialog list when it opens", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Move a to another folder";
    document.body.appendChild(trigger);
    trigger.focus();
    await act(async () => {
      root?.render(
        createElement(MoveDialog, {
          itemPath: "Notes.mmd",
          isFolder: false,
          tree,
          initialFolder: "",
          onClose: () => undefined,
          onMoved: () => undefined,
        }),
      );
    });
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const active = document.activeElement;
    expect(active?.closest(".folder-picker")).not.toBeNull();
    expect(active).not.toBe(trigger);
    trigger.remove();
  });
});
