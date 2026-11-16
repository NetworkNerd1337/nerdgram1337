import { useEffect, useState, type RefObject } from "react";
import type { Size } from "../lib/viewTransform";

/** Viewport size of a stage element, including resolution and orientation changes. */
export function useStageSize(stage: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) =>
        prev && Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    const visual = window.visualViewport;
    visual?.addEventListener("resize", measure);
    let media: MediaQueryList | null = null;
    const onResolution = () => {
      measure();
      media?.removeEventListener("change", onResolution);
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener("change", onResolution);
    };
    try {
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener("change", onResolution);
    } catch {
      media = null;
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      visual?.removeEventListener("resize", measure);
      media?.removeEventListener("change", onResolution);
    };
  }, [stage]);
  return size;
}
