/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateHost } from "../src/components/UpdateHost";
import type { UpdateStatus } from "../src/types";

const TLS_DOCS_URL =
  "https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs/troubleshooting.md#corporate-tls-inspection";

function status(): UpdateStatus {
  return {
    enabled: true,
    automatic: true,
    includePrerelease: false,
    installKind: "docker",
    currentVersion: "1.4.8",
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
      tag: "v1.4.8",
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

  it("shows a busy state and then the same error on every Check for updates click", async () => {
    const failed = status();
    failed.phase = "unknown";
    failed.matchesLatest = false;
    failed.error = { code: "offline", message: "Could not reach GitHub." };
    const pending: Array<(body: UpdateStatus) => void> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/updates/check") && init?.method === "POST") {
          return new Promise<Response>((resolve) => {
            pending.push((body) => {
              resolve(
                new Response(JSON.stringify(body), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }),
              );
            });
          });
        }
        return new Response(JSON.stringify(failed), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

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
    await act(async () => {
      window.dispatchEvent(new Event("nerdgram:about"));
    });

    const dialog = () => document.querySelector('[role="dialog"]');
    const checkButton = () =>
      Array.from(dialog()?.querySelectorAll("button") ?? []).find((button) =>
        /Check for updates|Checking…/.test(button.textContent ?? ""),
      );

    expect(dialog()?.textContent).toContain("Could not reach GitHub.");
    expect(checkButton()?.className).toContain("btn-secondary");
    expect(checkButton()?.textContent).toBe("Check for updates");
    const checks = Array.from(dialog()?.querySelectorAll("label.sync-check") ?? []);
    expect(checks.map((label) => label.textContent?.trim())).toEqual([
      "Check for updates automatically",
      "Include prereleases",
    ]);

    await act(async () => {
      checkButton()?.click();
    });
    expect(dialog()?.textContent).toContain("Checking for updates…");
    expect(checkButton()?.textContent).toBe("Checking…");
    expect(checkButton()?.getAttribute("aria-busy")).toBe("true");
    expect(dialog()?.textContent).not.toContain("Could not reach GitHub.");

    await act(async () => {
      pending.shift()?.(failed);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dialog()?.textContent).toContain("Could not reach GitHub.");
    expect(dialog()?.textContent).not.toContain("Checking for updates…");
    const firstId = dialog()?.querySelector("[data-check-id]")?.getAttribute("data-check-id");
    expect(firstId).toBeTruthy();

    await act(async () => {
      checkButton()?.click();
    });
    expect(dialog()?.textContent).toContain("Checking for updates…");
    expect(dialog()?.textContent).not.toContain("Could not reach GitHub.");
    expect(checkButton()?.textContent).toBe("Checking…");

    await act(async () => {
      pending.shift()?.(failed);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dialog()?.textContent).toContain("Could not reach GitHub.");
    const secondId = dialog()?.querySelector("[data-check-id]")?.getAttribute("data-check-id");
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
  });

  it("links a repeated TLS failure to the corporate TLS inspection note", async () => {
    const tls = status();
    tls.phase = "unknown";
    tls.matchesLatest = false;
    tls.error = {
      code: "tls",
      message: `A proxy or TLS inspection on this network is likely intercepting HTTPS. See ${TLS_DOCS_URL}.`,
    };
    let resolveCheck: ((body: UpdateStatus) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/updates/check") && init?.method === "POST") {
          return new Promise<Response>((resolve) => {
            resolveCheck = (body) => {
              resolve(
                new Response(JSON.stringify(body), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }),
              );
            };
          });
        }
        return new Response(JSON.stringify(tls), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

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
    await act(async () => {
      window.dispatchEvent(new Event("nerdgram:about"));
    });

    const dialog = () => document.querySelector('[role="dialog"]');
    expect(dialog()?.textContent).toContain("proxy or TLS inspection");
    const stored = dialog()?.querySelector(`a[href="${TLS_DOCS_URL}"]`);
    expect(stored?.textContent).toBe("corporate TLS inspection");
    expect(stored?.getAttribute("target")).toBe("_blank");
    expect(stored?.getAttribute("rel")).toBe("noopener noreferrer");

    const button = () =>
      Array.from(dialog()?.querySelectorAll("button") ?? []).find((item) =>
        /Check for updates|Checking…/.test(item.textContent ?? ""),
      );
    await act(async () => {
      button()?.click();
    });
    expect(dialog()?.textContent).toContain("Checking for updates…");
    expect(dialog()?.textContent).not.toContain("proxy or TLS inspection");

    await act(async () => {
      resolveCheck?.(tls);
      await Promise.resolve();
      await Promise.resolve();
    });
    const again = dialog()?.querySelector(`a[href="${TLS_DOCS_URL}"]`);
    expect(again?.textContent).toBe("corporate TLS inspection");
    expect(dialog()?.textContent).toContain("proxy or TLS inspection");
    expect(dialog()?.textContent).not.toContain("Checking for updates…");
  });

  it("styles the update button and checkbox row so they do not inherit a full-width block input", () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");
    expect(css).toMatch(/\.btn-secondary\s*\{[^}]*background:\s*var\(--bg\)/);
    expect(css).toMatch(/\.btn-secondary\s*\{[^}]*color:\s*var\(--ink\)/);
    expect(css).toMatch(/\.btn-secondary\s*\{[^}]*border-color:\s*var\(--line\)/);
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toMatch(/\.modal label\.sync-check\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.modal label\.sync-check input\[type="checkbox"\]\s*\{[^}]*width:\s*auto/);
    expect(css).toMatch(/\.modal label\.sync-check input\[type="checkbox"\]\s*\{[^}]*display:\s*inline-block/);
  });
});
