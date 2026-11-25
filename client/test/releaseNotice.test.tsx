/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReleaseNotice, releaseNoticeVersion } from "../src/components/ReleaseNotice";
import { UpdateContext, type UpdateContextValue } from "../src/components/updateContext";
import type { UpdateStatus } from "../src/types";

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    enabled: true,
    automatic: true,
    includePrerelease: false,
    installKind: "git",
    currentVersion: "2.1.26",
    codename: "Azimuth",
    commit: null,
    phase: "available",
    updateAvailable: true,
    skipped: false,
    dismissed: false,
    skippedVersions: [],
    latest: {
      tag: "v2.1.27",
      version: "2.1.27",
      codename: "Azimuth",
      name: "v2.1.27 Azimuth",
      body: "",
      htmlUrl: "https://github.com/NetworkNerd1337/NerdGram1337/releases/tag/v2.1.27",
      publishedAt: null,
      prerelease: false,
    },
    checkedAt: "2026-11-25T00:00:00.000Z",
    error: null,
    canApply: false,
    matchesLatest: false,
    docker: null,
    ...overrides,
  };
}

describe("release notice version", () => {
  it("keeps the tag only when the check says a newer release is available", () => {
    expect(releaseNoticeVersion(status())).toBe("v2.1.27");
    expect(releaseNoticeVersion(status({ phase: "current", matchesLatest: true, updateAvailable: false }))).toBeNull();
    expect(releaseNoticeVersion(status({ phase: "ahead", updateAvailable: false }))).toBeNull();
    expect(releaseNoticeVersion(status({ error: { code: "offline", message: "Could not reach GitHub." } }))).toBeNull();
    expect(releaseNoticeVersion(status({ latest: null, phase: "unknown" }))).toBeNull();
    expect(releaseNoticeVersion(null)).toBeNull();
  });
});

describe("release notice button", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  function render(value: UpdateStatus | null, openAbout = vi.fn()) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <UpdateContext.Provider value={{ status: value, openAbout } as UpdateContextValue}>
          <ReleaseNotice />
        </UpdateContext.Provider>,
      );
    });
    return openAbout;
  }

  it("opens About from a click, Enter, and Space", () => {
    const openAbout = render(status());
    const button = document.querySelector("button.release-notice");
    expect(button?.getAttribute("aria-label")).toBe("New release available! v2.1.27. Opens About.");
    expect(button?.textContent).toContain("New release available!");
    expect(button?.textContent).toContain("v2.1.27");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      button?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    act(() => {
      button?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(openAbout).toHaveBeenCalledTimes(3);
  });

  it("renders nothing when the install is current or the check failed", () => {
    render(status({ phase: "current", updateAvailable: false, matchesLatest: true }));
    expect(document.querySelector(".release-notice")).toBeNull();
    act(() => root?.unmount());
    render(status({ error: { code: "offline", message: "Could not reach GitHub." } }));
    expect(document.querySelector(".release-notice")).toBeNull();
  });
});
