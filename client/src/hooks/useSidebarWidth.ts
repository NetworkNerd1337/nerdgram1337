import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_NARROW_QUERY,
  clampSidebarWidth,
  readSidebarWidth,
  sidebarBounds,
  writeSidebarWidth,
} from "../lib/sidebarWidth";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function viewportWidth(): number {
  if (typeof window === "undefined") return 1280;
  return window.innerWidth || 1280;
}

function narrowNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(SIDEBAR_NARROW_QUERY).matches;
}

/**
 * Drag, keyboard, and remembered width for the sidebar/main divider.
 * A narrow window keeps the stacked layout and does not apply a width.
 * Resizing does not write the editor/preview split.
 */
export function useSidebarWidth() {
  const saved = readSidebarWidth(storage());
  const initialWidth = clampSidebarWidth(saved, viewportWidth());
  const preferredRef = useRef(saved);
  const widthRef = useRef(initialWidth);
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const [width, setWidth] = useState(initialWidth);
  const [bounds, setBounds] = useState(() => sidebarBounds(viewportWidth()));
  const [narrow, setNarrow] = useState(narrowNow);

  const apply = useCallback((next: number, persist: boolean) => {
    const view = viewportWidth();
    const stacked = narrowNow();
    setNarrow(stacked);
    const clamped = clampSidebarWidth(next, view);
    const nextBounds = sidebarBounds(view);
    widthRef.current = clamped;
    if (persist && !stacked) preferredRef.current = clamped;
    setBounds((prev) => (prev.min === nextBounds.min && prev.max === nextBounds.max ? prev : nextBounds));
    setWidth((prev) => (prev === clamped ? prev : clamped));
    if (persist && !stacked) writeSidebarWidth(storage(), clamped);
  }, []);

  useLayoutEffect(() => {
    apply(preferredRef.current, false);
    if (typeof window === "undefined") return;
    const onResize = () => apply(preferredRef.current, false);
    window.addEventListener("resize", onResize);
    const media = window.matchMedia(SIDEBAR_NARROW_QUERY);
    media.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      media.removeEventListener("change", onResize);
    };
  }, [apply]);

  const onChange = useCallback((next: number) => apply(next, true), [apply]);
  const onReset = useCallback(() => apply(DEFAULT_SIDEBAR_WIDTH, true), [apply]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: widthRef.current, moved: false };
    event.currentTarget.classList.add("is-dragging");
    document.body.classList.add("is-col-resizing");
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const active = drag.current;
      if (!active) return;
      active.moved = true;
      apply(active.width + (event.clientX - active.x), false);
    },
    [apply],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    drag.current = null;
    event.currentTarget.classList.remove("is-dragging");
    document.body.classList.remove("is-col-resizing");
    if (!active?.moved) return;
    preferredRef.current = widthRef.current;
    writeSidebarWidth(storage(), preferredRef.current);
  }, []);

  return {
    width,
    bounds,
    narrow,
    onChange,
    onReset,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
