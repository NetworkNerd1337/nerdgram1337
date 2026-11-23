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
    expect(document.querySelector(".nav-label")).toBeNull();
    expect(document.body.textContent).not.toContain("Commands");
    expect(document.querySelector("[aria-label='Navigation']")).toBeTruthy();
    expect(document.querySelector(".tree")).toBeNull();
    expect(document.querySelector("#folders-heading")).toBeNull();
    expect(document.querySelector(".sidebar-split")).toBeTruthy();
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
    expect(document.querySelector('a[href="/health"]')?.getAttribute("aria-label")).toBe("Diagram health");
    expect(builtinCommands.find((command) => command.id === "nav.reference")?.title).toBe("Syntax reference");
  });

  it("shows a health count only when there is at least one issue", () => {
    const render = (attentionCount: number | null) => {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root.render(
          <MemoryRouter>
            <Sidebar
              tree={[]}
              bookmarks={EMPTY_BOOKMARKS}
              onBookmarks={() => undefined}
              knownPaths={new Set()}
              recent={[]}
              onClearRecent={() => undefined}
              attentionCount={attentionCount}
              currentFolder=""
              search=""
              onSearch={() => undefined}
              onSelectFolder={() => undefined}
            />
          </MemoryRouter>,
        );
      });
    };
    render(0);
    const link = () => document.querySelector('a[href="/health"]');
    expect(link()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Diagram health");
    expect(link()?.getAttribute("aria-label")).toBe("Diagram health");
    expect(document.querySelector(".attention-badge")).toBeNull();
    const quietHeight = link()?.getBoundingClientRect().height ?? 0;
    render(3);
    expect(link()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Diagram health (3)");
    expect(link()?.getAttribute("aria-label")).toBe("Diagram health, 3 issues");
    expect(document.querySelector(".attention-badge")?.getAttribute("aria-hidden")).toBe("true");
    const loudHeight = link()?.getBoundingClientRect().height ?? 0;
    expect(loudHeight).toBe(quietHeight);
    render(0);
    expect(document.querySelector(".attention-badge")).toBeNull();
    expect(link()?.getAttribute("aria-label")).toBe("Diagram health");
  });
});
