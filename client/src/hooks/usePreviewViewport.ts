import { useLayoutEffect, useRef, useState } from "react";
import { useDiagramView } from "./useDiagramView";
import { useStageSize } from "./useStageSize";
import { useViewGestures } from "./useViewGestures";
import { readSvgSize } from "../lib/svgBox";
import { cssTransform, type Size } from "../lib/viewTransform";

/**
 * Pan and zoom for the editor preview. The camera lives here, not in render
 * state that follows the source, so a keystroke does not snap the view back.
 */
export function usePreviewViewport(svgHtml: string) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<Size | null>(null);
  const viewport = useStageSize(stageRef);
  const camera = useDiagramView(viewport, content, { readable: true });
  const gestures = useViewGestures({
    stageRef,
    wheelTargetRef: stageRef,
    camera,
    rotate: false,
  });

  useLayoutEffect(() => {
    const node = canvasRef.current?.querySelector("svg");
    if (!(node instanceof SVGSVGElement)) return;
    const next = readSvgSize(node);
    if (!next) return;
    setContent((prev) =>
      prev && prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, [svgHtml]);

  const ready = content != null && viewport != null && viewport.width > 0 && viewport.height > 0;
  const revealed = ready && camera.placed;
  const canvasStyle = content
    ? {
        width: content.width,
        height: content.height,
        transform: cssTransform(camera.view, content),
        visibility: revealed ? ("visible" as const) : ("hidden" as const),
      }
    : { visibility: "hidden" as const };

  return {
    stageRef,
    canvasRef,
    camera,
    gestures,
    canvasStyle,
    ready,
    pct: Math.round(camera.view.scale * 100),
  };
}
