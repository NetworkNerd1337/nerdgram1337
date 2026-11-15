import { SearchQuery, search, searchKeymap, gotoLine, openSearchPanel, setSearchQuery } from "@codemirror/search";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type EditorView as EditorViewType, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { lineIsComfortablyVisible } from "./sourceJump";
import { openWorkspaceReplace } from "./workspaceReplace";

/**
 * Find, replace, and go-to-line use the installed `@codemirror/search` keymap.
 * Mod-f is taken only while the editor is focused. Go to line is Mod-Alt-g
 * so the browser keeps Mod-l for the address bar. Mod-d (bookmark), Mod-/,
 * F5, and Mod-Shift-Enter are left alone.
 */
export const FIND_SHORTCUT = "Mod-f";
export const GO_TO_LINE_SHORTCUT = "Mod-Alt-g";

const BLOCKED_EDITOR_SHORTCUTS = new Set([
  "F5",
  "Mod-Shift-Enter",
  "Mod-/",
  "Mod-l",
  "Mod-L",
  "Mod-d",
  "Mod-k",
]);

export function isBlockedEditorShortcut(key: string | undefined): boolean {
  if (!key) return false;
  return key.split(/\s+/).some((part) => BLOCKED_EDITOR_SHORTCUTS.has(part));
}

const filteredSearchKeymap: readonly KeyBinding[] = searchKeymap
  .filter((binding) => !isBlockedEditorShortcut(binding.key))
  .map((binding) => ({ ...binding, preventDefault: true }));

export const editorSearchKeymap: readonly KeyBinding[] = filteredSearchKeymap.some(
  (binding) => binding.key === GO_TO_LINE_SHORTCUT,
)
  ? filteredSearchKeymap
  : [...filteredSearchKeymap, { key: GO_TO_LINE_SHORTCUT, run: gotoLine, preventDefault: true }];

function readPanelFlag(panel: ParentNode, name: string): boolean {
  return Boolean(panel.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked);
}

/**
 * Adds a link on the existing find panel. The panel's own find and replace
 * still change only this diagram.
 */
const workspaceReplaceLink = ViewPlugin.fromClass(
  class {
    ensure(view: EditorViewType): void {
      const panel = view.dom.querySelector<HTMLElement>(".cm-search");
      if (!panel || panel.querySelector("[data-workspace-replace]")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-workspace-replace";
      button.dataset.workspaceReplace = "true";
      button.textContent = "Replace in all diagrams…";
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const value = (name: string) => panel.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";
        openWorkspaceReplace({
          find: value("search"),
          replace: value("replace"),
          matchCase: readPanelFlag(panel, "case"),
          wholeWord: readPanelFlag(panel, "word"),
          regex: readPanelFlag(panel, "re"),
        });
      });
      panel.appendChild(button);
    }

    constructor(view: EditorViewType) {
      this.ensure(view);
    }

    update(update: ViewUpdate): void {
      this.ensure(update.view);
    }
  },
);

export function editorSearchExtensions(): Extension[] {
  return [search({ top: true }), workspaceReplaceLink, Prec.high(keymap.of(editorSearchKeymap))];
}

let editorView: EditorViewType | null = null;

export function bindEditorView(view: EditorViewType | null): void {
  editorView = view;
}

export function getEditorView(): EditorViewType | null {
  return editorView;
}

function withEditor(run: (view: EditorViewType) => boolean): boolean {
  const view = editorView;
  if (!view) return false;
  view.focus();
  return run(view);
}

export function runFind(): boolean {
  return withEditor((view) => openSearchPanel(view));
}

export function runReplace(): boolean {
  return withEditor((view) => {
    const opened = openSearchPanel(view);
    const input = view.dom.querySelector<HTMLInputElement>('input[name="replace"]');
    input?.focus();
    input?.select();
    return opened;
  });
}

export function runGotoLine(): boolean {
  return withEditor((view) => gotoLine(view));
}

/**
 * Select a search hit and scroll it into view. Opens the find panel when a
 * query is known so the existing find UI shows the same match. Returns false
 * until the editor has the document.
 */
export function revealEditorMatch(line: number | null, query: string): boolean {
  const view = editorView;
  if (!view) return false;
  const needle = query.trim();
  const doc = view.state.doc;
  if (doc.length === 0 && (needle.length > 0 || (line != null && line > 1))) return false;
  if (needle && !doc.toString().toLowerCase().includes(needle.toLowerCase())) {
    if (doc.length < needle.length) return false;
  }

  let from = 0;
  let to = 0;
  const hasLine = line != null && line >= 1 && line <= doc.lines;
  if (hasLine && line != null) {
    const lineObj = doc.line(line);
    from = lineObj.from;
    to = lineObj.from;
    if (needle) {
      const idx = lineObj.text.toLowerCase().indexOf(needle.toLowerCase());
      if (idx >= 0) {
        from = lineObj.from + idx;
        to = from + needle.length;
      }
    }
  } else if (needle) {
    const idx = doc.toString().toLowerCase().indexOf(needle.toLowerCase());
    if (idx >= 0) {
      from = idx;
      to = idx + needle.length;
    }
  }

  view.dispatch({
    selection: { anchor: from, head: to },
    scrollIntoView: true,
    effects: needle
      ? setSearchQuery.of(new SearchQuery({ search: needle, caseSensitive: false }))
      : [],
  });
  if (needle) openSearchPanel(view);
  view.focus();
  return true;
}

/**
 * Put the caret on a source line. Scroll so the line is centered when it is
 * outside the comfortable area; leave the scroll alone when it is already
 * visible. Focus uses CodeMirror's prevent-scroll focus so the page does not jump.
 */
export function revealEditorLine(line: number, column: number): boolean {
  const view = editorView;
  if (!view) return false;
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return false;
  const lineObj = doc.line(line);
  const clamped = Math.max(0, Math.min(column, lineObj.length));
  const pos = lineObj.from + clamped;
  const effects = lineComfortablyInView(view, pos)
    ? []
    : EditorView.scrollIntoView(pos, { y: "center", yMargin: 48 });
  view.dispatch({
    selection: { anchor: pos },
    effects,
  });
  view.focus();
  return true;
}

function lineComfortablyInView(view: EditorViewType, pos: number): boolean {
  const coords = view.coordsAtPos(pos);
  if (!coords) return false;
  const scroller = view.scrollDOM.getBoundingClientRect();
  const win = view.dom.ownerDocument.defaultView;
  const top = Math.max(scroller.top, 0);
  const bottom = Math.min(scroller.bottom, win?.innerHeight ?? scroller.bottom);
  return lineIsComfortablyVisible(top, bottom, coords.top, coords.bottom);
}
