/**
 * @vitest-environment happy-dom
 */
import { openSearchPanel } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { editorSearchExtensions, editorSearchKeymap, FIND_SHORTCUT } from "../src/lib/editorCommands";
import { bindWorkspaceReplace, type ReplaceSeed } from "../src/lib/workspaceReplace";

describe("editor find bar", () => {
  const parents: HTMLElement[] = [];

  afterEach(() => {
    bindWorkspaceReplace(null);
    for (const parent of parents.splice(0)) parent.remove();
  });

  it("keeps find on this diagram and offers a link that opens workspace replace", () => {
    expect(editorSearchKeymap.some((binding) => binding.key === FIND_SHORTCUT)).toBe(true);
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    parents.push(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "flowchart LR\n  A[Core]\n",
        extensions: editorSearchExtensions(),
      }),
      parent,
    });
    openSearchPanel(view);
    const panel = parent.querySelector(".cm-search");
    expect(panel?.querySelector('input[name="search"]')).toBeTruthy();
    expect(panel?.querySelector('input[name="replace"]')).toBeTruthy();
    const button = panel?.querySelector<HTMLButtonElement>("[data-workspace-replace]");
    expect(button?.textContent).toBe("Replace in all diagrams…");
    const search = panel?.querySelector<HTMLInputElement>('input[name="search"]');
    const replace = panel?.querySelector<HTMLInputElement>('input[name="replace"]');
    const word = panel?.querySelector<HTMLInputElement>('input[name="word"]');
    if (search) search.value = "Core";
    if (replace) replace.value = "Hub";
    if (word) word.checked = true;
    let seed: ReplaceSeed | null = null;
    bindWorkspaceReplace((next) => {
      seed = next;
    });
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seed).toMatchObject({ find: "Core", replace: "Hub", wholeWord: true });
    view.destroy();
  });
});
