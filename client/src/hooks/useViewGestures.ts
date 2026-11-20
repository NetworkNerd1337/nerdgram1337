import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  classifyTap,
  emptyGestureSession,
  focalFromClient,
  pointerDown,
  pointerMove,
  pointerUp,
  wheelFocal,
  wheelFromEvent,
  type GestureResult,
  type PointerInput,
  type TapPoint,
} from "../lib/viewGestures";
import type { Point } from "../lib/viewTransform";

type Camera = {
  zoomAtPoint: (focal: Point, factor: number) => void;
  pan: (dx: number, dy: number) => void;
  rotateFree: (degrees: number) => void;
  /** Touch double-tap. Presentation toggles fit and 100% around the tap. */
  toggleActual?: (focal: Point) => void;
};

type UseViewGesturesOptions = {
  stageRef: RefObject<HTMLElement | null>;
  /** Element that receives the wheel. Presentation uses the overlay. The preview uses the stage. */
  wheelTargetRef: RefObject<HTMLElement | null>;
  camera: Camera;
  rotate: boolean;
  /** Called when the pointer or wheel is active. Presentation reveals its bar from this. */
  activityRef?: RefObject<(() => void) | null>;
  /** A completed click that did not drag. Presentation opens a linked node from this. */
  onClickRef?: RefObject<((info: { target: EventTarget | null }) => void) | null>;
  /** Touch double-tap toggles fit and 100%. Mouse clicks stay clicks. */
  doubleTap?: boolean;
};

function inputFrom(event: {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  pointerType: string;
  altKey: boolean;
  target: EventTarget | null;
}): PointerInput {
  return {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    pointerType: event.pointerType,
    altKey: event.altKey,
    target: event.target,
  };
}

/**
 * Drag to pan, wheel to zoom around the pointer, and the optional rotate and
 * pinch gestures. The camera object is read from a ref so a parent re-render
 * does not drop the gesture or reset the view.
 */
export function useViewGestures({
  stageRef,
  wheelTargetRef,
  camera,
  rotate,
  activityRef,
  onClickRef,
  doubleTap = false,
}: UseViewGesturesOptions) {
  const session = useRef(emptyGestureSession());
  const lastTap = useRef<TapPoint | null>(null);
  const focalRef = useRef<Point>({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const cameraRef = useRef(camera);
  const rotateRef = useRef(rotate);
  useLayoutEffect(() => {
    cameraRef.current = camera;
    rotateRef.current = rotate;
  });
  const [panning, setPanning] = useState(false);

  const apply = (result: GestureResult, node: HTMLElement | null) => {
    session.current = result.session;
    if (result.focal) focalRef.current = result.focal;
    if (result.panning != null) setPanning(result.panning);
    if (result.captureId != null && node && typeof node.setPointerCapture === "function") {
      const id = result.captureId;
      if (node.hasPointerCapture?.(id) !== true) node.setPointerCapture(id);
    }
    const api = cameraRef.current;
    if (result.zoom) api.zoomAtPoint(result.zoom.focal, result.zoom.factor);
    if (result.pan) api.pan(result.pan.dx, result.pan.dy);
    if (result.rotate) api.rotateFree(result.rotate);
    if (result.click) onClickRef?.current?.(result.click);
    if (result.activity) activityRef?.current?.();
  };

  useEffect(() => {
    const element = wheelTargetRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stageRef.current?.getBoundingClientRect() ?? null;
      const focal = wheelFocal(event.clientX, event.clientY, rect, focalRef.current);
      focalRef.current = focal;
      const gesture = wheelFromEvent(event);
      const api = cameraRef.current;
      if (gesture.type === "zoom") api.zoomAtPoint(focal, gesture.factor);
      else api.pan(gesture.dx, gesture.dy);
      activityRef?.current?.();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [activityRef, stageRef, wheelTargetRef]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    draggedRef.current = false;
    const focal = focalFromClient(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    const result = pointerDown(session.current, inputFrom(event), focal, { rotate: rotateRef.current });
    apply(result, event.currentTarget);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const focal = focalFromClient(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    const result = pointerMove(session.current, inputFrom(event), focal);
    if (result.session.press?.dragged) draggedRef.current = true;
    apply(result, event.currentTarget);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (session.current.press?.dragged) draggedRef.current = true;
    let result = pointerUp(session.current, inputFrom(event));
    if (doubleTap && result.click && event.pointerType === "touch") {
      const decision = classifyTap(lastTap.current, {
        time: event.timeStamp,
        x: event.clientX,
        y: event.clientY,
      });
      lastTap.current = decision.previous;
      if (decision.double) {
        const focal = focalFromClient(
          event.clientX,
          event.clientY,
          event.currentTarget.getBoundingClientRect(),
        );
        focalRef.current = focal;
        cameraRef.current.toggleActual?.(focal);
        result = { ...result, click: null };
      }
    }
    apply(result, event.currentTarget);
  };

  return {
    panning,
    /** True after a drag until the next press, so a click that follows pointerup can ignore it. */
    dragged: () => draggedRef.current,
    focalRef,
    /** True while a pointer from this gesture is down. */
    isDragging: () => session.current.pointers.size > 0,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };
}
