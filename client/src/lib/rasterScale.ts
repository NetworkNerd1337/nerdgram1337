/** Preferred raster export scale. PNG, JPG, and canvas PDF start here. */
export const RASTER_EXPORT_SCALE = 2;

/** Browser canvas limits. A side or an area past these makes toBlob fail or hang. */
export const RASTER_MAX_SIDE = 16_384;
export const RASTER_MAX_AREA = 268_000_000;

/**
 * Scale for a raster export of a diagram that is `width` by `height` CSS pixels.
 * Stays at 2× when that fits. Otherwise drops, including below 1×, so the
 * canvas side and area stay inside the browser limits.
 */
export function rasterExportScale(width: number, height: number): number {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const side = RASTER_MAX_SIDE / Math.max(w, h);
  const area = Math.sqrt(RASTER_MAX_AREA / (w * h));
  const scale = Math.min(RASTER_EXPORT_SCALE, side, area);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Note for a scale below 2×. Null when the export kept the usual size. */
export function rasterScaleNote(scale: number): string | null {
  if (!(scale + 1e-9 < RASTER_EXPORT_SCALE)) return null;
  const shown = Number(scale.toFixed(2));
  return `Exported at ${shown}× instead of 2× so the picture stays within the browser canvas limit.`;
}
