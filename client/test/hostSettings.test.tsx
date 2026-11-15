/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostSettings } from "../src/components/HostSettings";
import type { ListenHostStatus } from "../src/api";

function status(overrides: Partial<ListenHostStatus> = {}): ListenHostStatus {
  return {
    saved: "127.0.0.1",
    persisted: false,
    invalid: false,
    effectiveHosts: ["127.0.0.1", "::1"],
    source: "default",
    envHost: null,
    envOverrides: false,
    docker: false,
    readOnly: false,
    running: "127.0.0.1",
    restartNotice: false,
    acceptedHosts: [],
    ...overrides,
  };
}

describe("Host setting restart notice", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  async function renderStatus(next: ListenHostStatus) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } })),
    );
    await act(async () => {
      root?.render(createElement(HostSettings));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("hides the notice when the saved host is 127.0.0.1", async () => {
    await renderStatus(status());
    expect(document.querySelector('[data-testid="host-restart-notice"]')).toBeNull();
    expect((document.getElementById("listen-host") as HTMLInputElement).value).toBe("127.0.0.1");
    expect((document.getElementById("listen-host") as HTMLInputElement).disabled).toBe(false);
    expect(document.body.textContent).toContain("Save host");
  });

  it("shows the notice only while the saved host differs from the running host", async () => {
    await renderStatus(
      status({ saved: "192.168.1.10", running: "127.0.0.1", persisted: true, restartNotice: true, source: "saved" }),
    );
    const notice = document.querySelector('[data-testid="host-restart-notice"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toMatch(/Restart NerdGram manually/);
    expect(notice?.textContent).toMatch(/does not restart itself/);
    expect(notice?.textContent).toContain("192.168.1.10");
  });

  it("hides the notice after a restart that is already using the saved host", async () => {
    await renderStatus(
      status({
        saved: "0.0.0.0",
        running: "0.0.0.0",
        persisted: true,
        source: "saved",
        effectiveHosts: ["0.0.0.0"],
        restartNotice: false,
      }),
    );
    expect(document.querySelector('[data-testid="host-restart-notice"]')).toBeNull();
    expect((document.getElementById("listen-host") as HTMLInputElement).value).toBe("0.0.0.0");
  });

  it("shows an env override and keeps the Docker box read-only", async () => {
    await renderStatus(
      status({
        docker: true,
        readOnly: true,
        envOverrides: true,
        envHost: "0.0.0.0",
        source: "env",
        effectiveHosts: ["0.0.0.0"],
        saved: "192.168.1.10",
        running: "0.0.0.0",
        persisted: true,
        restartNotice: true,
      }),
    );
    expect(document.body.textContent).toMatch(/overrides the saved setting/);
    expect(document.body.textContent).toMatch(/read-only/i);
    expect((document.getElementById("listen-host") as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector('[data-testid="host-restart-notice"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="host-restart-notice"]')?.textContent).toMatch(/HOST is set/);
    expect(document.body.textContent).not.toContain("Save host");
  });

  it("hides the restart notice when HOST is the saved host", async () => {
    await renderStatus(
      status({
        envOverrides: true,
        envHost: "0.0.0.0",
        source: "env",
        effectiveHosts: ["0.0.0.0"],
        saved: "0.0.0.0",
        running: "0.0.0.0",
        persisted: true,
        restartNotice: false,
      }),
    );
    expect(document.body.textContent).toMatch(/overrides the saved setting/);
    expect(document.querySelector('[data-testid="host-restart-notice"]')).toBeNull();
  });
});
