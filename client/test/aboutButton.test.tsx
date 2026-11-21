/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AboutButton } from "../src/components/SupportLink";
import { UpdateContext, type UpdateContextValue } from "../src/components/updateContext";
import { formatVersionLabel } from "../src/lib/versionLabel";
import type { UpdateStatus } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function status(version: string, codename: string): UpdateStatus {
  return {
    enabled: true,
    automatic: true,
    includePrerelease: false,
    installKind: "git",
    currentVersion: version,
    codename,
    commit: null,
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
    docker: null,
  };
}

describe("About button", () => {
  it("sits in the header, uses the live version, and opens from the keyboard", () => {
    let opened = false;
    const value = { openAbout: () => (opened = true), status: status("1.8.18", "Meridian") } as UpdateContextValue;
    const host = document.createElement("div");
    document.body.append(host);
    act(() => {
      root = createRoot(host);
      root.render(
        <UpdateContext.Provider value={value}>
          <AboutButton />
        </UpdateContext.Provider>,
      );
    });
    const button = host.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("About NerdGram1337");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.getAttribute("title")).toBe(formatVersionLabel("1.8.18", "Meridian"));
    expect(button?.getAttribute("title")).toBe('v1.8.18 "Meridian"');
    expect(button?.textContent).toContain("About");
    act(() => button?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    act(() => button?.click());
    expect(opened).toBe(true);
  });
});
