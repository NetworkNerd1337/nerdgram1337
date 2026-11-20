import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultZoomLimits,
  fit,
  fitTo,
  identityView,
  isActualScale,
  isFitted,
  nextFitMode,
  normalizeDegrees,
  panBy,
  resetView,
  rotateView,
  toggleFitAndActual,
  viewAfterMeasure,
  viewsClose,
  zoomAt,
  type FitMode,
  type Point,
  type Size,
  type ViewTransform,
} from "../lib/viewTransform";

/**
 * Presentation camera. Resize, orientation, and content-size changes re-fit
 * only while the user is still on the fitted view for the previous size.
 * A source refresh that does not change that fit leaves pan, zoom, and rotation.
 */
export function useDiagramView(viewport: Size | null, content: Size | null) {
  const [view, setView] = useState<ViewTransform>(identityView);
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const viewRef = useRef(view);
  const fitModeRef = useRef<FitMode>("page");
  const fittedBaseline = useRef<ViewTransform | null>(null);
  const viewportRef = useRef<Size | null>(null);
  const contentRef = useRef<Size | null>(null);

  const vw = viewport?.width ?? 0;
  const vh = viewport?.height ?? 0;
  const cw = content?.width ?? 0;
  const ch = content?.height ?? 0;
  const ready = vw > 0 && vh > 0 && cw > 0 && ch > 0;

  const commit = useCallback((next: ViewTransform) => {
    viewRef.current = next;
    const vp = viewportRef.current;
    const ct = contentRef.current;
    const fitted = Boolean(vp && ct && isFitted(next, vp, ct));
    if (fitted) fittedBaseline.current = next;
    setView(next);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const nextViewport = { width: vw, height: vh };
    const nextContent = { width: cw, height: ch };
    viewportRef.current = nextViewport;
    contentRef.current = nextContent;
    const current = viewRef.current;
    const decision = viewAfterMeasure(
      current,
      fittedBaseline.current,
      nextViewport,
      nextContent,
      fitModeRef.current,
    );
    if (!decision) return;
    fittedBaseline.current = decision.baseline;
    if (viewsClose(current, decision.view)) {
      viewRef.current = decision.view;
      return;
    }
    viewRef.current = decision.view;
    setView(decision.view);
  }, [ready, vw, vh, cw, ch]);

  const limitsFor = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    const fitScale =
      vp && ct ? fit(vp, ct, viewRef.current.rotation).scale : viewRef.current.scale;
    return defaultZoomLimits(fitScale);
  }, []);

  const zoomAtPoint = useCallback(
    (focal: Point, factor: number) => {
      commit(zoomAt(viewRef.current, focal, factor, limitsFor()));
    },
    [commit, limitsFor],
  );

  const pan = useCallback(
    (dx: number, dy: number) => {
      commit(panBy(viewRef.current, dx, dy));
    },
    [commit],
  );

  const rotate = useCallback(
    (degrees: number) => {
      const vp = viewportRef.current;
      const ct = contentRef.current;
      const current = viewRef.current;
      if (vp && ct) {
        const modeFit = fitTo(vp, ct, current.rotation, fitModeRef.current);
        if (viewsClose(current, modeFit)) {
          const next = fitTo(vp, ct, current.rotation + degrees, fitModeRef.current);
          fittedBaseline.current = next;
          viewRef.current = next;
          setView(next);
          return;
        }
      }
      commit(rotateView(current, degrees, vp, ct));
    },
    [commit],
  );

  const rotateFree = useCallback(
    (degrees: number) => {
      if (!degrees) return;
      const current = viewRef.current;
      commit({ ...current, rotation: normalizeDegrees(current.rotation + degrees) });
    },
    [commit],
  );

  const rememberMode = useCallback((mode: FitMode) => {
    fitModeRef.current = mode;
    setFitMode(mode);
  }, []);

  const reset = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return;
    rememberMode("page");
    commit(resetView(vp, ct));
  }, [commit, rememberMode]);

  const cycleFit = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    const rotation = viewRef.current.rotation;
    const next = nextFitMode(fitModeRef.current, vp, ct, rotation);
    rememberMode(next);
    if (!vp || !ct) return;
    const fitted = fitTo(vp, ct, rotation, next);
    fittedBaseline.current = fitted;
    viewRef.current = fitted;
    setView(fitted);
  }, [rememberMode]);

  const toggleActual = useCallback(
    (focal: Point) => {
      const vp = viewportRef.current;
      const ct = contentRef.current;
      if (!vp || !ct) return;
      const returning = isActualScale(viewRef.current);
      const next = toggleFitAndActual(viewRef.current, focal, vp, ct, limitsFor());
      if (returning) rememberMode("page");
      if (returning) {
        commit(next);
        return;
      }
      viewRef.current = next;
      setView(next);
    },
    [commit, limitsFor, rememberMode],
  );

  const atFit = Boolean(viewport && content && isFitted(view, viewport, content));

  const isAtFit = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return true;
    return isFitted(viewRef.current, vp, ct);
  }, []);

  return { view, fitMode, atFit, isAtFit, zoomAtPoint, pan, rotate, rotateFree, reset, cycleFit, toggleActual };
}
