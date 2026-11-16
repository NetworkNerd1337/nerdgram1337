/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateHost } from "../src/components/UpdateHost";
import type { UpdateStatus } from "../src/types";

function status(): UpdateStatus {
  return {
    enabled: true,
    automatic: true,
    includePrerelease: false,
    installKind: "docker",
    currentVersion: "1.4.3",
    codename: "Atlas",
    commit: "abc1234def5678901234567890abcdef12345678",
    phase: "current",
    updateAvailable: false,
    skipped: false,
    dismissed: false,
    skippedVersions: [],
    latest: null,
    checkedAt: null,
    error: null,
    canApply: false,
    matchesLatest: true,
    docker: {
      image: "ghcr.io/networknerd1337/nerdgram1337",
      tag: "v1.4.3",
      steps: [],
      compose: [],
      composeNote: "Compose keeps the volume.",
      persistNote: "The volume stays.",
    },
  };
}

describe("About dialog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(status()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
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
    vi.unstubAllGlobals();
  });

  it("stays closed until asked, then closes with Escape or the close button", async () => {
    await act(async () => {
      root?.render(
        createElement(
          MemoryRouter,
          null,
          createElement(UpdateHost, null, createElement("main", null, "workspace")),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("ko-fi.com");

    await act(async () => {
      window.dispatchEvent(new Event("nerdgram:about"));
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Atlas");
    expect(dialog?.textContent).toContain("Docker");
    expect(dialog?.textContent).toContain("abc1234def5678901234567890abcdef12345678");
    const kofi = dialog?.querySelector('a[href="https://ko-fi.com/networknerd1337"]');
    expect(kofi?.getAttribute("target")).toBe("_blank");
    expect(kofi?.getAttribute("rel")).toBe("noopener noreferrer");

    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("ko-fi.com");

    await act(async () => {
      window.dispatchEvent(new Event("nerdgram:about"));
    });
    const again = document.querySelector('[role="dialog"]');
    const close = Array.from(again?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Close");
    await act(async () => {
      close?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
