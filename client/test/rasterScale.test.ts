import { describe, expect, it } from "vitest";
import {
  RASTER_EXPORT_SCALE,
  RASTER_MAX_AREA,
  RASTER_MAX_SIDE,
  rasterExportScale,
  rasterScaleNote,
} from "../src/lib/rasterScale";

describe("raster export scale", () => {
  it("keeps 2× when the canvas fits", () => {
    expect(rasterExportScale(800, 600)).toBe(RASTER_EXPORT_SCALE);
    expect(rasterScaleNote(RASTER_EXPORT_SCALE)).toBeNull();
  });

  it("scales a wide diagram down so the side and the area stay inside the browser limits", () => {
    const width = 20_000;
    const height = 10_000;
    const scale = rasterExportScale(width, height);
    expect(scale).toBeLessThan(RASTER_EXPORT_SCALE);
    expect(Math.max(width, height) * scale).toBeLessThanOrEqual(RASTER_MAX_SIDE + 1e-6);
    expect(width * height * scale * scale).toBeLessThanOrEqual(RASTER_MAX_AREA + 1);
    expect(rasterScaleNote(scale)).toMatch(/instead of 2×/);
  });

  it("scales below 1× when the diagram itself is past the canvas limit", () => {
    const scale = rasterExportScale(40_000, 20_000);
    expect(scale).toBeLessThan(1);
    expect(40_000 * scale).toBeLessThanOrEqual(RASTER_MAX_SIDE + 1e-6);
    expect(rasterScaleNote(scale)).toMatch(/0\.\d+× instead of 2×/);
  });
});
