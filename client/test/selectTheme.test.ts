import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");

function contrast(foreground: string, background: string): number {
  const lum = (hex: string) => {
    const channels = [0, 2, 4].map((start) => {
      const value = Number.parseInt(hex.slice(start + 1, start + 3), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [hi, lo] = [lum(foreground), lum(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("select theme colors", () => {
  it("gives Export as the same surface and text tokens as Theme and Look", () => {
    const shared = block(".preview-toolbar select,\n.export-label select");
    expect(shared).toContain("background-color: var(--bg-muted)");
    expect(shared).toContain("color: var(--ink)");
    expect(shared).not.toContain("var(--accent)");
    expect(shared).not.toContain("color: var(--bg)");
  });

  it("paints options and disabled options from the theme, in both color schemes", () => {
    const options = block("select option,\nselect optgroup");
    expect(options).toContain("background-color: var(--bg-muted)");
    expect(options).toContain("color: var(--ink)");
    const disabled = block("select option:disabled");
    expect(disabled).toContain("color: var(--ink-soft)");
    expect(disabled).toContain("background-color: var(--bg-muted)");
    expect(css).toContain("color-scheme: inherit");
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain("color-scheme: light");
  });

  it("keeps normal options at 4.5:1 and disabled options at 3:1", () => {
    const pairs = [
      ["#1c2420", "#e8eeea"],
      ["#5a675f", "#e8eeea"],
      ["#e8eef5", "#1a2330"],
      ["#91a0b4", "#1a2330"],
    ];
    expect(contrast(pairs[0][0], pairs[0][1])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(pairs[1][0], pairs[1][1])).toBeGreaterThanOrEqual(3);
    expect(contrast(pairs[2][0], pairs[2][1])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(pairs[3][0], pairs[3][1])).toBeGreaterThanOrEqual(3);
  });
});
