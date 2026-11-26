/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReleaseNotice, releaseNoticeVersion, updateToastVisible } from "../src/components/ReleaseNotice";
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

describe("release notice contrast", () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");

  function hex(value: string): [number, number, number] {
    return [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16)) as [number, number, number];
  }

  function mix(left: string, right: string, weight: number): [number, number, number] {
    const a = hex(left);
    const b = hex(right);
    return a.map((channel, index) => Math.round(channel * weight + b[index] * (1 - weight))) as [number, number, number];
  }

  function contrast(foreground: [number, number, number], background: [number, number, number]): number {
    const lum = (rgb: [number, number, number]) => {
      const channels = rgb.map((value) => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const [hi, lo] = [lum(foreground), lum(background)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  }

  function tokens(selector: string): Record<string, string> {
    const start = css.indexOf(selector);
    const block = css.slice(start, css.indexOf("}", start));
    return Object.fromEntries(
      [...block.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((match) => [match[1], match[2]]),
    );
  }

  it("keeps the light title at 7:1 and the version line at 4.5:1, and does not weaken dark", () => {
    const light = tokens(":root {");
    const dark = tokens('html[data-theme="dark"]');
    for (const theme of [light, dark]) {
      const chip = mix(theme["--accent-soft"], theme["--bg-elevated"], 0.72);
      const title = mix(theme["--accent"], theme["--ink"], 0.6);
      const version = hex(theme["--ink-soft"]);
      const titleContrast = contrast(title, chip);
      const versionContrast = contrast(version, chip);
      expect(titleContrast).toBeGreaterThanOrEqual(theme === light ? 7 : 7.1);
      expect(versionContrast).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain("color: color-mix(in srgb, var(--accent) 60%, var(--ink));");
  });
});

describe("update toast", () => {
  it("stays hidden while the side pane notice is showing", () => {
    expect(updateToastVisible(status(), false)).toBe(false);
    expect(updateToastVisible(status({ phase: "current", updateAvailable: false, matchesLatest: true }), false)).toBe(false);
    expect(updateToastVisible(status({ phase: "current", updateAvailable: true }), false)).toBe(true);
    expect(updateToastVisible(status({ phase: "current", updateAvailable: true }), true)).toBe(false);
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
