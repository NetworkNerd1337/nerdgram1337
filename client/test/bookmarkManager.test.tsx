/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookmarkManager } from "../src/components/BookmarkManager";

const bookmarks = vi.hoisted(() => ({
  folders: [
    { id: "sites", name: "Sites", parentId: null },
    { id: "lab", name: "Lab", parentId: "sites" },
  ],
  items: [{ path: "WAN.mmd", folderId: "lab" }],
}));

vi.mock("../src/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    bookmarks,
    saveBookmarks: vi.fn(async (next: unknown) => next),
    tree: [],
    loading: false,
  }),
}));

describe("bookmark settings", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("shows a nested folder tree and does not offer Reload", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <MemoryRouter>
          <BookmarkManager />
        </MemoryRouter>,
      );
    });

    expect(document.querySelector("button")?.textContent ?? "").not.toBe("Reload");
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Reload")).toBe(false);
    expect(document.body.textContent).toContain("Sites / Lab");
    const lab = document.querySelector("#folder-lab") as HTMLInputElement;
    expect(lab.value).toBe("Lab");
    act(() => {
      document.querySelector<HTMLButtonElement>("button[aria-label='Collapse Sites']")?.click();
    });
    expect(document.querySelector("#folder-lab")).toBeNull();
    act(() => {
      document.querySelector<HTMLButtonElement>("button[aria-label='Expand Sites']")?.click();
    });
    expect(document.querySelector("#folder-lab")).toBeTruthy();
  });
});
