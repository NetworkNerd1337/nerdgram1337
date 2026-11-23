import { describe, expect, it } from "vitest";
import { packSettingsColumns, settingsColumnHeight } from "../src/lib/settingsColumns";

function difference(heights: number[], gap: number): number {
  const columns = packSettingsColumns(heights, gap);
  return Math.abs(settingsColumnHeight(heights, columns, 0, gap) - settingsColumnHeight(heights, columns, 1, gap));
}

describe("packSettingsColumns", () => {
  it("keeps one card in a single column", () => {
    expect(packSettingsColumns([120])).toEqual([0]);
    expect(packSettingsColumns([])).toEqual([]);
  });

  it("splits equal cards across the two columns", () => {
    expect(packSettingsColumns([40, 40, 40, 40], 16)).toEqual([0, 0, 1, 1]);
  });

  it("balances a tall card instead of leaving a large gap", () => {
    const heights = [193, 394, 497, 465, 293, 434, 604, 301, 241];
    const gap = 16;
    const columns = packSettingsColumns(heights, gap);
    expect(columns[0]).toBe(0);
    expect(new Set(columns)).toEqual(new Set([0, 1]));
    expect(difference(heights, gap)).toBeLessThan(32);
    for (const column of [0, 1] as const) {
      const indexes = columns.flatMap((value, index) => (value === column ? [index] : []));
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    }
  });

  it("keeps collapsed cards within one card of each other", () => {
    const heights = [213, 66, 66, 66, 66, 66, 66, 66, 66];
    expect(difference(heights, 16)).toBeLessThan(80);
  });
});
