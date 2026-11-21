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
            attentionCount={0}
            currentFolder=""
            search=""
            onSearch={() => undefined}
            onSelectFolder={() => undefined}
          />
        </MemoryRouter>,
      );
    });
    const labels = [...document.querySelectorAll(".nav-label")].map((item) => item.textContent);
    expect(labels).toContain("Your space");
    expect(labels).not.toContain("Reference");
    const space = [...document.querySelectorAll(".nav-section")].find((section) => section.textContent?.includes("Your space"));
    const links = [...(space?.querySelectorAll("a,button") ?? [])].map((item) => item.textContent?.trim());
    expect(links.slice(0, 3)).toEqual(["Dashboard", "Diagram health", "Syntax reference"]);
    const reference = space?.querySelector('a[href="/reference"]');
    expect(reference?.getAttribute("target")).toBe("_blank");
    expect(reference?.textContent).toBe("Syntax reference");
    expect(builtinCommands.find((command) => command.id === "nav.reference")?.title).toBe("Syntax reference");
  });
});