/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  APPEARANCE_KEY,
  appearanceBootScript,
  applyAppearance,
  injectAppearanceBoot,
  readAppearance,
  resolveTheme,
  writeAppearance,
} from "../src/lib/appearance";

function systemDark(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches && query.includes("prefers-color-scheme: dark"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe("appearance", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "";
    document.documentElement.dataset.appearance = "";
    systemDark(false);
  });

  it("resolves light, dark, and system, and defaults an unknown value to system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(readAppearance()).toBe("system");
    localStorage.setItem(APPEARANCE_KEY, "nope");
    expect(readAppearance()).toBe("system");
  });

  it("stores the choice in this browser and sets the theme before a component paints", () => {
    expect(writeAppearance("dark")).toBe("dark");
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.appearance).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    systemDark(true);
    expect(applyAppearance("system")).toBe("dark");
    systemDark(false);
    expect(applyAppearance("system")).toBe("light");
  });

  it("boots the same theme the resolver would, from a script at the start of head", () => {
    const page = `<head>\n    <link rel="stylesheet" href="/assets/index.css" />\n  </head><body></body>`;
    const html = injectAppearanceBoot(page);
    const scriptAt = html.indexOf("<script>");
    const styleAt = html.indexOf("stylesheet");
    expect(scriptAt).toBeGreaterThan(0);
    expect(scriptAt).toBeLessThan(styleAt);
    expect(html).toContain(APPEARANCE_KEY);
    expect(injectAppearanceBoot(html)).toBe(html);

    localStorage.setItem(APPEARANCE_KEY, "dark");
    systemDark(false);
    window.eval(appearanceBootScript());
    expect(document.documentElement.dataset.theme).toBe("dark");

    localStorage.removeItem(APPEARANCE_KEY);
    systemDark(true);
    window.eval(appearanceBootScript());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.appearance).toBe("system");

    localStorage.setItem(APPEARANCE_KEY, "light");
    window.eval(appearanceBootScript());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(resolveTheme(readAppearance(), true)).toBe("light");
  });
});
