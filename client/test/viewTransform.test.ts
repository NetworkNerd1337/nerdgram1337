import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  cssTransform,
  FIT_AXIS_MAX,
  fit,
  fitCycle,
  fitTo,
  identityView,
  isFitted,
  nextFitMode,
  panBy,
  pinchUpdate,
  resetView,
  rotateView,
  rotatedContentSize,
  screenToContent,
  shouldSuggestRotate,
  toggleFitAndActual,
  viewAfterMeasure,
  zoomAt,
  type Size,
  type ViewTransform,
} from "../src/lib/viewTransform";

const viewport: Size = { width: 1000, height: 500 };
const tall: Size = { width: 200, height: 800 };
const wide: Size = { width: 800, height: 200 };

function expectSamePoint(
  view: ViewTransform,
  next: ViewTransform,
  focal: { x: number; y: number },
) {
  const before = screenToContent(view, focal);
  const after = screenToContent(next, focal);
  expect(after.x).toBeCloseTo(before.x, 6);
  expect(after.y).toBeCloseTo(before.y, 6);
}

describe("view transform", () => {
  it("zooms toward a point and leaves the center alone when the focal point is the center", () => {
    const start = identityView();
    const center = zoomAt(start, { x: 0, y: 0 }, 2);
    expect(center).toMatchObject({ x: 0, y: 0, scale: 2, rotation: 0 });

    const corner = zoomAt(start, { x: 100, y: -40 }, 2);
    expect(corner.scale).toBe(2);
    expect(corner.x).not.toBe(0);
    expect(corner.y).not.toBe(0);
    expectSamePoint(start, corner, { x: 100, y: -40 });
  });

  it("keeps the focal point fixed while rotated", () => {
    const start: ViewTransform = { x: 12, y: -30, scale: 1.5, rotation: 35 };
    const focal = { x: 80, y: 25 };
    const next = zoomAt(start, focal, 1.4);
    expectSamePoint(start, next, focal);
    expect(next.rotation).toBe(35);
  });

  it("clamps interactive zoom to the documented limits", () => {
    const huge = zoomAt({ ...identityView(), scale: MAX_ZOOM }, { x: 10, y: 10 }, 10);
    expect(huge.scale).toBe(MAX_ZOOM);
    expect(huge.x).toBe(0);
    const tiny = zoomAt({ ...identityView(), scale: MIN_ZOOM }, { x: 0, y: 0 }, 0.01);
    expect(tiny.scale).toBe(MIN_ZOOM);
    const custom = zoomAt(identityView(), { x: 0, y: 0 }, 0.01, { min: 0.02, max: 20 });
    expect(custom.scale).toBe(0.02);
    expect(zoomAt(identityView(), { x: 0, y: 0 }, 0)).toEqual(identityView());
  });

  it("pans in each direction", () => {
    let view = identityView();
    view = panBy(view, 15, 0);
    expect(view.x).toBe(15);
    view = panBy(view, -15, 0);
    expect(view.x).toBe(0);
    view = panBy(view, 0, 8);
    expect(view.y).toBe(8);
    view = panBy(view, 0, -8);
    expect(view.y).toBe(0);
  });

  it("steps rotation by 90 degrees and wraps", () => {
    let view = identityView();
    view = rotateView(view, 90, null, null);
    expect(view.rotation).toBe(90);
    view = rotateView(view, 90, null, null);
    expect(view.rotation).toBe(180);
    view = rotateView(view, 90, null, null);
    expect(view.rotation).toBe(270);
    view = rotateView(view, 90, null, null);
    expect(view.rotation).toBe(0);
    expect(rotateView(identityView(), -90, null, null).rotation).toBe(270);
  });

  it("fits a tall diagram to a landscape viewport, and larger after a quarter turn", () => {
    const upright = fit(viewport, tall, 0);
    const turned = fit(viewport, tall, 90);
    const turnedBack = fit(viewport, tall, 270);
    expect(upright.x).toBe(0);
    expect(upright.y).toBe(0);
    expect(upright.rotation).toBe(0);
    expect(rotatedContentSize(tall, 0)).toEqual({ width: 200, height: 800 });
    expect(rotatedContentSize(tall, 90)).toEqual({ width: 800, height: 200 });
    expect(rotatedContentSize(tall, 270)).toEqual({ width: 800, height: 200 });
    expect(upright.scale * 800).toBeLessThanOrEqual(viewport.height);
    expect(upright.scale * 200).toBeLessThanOrEqual(viewport.width);
    expect(turned.scale).toBeGreaterThan(upright.scale);
    expect(turned.scale).toBeCloseTo(turnedBack.scale);
    expect(turned.scale * 800).toBeLessThanOrEqual(viewport.width);
    expect(turned.scale * 200).toBeLessThanOrEqual(viewport.height);
    expect(isFitted(upright, viewport, tall)).toBe(true);
    expect(isFitted(turned, viewport, tall)).toBe(true);
  });

  it("fits a wide diagram to a portrait viewport after rotation", () => {
    const portrait = { width: 500, height: 1000 };
    const upright = fit(portrait, wide, 0);
    const turned = fit(portrait, wide, 90);
    expect(turned.scale).toBeGreaterThan(upright.scale);
    expect(turned.scale * 800).toBeLessThanOrEqual(portrait.height);
    expect(turned.scale * 200).toBeLessThanOrEqual(portrait.width);
  });

  it("re-fits a quarter turn only when the camera was already fitted", () => {
    const fitted = fit(viewport, tall, 0);
    const turned = rotateView(fitted, 90, viewport, tall);
    expect(turned.rotation).toBe(90);
    expect(isFitted(turned, viewport, tall)).toBe(true);
    expect(turned.scale).toBeCloseTo(fit(viewport, tall, 90).scale);

    const zoomed: ViewTransform = { ...fitted, scale: fitted.scale * 2, x: 40, y: -12 };
    const kept = rotateView(zoomed, 90, viewport, tall);
    expect(kept.scale).toBe(zoomed.scale);
    expect(kept.x).toBe(40);
    expect(kept.y).toBe(-12);
    expect(kept.rotation).toBe(90);
    expect(isFitted(kept, viewport, tall)).toBe(false);
  });

  it("resets zoom, pan, and rotation", () => {
    const messy: ViewTransform = { x: 80, y: -20, scale: 4, rotation: 90 };
    const next = resetView(viewport, tall);
    expect(next.rotation).toBe(0);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
    expect(next.scale).toBeCloseTo(fit(viewport, tall, 0).scale);
    expect(isFitted(next, viewport, tall)).toBe(true);
    expect(isFitted(messy, viewport, tall)).toBe(false);
    expect(cssTransform(next, tall)).toContain("rotate(0deg)");
    expect(cssTransform(next, tall)).toContain("scale(");
    expect(cssTransform(messy, tall)).toContain("translate(80px, -20px)");
  });

  it("keeps a zoomed view when the diagram is measured again", () => {
    const fitted = fit(viewport, wide, 0);
    const zoomed = zoomAt(fitted, { x: 40, y: -20 }, 1.5);
    expect(viewAfterMeasure(zoomed, fitted, viewport, { width: wide.width + 30, height: wide.height })).toBeNull();
    const stillFitted = viewAfterMeasure(fitted, fitted, viewport, tall);
    expect(stillFitted).not.toBeNull();
    expect(isFitted(stillFitted!.view, viewport, tall)).toBe(true);
    const first = viewAfterMeasure(identityView(), null, viewport, wide);
    expect(first?.view).toEqual(fit(viewport, wide, 0));
  });

  it("fits a wide phone diagram to its height and a tall one to its width", () => {
    const phone: Size = { width: 390, height: 844 };
    const wideDiagram: Size = { width: 1800, height: 420 };
    const tallDiagram: Size = { width: 420, height: 1800 };
    const page = fit(phone, wideDiagram, 0);
    const byHeight = fitTo(phone, wideDiagram, 0, "height");
    const byWidth = fitTo(phone, wideDiagram, 0, "width");
    expect(byHeight.scale).toBeGreaterThan(page.scale * 2);
    expect(byWidth.scale).toBeCloseTo(page.scale);
    expect(byHeight.x).toBe(0);
    expect(byHeight.y).toBe(0);
    expect(fitTo(phone, tallDiagram, 0, "width").scale).toBeGreaterThan(fit(phone, tallDiagram, 0).scale);
    expect(fitTo(phone, tallDiagram, 0, "width").scale).toBeLessThanOrEqual(FIT_AXIS_MAX);
    expect(nextFitMode("page", phone, wideDiagram)).toBe("height");
    expect(nextFitMode("height", phone, wideDiagram)).toBe("page");
    expect(nextFitMode("page", phone, tallDiagram)).toBe("width");
    expect(nextFitMode("width", phone, tallDiagram)).toBe("page");
  });

  it("caps a short wide fit at 200% and keeps a sequence fit under that cap", () => {
    const phone: Size = { width: 390, height: 844 };
    const desktop: Size = { width: 1280, height: 800 };
    // NetworkMap-like: about 10:1, which used to open Fit height near 1078%.
    const networkMap: Size = { width: 746, height: 74 };
    const sequence: Size = { width: 903, height: 574 };
    const tallSkinny: Size = { width: 80, height: 1800 };

    const mapPage = fit(phone, networkMap, 0).scale;
    const mapHeight = fitTo(phone, networkMap, 0, "height").scale;
    expect(mapPage).toBeGreaterThan(0.4);
    expect(mapPage).toBeLessThan(0.5);
    expect(mapHeight).toBe(FIT_AXIS_MAX);
    expect(mapHeight).toBeLessThanOrEqual(MAX_ZOOM);
    expect(mapHeight).toBeLessThan(8);
    expect(fitTo(desktop, networkMap, 0, "height").scale).toBe(FIT_AXIS_MAX);
    expect(nextFitMode("page", phone, networkMap)).toBe("height");
    expect(nextFitMode("height", phone, networkMap)).toBe("page");
    expect(fitCycle(phone, networkMap)).toEqual(["page", "height"]);
    expect(shouldSuggestRotate(phone, networkMap)).toBe(true);

    const sequenceHeight = fitTo(phone, sequence, 0, "height").scale;
    expect(sequenceHeight).toBeCloseTo(1.39, 1);
    expect(sequenceHeight).toBeLessThan(FIT_AXIS_MAX);
    expect(fitCycle(phone, sequence)).toEqual(["page", "height"]);

    const tallWidth = fitTo(phone, tallSkinny, 0, "width").scale;
    expect(tallWidth).toBe(FIT_AXIS_MAX);
    expect(tallWidth).toBeLessThanOrEqual(MAX_ZOOM);
    expect(fit(phone, tallSkinny, 0).scale).toBeLessThan(0.5);
    expect(fitCycle(phone, tallSkinny)).toEqual(["page", "width"]);
    expect(shouldSuggestRotate(phone, tallSkinny)).toBe(false);

    const alreadyLarge: Size = { width: 100, height: 100 };
    expect(fit(phone, alreadyLarge, 0).scale).toBeGreaterThan(FIT_AXIS_MAX);
    expect(fitCycle(phone, alreadyLarge)).toEqual(["page"]);
    expect(nextFitMode("page", phone, alreadyLarge)).toBe("page");
  });

  it("keeps a height fit across a resize and leaves a pan alone", () => {
    const phone: Size = { width: 390, height: 844 };
    const wideDiagram: Size = { width: 1800, height: 420 };
    const heightFit = fitTo(phone, wideDiagram, 0, "height");
    const nextViewport: Size = { width: 400, height: 800 };
    const resized = viewAfterMeasure(heightFit, heightFit, nextViewport, wideDiagram, "height");
    expect(resized?.view.scale).toBeCloseTo(fitTo(nextViewport, wideDiagram, 0, "height").scale);
    expect(viewAfterMeasure({ ...heightFit, x: 30 }, heightFit, phone, wideDiagram, "height")).toBeNull();
  });

  it("toggles between page fit and 100% at the tapped point", () => {
    const phone: Size = { width: 390, height: 844 };
    const wideDiagram: Size = { width: 1800, height: 420 };
    const fitted = fit(phone, wideDiagram, 0);
    const focal = { x: 40, y: -10 };
    const actual = toggleFitAndActual(fitted, focal, phone, wideDiagram);
    expect(actual.scale).toBeCloseTo(1);
    expectSamePoint(fitted, actual, focal);
    const back = toggleFitAndActual(actual, focal, phone, wideDiagram);
    expect(isFitted(back, phone, wideDiagram)).toBe(true);
    expect(back.x).toBe(0);
    expect(back.y).toBe(0);
  });

  it("suggests rotating only for a very wide diagram in portrait", () => {
    const phone: Size = { width: 390, height: 844 };
    const landscape: Size = { width: 844, height: 390 };
    expect(shouldSuggestRotate(phone, { width: 1800, height: 420 })).toBe(true);
    expect(shouldSuggestRotate(phone, { width: 420, height: 1800 })).toBe(false);
    expect(shouldSuggestRotate(landscape, { width: 1800, height: 420 })).toBe(false);
    expect(shouldSuggestRotate(phone, { width: 500, height: 400 })).toBe(false);
  });

  it("reports a pinch as a scale factor and a pan of the midpoint", () => {
    const update = pinchUpdate(
      { distance: 100, midpoint: { x: 0, y: 0 } },
      { distance: 150, midpoint: { x: 10, y: -4 } },
    );
    expect(update.factor).toBeCloseTo(1.5);
    expect(update.panX).toBe(10);
    expect(update.panY).toBe(-4);
  });
});
