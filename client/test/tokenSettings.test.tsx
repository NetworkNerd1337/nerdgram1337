/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenSettings } from "../src/components/TokenSettings";

const active = {
  id: "a".repeat(18),
  name: "CI render",
  prefix: "ng_active11",
  scope: "read",
  createdAt: "2026-11-17T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

const revoked = {
  id: "b".repeat(18),
  name: "Old laptop",
  prefix: "ng_revoked1",
  scope: "read-write",
  createdAt: "2026-11-17T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: "2026-11-17T01:00:00.000Z",
};

describe("automation token settings", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const calls: { url: string; method: string; body: string }[] = [];

  beforeEach(() => {
    calls.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
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

  function mockFetch(tokens = [active, revoked], createdToken = "ng_secret_value_not_logged") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ url: String(url), method, body: String(init?.body ?? "") });
        if (method === "GET") {
          return new Response(JSON.stringify({ tokens }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (String(url) === "/api/tokens" && method === "POST") {
          return new Response(
            JSON.stringify({
              token: createdToken,
              tokenMeta: { ...active, id: "c".repeat(18), name: "New", prefix: "ng_secret_v" },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        if (String(url).endsWith("/delete")) {
          return new Response(JSON.stringify({ deleted: true, id: revoked.id }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (String(url) === "/api/tokens/clear-revoked") {
          return new Response(JSON.stringify({ deleted: 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ token: { ...active, revokedAt: "2026-11-17T02:00:00.000Z" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  }

  async function render() {
    await act(async () => {
      root?.render(createElement(TokenSettings));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function button(label: string): HTMLButtonElement {
    const found = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button ${label}`);
    return found;
  }

  it("caps a token name at 40 characters and shows the count", async () => {
    mockFetch();
    await render();
    const input = document.querySelector("#token-name");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).maxLength).toBe(40);
    expect(document.querySelector("#token-name-count")?.textContent).toContain("0/40");
    const label = [...(container?.querySelectorAll(".clipped-name") ?? [])].find((node) => node.textContent === "CI render");
    expect(label?.getAttribute("title")).toBe("CI render");
  });

  it("shows a one-time panel with Copy and keeps Delete off active tokens", async () => {
    mockFetch();
    await render();
    expect(document.body.textContent).toContain("Old laptop");
    expect(document.body.textContent).toContain("revoked");
    const rows = [...document.querySelectorAll(".token-row")];
    const activeRow = rows.find((row) => row.textContent?.includes("CI render"));
    const revokedRow = rows.find((row) => row.textContent?.includes("Old laptop"));
    expect(activeRow?.textContent).toContain("Revoke");
    expect(activeRow?.textContent).not.toContain("Delete");
    expect(revokedRow?.textContent).toContain("Delete");
    expect(document.body.textContent).toContain("Clear revoked");

    const name = document.getElementById("token-name");
    if (!(name instanceof HTMLInputElement)) throw new Error("name missing");
    const prototype = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    prototype?.set?.call(name, "New");
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await act(async () => {
      button("Create token").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const panel = document.querySelector('[data-testid="new-token-panel"]');
    expect(panel?.textContent).toContain("Your new token");
    expect(panel?.textContent).toContain("stores only a hash");
    expect(panel?.textContent).toContain("ng_secret_value_not_logged");
    await act(async () => {
      button("Copy").click();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ng_secret_value_not_logged");
    expect(document.body.textContent).toContain("Copied");
    await act(async () => {
      button("Done").click();
    });
    expect(document.querySelector('[data-testid="new-token-panel"]')).toBeNull();
  });

  it("confirms delete and clear revoked without sending the secret", async () => {
    mockFetch();
    await render();
    await act(async () => {
      button("Delete").click();
    });
    expect(document.body.textContent).toContain("stays revoked");
    await act(async () => {
      button("Delete token").click();
    });
    expect(calls.some((call) => call.url.endsWith("/delete") && call.method === "POST")).toBe(true);
    expect(calls.every((call) => !call.body.includes("ng_"))).toBe(true);

    await act(async () => {
      button("Clear revoked").click();
    });
    expect(document.body.textContent).toContain("does not reactivate");
    const confirm = document.querySelector('.modal button[type="submit"]');
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("clear confirm missing");
    await act(async () => {
      confirm.click();
    });
    expect(calls.some((call) => call.url === "/api/tokens/clear-revoked")).toBe(true);
  });
});
