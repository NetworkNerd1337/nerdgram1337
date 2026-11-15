/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramFolderSettings } from "../src/components/DiagramFolderSettings";
import type { DataDirStatus } from "../src/api";

function status(overrides: Partial<DataDirStatus> = {}): DataDirStatus {
  return {
    saved: "/diagrams",
    running: "/diagrams",
    persisted: false,
    source: "default",
    envValue: null,
    envSource: null,
    envManaged: false,
    docker: false,
    githubSync: false,
    readOnly: false,
    restartNotice: false,
    defaultPath: "/diagrams",
    ...overrides,
  };
}

describe("Diagram folder setting", () => {
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

  async function renderStatus(next: DataDirStatus) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } })),
    );
    await act(async () => {
      root?.render(createElement(DiagramFolderSettings));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("hides the notice when the saved folder matches the running folder", async () => {
    await renderStatus(status());
    expect(document.querySelector('[data-testid="data-dir-restart-notice"]')).toBeNull();
    expect((document.getElementById("diagram-folder-path") as HTMLInputElement).value).toBe("/diagrams");
    expect((document.getElementById("diagram-folder-path") as HTMLInputElement).disabled).toBe(false);
    expect(document.body.textContent).toContain("Save diagram folder");
    expect(document.body.textContent).toContain("NERDGRAM_DATA_DIR");
  });

  it("shows the notice when the saved folder differs from the running folder", async () => {
    await renderStatus(
      status({
        saved: "/mnt/share/diagrams",
        running: "/diagrams",
        persisted: true,
        source: "saved",
        restartNotice: true,
      }),
    );
    const notice = document.querySelector('[data-testid="data-dir-restart-notice"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toMatch(/Restart NerdGram manually/);
    expect(notice?.textContent).toContain("/mnt/share/diagrams");
    expect(notice?.textContent).toContain("/diagrams");
  });

  it("hides the notice after a restart that is using the saved folder", async () => {
    await renderStatus(
      status({
        saved: "/mnt/share/diagrams",
        running: "/mnt/share/diagrams",
        persisted: true,
        source: "saved",
        restartNotice: false,
      }),
    );
    expect(document.querySelector('[data-testid="data-dir-restart-notice"]')).toBeNull();
  });

  it("shows an external NERDGRAM_DATA_DIR as read-only and does not ask for a restart", async () => {
    await renderStatus(
      status({
        saved: "/srv/diagrams",
        running: "/srv/diagrams",
        envManaged: true,
        envSource: "shell",
        envValue: "/srv/diagrams",
        source: "env",
        readOnly: true,
        restartNotice: false,
      }),
    );
    expect(document.querySelector('[data-testid="data-dir-env-note"]')?.textContent).toMatch(/source of truth/);
    expect((document.getElementById("diagram-folder-path") as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector('[data-testid="data-dir-restart-notice"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Save diagram folder");
  });

  it("keeps Docker read-only and points at the volume mount", async () => {
    await renderStatus(
      status({
        saved: "/data",
        running: "/data",
        docker: true,
        readOnly: true,
        envManaged: true,
        envSource: "docker",
        envValue: "/data",
        source: "docker",
      }),
    );
    expect(document.querySelector('[data-testid="data-dir-docker-note"]')?.textContent).toMatch(/volume mount/i);
    expect((document.getElementById("diagram-folder-path") as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector('[data-testid="data-dir-restart-notice"]')).toBeNull();
  });

  it("disables the field when GitHub sync is on", async () => {
    await renderStatus(status({ githubSync: true, readOnly: true, running: "/diagrams", saved: "/diagrams" }));
    expect(document.querySelector('[data-testid="data-dir-github-note"]')?.textContent).toMatch(/GitHub sync is on/);
    expect((document.getElementById("diagram-folder-path") as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("Save diagram folder");
  });
});
