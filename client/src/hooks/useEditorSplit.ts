import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  CODE_MIN_PX,
  CODE_MIN_WITH_INFO_PX,
  DEFAULT_EDITOR_SPLIT,
  PREVIEW_MIN_PX,
  SPLIT_DIVIDER_PX,
  clampEditorSplit,
  readEditorSplit,
  writeEditorSplit,
} from "../lib/editorSplit";

const STACKED_QUERY = "(max-width: 960px)";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Drag, keyboard, and remembered width for the editor/preview divider.
 * A narrow window keeps the stacked layout and does not apply a width.
 */
export function useEditorSplit(panelsRef: RefObject<HTMLDivElement | null>, infoOpen: boolean) {
  const initialSplit = readEditorSplit(storage());
  const percentRef = useRef(initialSplit);
  const availableRef = useRef(0);
  const drag = useRef<{ x: number; percent: number; available: number } | null>(null);
  const [percent, setPercent] = useState(initialSplit);
  const [codeWidth, setCodeWidth] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ min: 15, max: 85 });
  const [stacked, setStacked] = useState(false);

  const measure = useCallback(
    (nextPercent: number, persist: boolean) => {
      const panels = panelsRef.current;
      const narrow = typeof window !== "undefined" && window.matchMedia(STACKED_QUERY).matches;
      setStacked(narrow);
      if (!panels || narrow) {
        setCodeWidth(null);
        return;
      }
      const total = panels.getBoundingClientRect().width;
      if (total < SPLIT_DIVIDER_PX) {
        setCodeWidth(null);
        return;
      }
      const info = infoOpen ? (panels.querySelector(".diagram-info")?.getBoundingClientRect().width ?? 0) : 0;
      const available = Math.max(0, total - info - SPLIT_DIVIDER_PX);
      availableRef.current = available;
      const codeMin = infoOpen ? CODE_MIN_WITH_INFO_PX : CODE_MIN_PX;
      const clamped = clampEditorSplit(nextPercent, available, codeMin, PREVIEW_MIN_PX);
      const width = available > 0 ? (available * clamped) / 100 : 0;
      percentRef.current = clamped;
      const minPct = available > 0 ? (codeMin / available) * 100 : 0;
      const maxPct = available > 0 ? Math.max(minPct, ((available - PREVIEW_MIN_PX) / available) * 100) : 100;
      setPercent((prev) => (Math.abs(prev - clamped) < 0.05 ? prev : clamped));
      setBounds((prev) =>
        Math.abs(prev.min - minPct) < 0.05 && Math.abs(prev.max - maxPct) < 0.05 ? prev : { min: minPct, max: maxPct },
      );
      setCodeWidth((prev) => (prev != null && Math.abs(prev - width) < 0.5 ? prev : width));
      if (persist) writeEditorSplit(storage(), clamped);
    },
    [infoOpen, panelsRef],
  );

  useLayoutEffect(() => {
    measure(percentRef.current, false);
    const panels = panelsRef.current;
    if (!panels || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure(percentRef.current, false));
    observer.observe(panels);
    const media = window.matchMedia(STACKED_QUERY);
    const onMedia = () => measure(percentRef.current, false);
    media.addEventListener("change", onMedia);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onMedia);
    };
  }, [measure, panelsRef]);

  const onChange = useCallback((next: number) => measure(next, true), [measure]);
  const onReset = useCallback(() => measure(DEFAULT_EDITOR_SPLIT, true), [measure]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      percent: percentRef.current,
      available: availableRef.current > 0 ? availableRef.current : 1,
    };
    event.currentTarget.classList.add("is-dragging");
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const active = drag.current;
      if (!active) return;
      const delta = ((event.clientX - active.x) / active.available) * 100;
      measure(active.percent + delta, false);
    },
    [measure],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.classList.remove("is-dragging");
    writeEditorSplit(storage(), percentRef.current);
  }, []);

  return {
    percent,
    codeWidth,
    bounds,
    stacked,
    onChange,
    onReset,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
