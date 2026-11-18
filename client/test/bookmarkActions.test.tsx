/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BookmarksSection } from "../src/components/BookmarksSection";
import type { BookmarkState } from "../src/lib/bookmarks";

const state: BookmarkState = {
  folders: [{ id: "f1", name: "Sites" }],
  items: [{ path: "Field Sites/Palo Alto SD-WAN.mmd", folderId: null }],
};

describe("bookmark rows", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("keeps the name readable and reaches every action from the keyboard", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <MemoryRouter>
          <BookmarksSection state={state} knownPaths={new Set(state.items.map((item) => item.path))} onChange={() => undefined} />
        </MemoryRouter>,
      );
    });

    const label = document.querySelector(".sidebar-row-label");
    expect(label?.textContent).toContain("Palo Alto SD-WAN");
    expect(label?.getAttribute("title")).toContain("Palo Alto SD-WAN.mmd");
    expect(document.body.textContent).not.toContain("Remove");

    const actions = document.querySelector<HTMLButtonElement>("button[aria-label='Actions for Palo Alto SD-WAN']");
    expect(actions?.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      actions?.click();
    });
    expect(actions?.getAttribute("aria-expanded")).toBe("true");
    for (const name of ["Move Palo Alto SD-WAN up", "Move Palo Alto SD-WAN down", "Folder for Palo Alto SD-WAN", "Remove bookmark Palo Alto SD-WAN"]) {
      expect(document.querySelector(`[aria-label='${name}']`)).toBeTruthy();
    }
  });
});
