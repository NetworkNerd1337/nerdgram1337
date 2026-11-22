/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/CommandPalette", () => ({
  CommandsButton: () => <button type="button">Commands</button>,
}));

import { Sidebar } from "../src/components/Sidebar";
import { EMPTY_BOOKMARKS } from "../src/lib/bookmarks";
import { builtinCommands } from "../src/lib/builtinCommands";

describe("sidebar syntax reference", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("puts Syntax reference in Your space after Diagram health and drops Reference", () => {
    act(() => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      root.render(
        <MemoryRouter>
          <Sidebar
            tree={[]}
            bookmarks={EMPTY_BOOKMARKS}
            onBookmarks={() => undefined}
            knownPaths={new Set()}
            recent={[]}
            onClearRecent={() => undefined}
            attentionCount={null}
            currentFolder=""
            search=""
            onSearch={() => undefined}
            onSelectFolder={() => undefined}
          />
        </MemoryRouter>,
      );
    });
    const labels = [...document.querySelectorAll(".nav-label")].map((item) => item.textContent);
    expect(labels).toEqual(["Your space", "Folders"]);
    expect(document.body.textContent).not.toContain("Needs attention");
    const space = document.querySelector(".nav-section");
    const order = [...(space?.querySelectorAll(".nav-link, .sidebar-block-title") ?? [])].map((item) =>
      item.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(order.slice(0, 8)).toEqual([
      "Dashboard",
      "Recent",
      "Bookmarks",
      "Template gallery",
      "Diagram health",
      "Syntax reference",
      "Settings",
      "Trash",
    ]);
    expect(space?.querySelector('a[href="/settings"]')?.textContent).toBe("Settings");
    expect(space?.querySelector('.nav-link[href^="/settings#"]')).toBeNull();
    const reference = space?.querySelector('a[href="/reference"]');
    expect(reference?.getAttribute("target")).toBe("_blank");
    expect(reference?.textContent).toBe("Syntax reference");
    expect(document.querySelector(".attention-badge")).toBeNull();
    expect(builtinCommands.find((command) => command.id === "nav.reference")?.title).toBe("Syntax reference");
  });
});