/**
 * Camera math for presentation mode.
 *
 * The diagram stays an SVG. This module only describes how to place it:
 * pan (`x`, `y` in viewport pixels from the center), zoom (`scale`, where 1
 * is the SVG's own size), and rotation in degrees (clockwise, any angle).
 *
 * Screen position of a point measured from the diagram center:
 *   screen = rotate(scale * point) + (x, y)
 * CSS applies that as
 *   translate(x, y) rotate(deg) scale(s) translate(-width/2, -height/2)
 * on an element whose top-left sits on the viewport center and whose
 * transform-origin is 0 0.
 *
 * Slideshow navigation can reuse `isFitted`: arrow keys pan only when the
 * camera has left the fitted view. `fit` already uses the rotated bounding
 * box, so a later slide change can call `resetView` or `fit` per diagram.
 */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** Keyboard and button zoom step. Wheel zoom uses a continuous factor. */
export const ZOOM_STEP = 1.2;
/** Keyboard pan distance in viewport pixels. */
export const PAN_STEP = 48;
/** Gap kept around a fitted diagram, capped so a small window still fits. */
export const FIT_PADDING = 48;

export type Point = { x: number; y: number };

export type Size = { width: number; height: number };

export type ViewTransform = {
  x: number;
  y: number;
  scale: number;
  /** Degrees clockwise. Arbitrary angles are valid; R steps by 90. */
  rotation: number;
};

export type ZoomLimits = { min: number; max: number };

/** How Fit sizes the diagram. Page shows all of it. Width or height uses one axis. */
export type FitMode = "page" | "width" | "height";

export function fitModeLabel(mode: FitMode): string {
  if (mode === "width") return "Fit width";
  if (mode === "height") return "Fit height";
  return "Fit page";
}

export function identityView(): ViewTransform {
  return { x: 0, y: 0, scale: 1, rotation: 0 };
}

export function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Absolute sine and cosine. Right angles are exact so 90/270 fit is stable. */
function axisSinCos(rotation: number): { sin: number; cos: number } {
  const turns = normalizeDegrees(rotation) / 90;
  const nearest = Math.round(turns);
  if (Math.abs(turns - nearest) < 1e-6) {
    return nearest % 2 === 0 ? { sin: 0, cos: 1 } : { sin: 1, cos: 0 };
  }
  const rad = (normalizeDegrees(rotation) * Math.PI) / 180;
  return { sin: Math.abs(Math.sin(rad)), cos: Math.abs(Math.cos(rad)) };
}

/** Axis-aligned size of `content` after `rotation` degrees clockwise. */
export function rotatedContentSize(content: Size, rotation: number): Size {
  const { sin, cos } = axisSinCos(rotation);
  return {
    width: content.width * cos + content.height * sin,
    height: content.width * sin + content.height * cos,
  };
}

function fitPadding(viewport: Size): number {
  return Math.min(FIT_PADDING, Math.max(0, viewport.width * 0.06), Math.max(0, viewport.height * 0.06));
}

function axisScales(viewport: Size, content: Size, rotation: number): { width: number; height: number } {
  const bounds = rotatedContentSize(content, rotation);
  const pad = fitPadding(viewport);
  const availW = Math.max(1, viewport.width - pad * 2);
  const availH = Math.max(1, viewport.height - pad * 2);
  return {
    width: availW / Math.max(bounds.width, 1e-6),
    height: availH / Math.max(bounds.height, 1e-6),
  };
}

/**
 * Upper bound for Fit width and Fit height. 200% keeps a short, wide diagram
 * readable. It also stays at or under `MAX_ZOOM`, so Fit never opens past 8×.
 * Fit page is not capped: the whole diagram still has to fit.
 */
export const FIT_AXIS_MAX = 2;

function finiteScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Fit width / Fit height, stopped at `FIT_AXIS_MAX` and never above `MAX_ZOOM`. */
export function capAxisFit(scale: number): number {
  return Math.min(finiteScale(scale), FIT_AXIS_MAX, MAX_ZOOM);
}

/**
 * Scale that fits the rotated diagram on the chosen axis, centered.
 * Page uses the smaller axis so the whole diagram is visible, with no cap.
 * Width and height use one axis, so the other direction can be panned, and
 * those scales stop at {@link capAxisFit}.
 * Interactive zoom uses `zoomAt` limits that expand to include the page fit.
 */
export function fitTo(viewport: Size, content: Size, rotation: number, mode: FitMode = "page"): ViewTransform {
  const axes = axisScales(viewport, content, rotation);
  const raw = mode === "width" ? axes.width : mode === "height" ? axes.height : Math.min(axes.width, axes.height);
  const scale = mode === "page" ? finiteScale(raw) : capAxisFit(raw);
  return {
    x: 0,
    y: 0,
    scale,
    rotation: normalizeDegrees(rotation),
  };
}

/** Largest scale that fits the whole rotated diagram in the viewport. */
export function fit(viewport: Size, content: Size, rotation: number): ViewTransform {
  return fitTo(viewport, content, rotation, "page");
}

/**
 * A single-axis fit is a distinct step when its capped scale is clearly
 * larger than fit page. A scale that matches the page, or a cap that lands
 * on the page, is not offered.
 */
export function axisFitHelps(
  viewport: Size,
  content: Size,
  rotation: number,
  mode: "width" | "height",
): boolean {
  const axes = axisScales(viewport, content, rotation);
  const page = Math.min(axes.width, axes.height);
  const capped = capAxisFit(mode === "width" ? axes.width : axes.height);
  return page > 0 && capped > page * 1.08;
}

/**
 * Fit modes that change the picture. Page is always first. A single-axis
 * mode is left out when it matches fit page, or when the 200% cap would not
 * show more than fit page. Two axes that land on the same capped scale count
 * once, keeping the longer raw axis.
 */
export function fitCycle(viewport: Size, content: Size, rotation = 0): FitMode[] {
  const axes = axisScales(viewport, content, rotation);
  const ranked = (["height", "width"] as const)
    .filter((mode) => axisFitHelps(viewport, content, rotation, mode))
    .map((mode) => {
      const raw = mode === "width" ? axes.width : axes.height;
      return { mode, raw, capped: capAxisFit(raw) };
    })
    .sort((a, b) => b.raw - a.raw);
  const steps: FitMode[] = ["page"];
  for (const item of ranked) {
    const samePicture = steps.some((mode) => {
      if (mode === "page") return false;
      const other = capAxisFit(mode === "width" ? axes.width : axes.height);
      return Math.abs(other - item.capped) <= Math.max(1e-3, item.capped * 0.02);
    });
    if (!samePicture) steps.push(item.mode);
  }
  return steps;
}

/**
 * Next Fit button mode. From page, the next mode is the larger useful
 * single-axis fit. A mode that would not change the picture is skipped.
 */
export function nextFitMode(
  mode: FitMode,
  viewport?: Size | null,
  content?: Size | null,
  rotation = 0,
): FitMode {
  if (!viewport || !content || viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) {
    if (mode === "page") return "height";
    if (mode === "height") return "width";
    return "page";
  }
  const steps = fitCycle(viewport, content, rotation);
  const index = steps.indexOf(mode);
  const at = index < 0 ? 0 : index;
  return steps[(at + 1) % steps.length] ?? "page";
}

/**
 * True when a portrait viewport is showing a very wide diagram and Fit height
 * is a real step up from fit page, so the hint's Fit height advice applies.
 */
export function shouldSuggestRotate(viewport: Size, content: Size): boolean {
  if (!(viewport.height > viewport.width) || viewport.width <= 0 || content.height <= 0) return false;
  if (content.width / content.height < 1.75) return false;
  if (!axisFitHelps(viewport, content, 0, "height")) return false;
  const axes = axisScales(viewport, content, 0);
  const page = Math.min(axes.width, axes.height);
  return capAxisFit(axes.height) >= page * 1.35;
}

/** Scale is the diagram's own size, within a small step of 100%. */
export function isActualScale(view: ViewTransform): boolean {
  return Math.abs(view.scale - 1) <= 0.02;
}

/**
 * Double-tap switches between the page fit and 100% at `focal`.
 * 100% keeps the diagram point under the tap fixed. Fit recenters the page.
 */
export function toggleFitAndActual(
  view: ViewTransform,
  focal: Point,
  viewport: Size,
  content: Size,
  limits?: ZoomLimits,
): ViewTransform {
  if (isActualScale(view)) return fit(viewport, content, view.rotation);
  if (view.scale <= 0) return view;
  return zoomAt(view, focal, 1 / view.scale, limits);
}

/** Clears zoom, pan, and rotation, then fits the upright diagram. */
export function resetView(viewport: Size, content: Size): ViewTransform {
  return fit(viewport, content, 0);
}

export function viewsClose(a: ViewTransform, b: ViewTransform, panEpsilon = 0.75): boolean {
  const scaleEpsilon = Math.max(1e-4, Math.abs(b.scale) * 1e-3);
  return (
    Math.abs(a.x - b.x) <= panEpsilon &&
    Math.abs(a.y - b.y) <= panEpsilon &&
    Math.abs(a.scale - b.scale) <= scaleEpsilon &&
    Math.abs(normalizeDegrees(a.rotation) - normalizeDegrees(b.rotation)) < 0.05
  );
}

/** True when pan is centered and scale matches a fit at the current rotation. */
export function isFitted(view: ViewTransform, viewport: Size, content: Size): boolean {
  return viewsClose(view, fit(viewport, content, view.rotation));
}

/**
 * Next camera after the viewport or the diagram size changes.
 * A view that has left the fitted baseline is kept, so a keystroke that
 * re-renders the picture does not snap pan or zoom back. Returns null when
 * the caller should leave the current view alone. The returned baseline is
 * the fit for this size.
 */
export function viewAfterMeasure(
  current: ViewTransform,
  baseline: ViewTransform | null,
  viewport: Size,
  content: Size,
  mode: FitMode = "page",
): { view: ViewTransform; baseline: ViewTransform } | null {
  if (baseline && !viewsClose(current, baseline)) return null;
  const next = fitTo(viewport, content, baseline ? current.rotation : 0, mode);
  return { view: next, baseline: next };
}

export function defaultZoomLimits(fitScale: number): ZoomLimits {
  return {
    min: Math.min(MIN_ZOOM, fitScale),
    max: Math.max(MAX_ZOOM, fitScale),
  };
}

export function clampZoom(scale: number, limits: ZoomLimits = { min: MIN_ZOOM, max: MAX_ZOOM }): number {
  if (!Number.isFinite(scale)) return limits.min;
  return Math.min(limits.max, Math.max(limits.min, scale));
}

/** Pan so a diagram-center-relative point sits in the middle, at the given scale. */
export function centerViewOn(point: Point, scale: number, rotation = 0): ViewTransform {
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = point.x * safe;
  const y = point.y * safe;
  return {
    x: -(x * cos - y * sin),
    y: -(x * sin + y * cos),
    scale: safe,
    rotation,
  };
}

/**
 * Zoom by `factor` while keeping the diagram point under `focal` fixed.
 * `focal` is in viewport pixels relative to the viewport center.
 */
export function zoomAt(
  view: ViewTransform,
  focal: Point,
  factor: number,
  limits?: ZoomLimits,
): ViewTransform {
  if (!Number.isFinite(factor) || factor <= 0 || view.scale <= 0) return view;
  const nextScale = clampZoom(view.scale * factor, limits);
  const k = nextScale / view.scale;
  if (k === 1) return { ...view, scale: nextScale };
  return {
    ...view,
    scale: nextScale,
    x: focal.x * (1 - k) + view.x * k,
    y: focal.y * (1 - k) + view.y * k,
  };
}

export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * Adds `degrees`. When the camera is still fitted, the result is fitted at
 * the new angle so a tall diagram fills a landscape screen after a quarter turn.
 * A zoomed or panned camera keeps its scale and pan and only changes angle.
 */
export function rotateView(
  view: ViewTransform,
  degrees: number,
  viewport: Size | null,
  content: Size | null,
): ViewTransform {
  const rotation = normalizeDegrees(view.rotation + degrees);
  if (viewport && content && isFitted(view, viewport, content)) {
    return fit(viewport, content, rotation);
  }
  return { ...view, rotation };
}

/** Diagram-center point currently under a viewport-center-relative screen point. */
export function screenToContent(view: ViewTransform, screen: Point): Point {
  const dx = screen.x - view.x;
  const dy = screen.y - view.y;
  const rad = (-normalizeDegrees(view.rotation) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: (dx * cos - dy * sin) / view.scale,
    y: (dx * sin + dy * cos) / view.scale,
  };
}

export function cssTransform(view: ViewTransform, content: Size): string {
  const ox = -content.width / 2;
  const oy = -content.height / 2;
  return `translate(${view.x}px, ${view.y}px) rotate(${view.rotation}deg) scale(${view.scale}) translate(${ox}px, ${oy}px)`;
}

export function pointerAngle(point: Point): number {
  return (Math.atan2(point.y, point.x) * 180) / Math.PI;
}

/** Shortest signed turn from `from` to `to`, in degrees. */
export function rotationDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function pinchUpdate(
  previous: { distance: number; midpoint: Point },
  next: { distance: number; midpoint: Point },
): { factor: number; panX: number; panY: number } {
  const factor = previous.distance > 0 ? next.distance / previous.distance : 1;
  return {
    factor: Number.isFinite(factor) && factor > 0 ? factor : 1,
    panX: next.midpoint.x - previous.midpoint.x,
    panY: next.midpoint.y - previous.midpoint.y,
  };
}
