/**
 * Pointer and wheel gestures shared by presentation and the editor preview.
 *
 * The stage reports positions relative to its center, matching `viewTransform`.
 * A mouse wheel zooms around the pointer. A trackpad scroll pans. A drag pans.
 * Two pointers pinch. Alt+drag rotates only when `rotate` is enabled, which
 * presentation uses and the preview does not.
 */

import { pointerMovedPastClick } from "./sourceJump";
import { wheelGesture, type WheelGesture } from "./presentationKeys";
import {
  panBy,
  pinchUpdate,
  pointerAngle,
  rotationDelta,
  zoomAt,
  type Point,
  type ViewTransform,
  type ZoomLimits,
} from "./viewTransform";

export type GestureMode = {
  /** Alt+drag rotates. Presentation turns this on. The preview leaves it off. */
  rotate: boolean;
};

export type ActiveGesture =
  | { kind: "none" }
  | { kind: "pan"; id: number; last: Point }
  | { kind: "rotate"; id: number; lastAngle: number }
  | { kind: "pinch"; distance: number; midpoint: Point };

export type GesturePress = {
  x: number;
  y: number;
  dragged: boolean;
  target: EventTarget | null;
};

export type GestureSession = {
  pointers: Map<number, Point>;
  gesture: ActiveGesture;
  press: GesturePress | null;
  panning: boolean;
};

export type PointerInput = {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  pointerType: string;
  altKey: boolean;
  target: EventTarget | null;
};

export type GestureResult = {
  session: GestureSession;
  focal: Point | null;
  pan: { dx: number; dy: number } | null;
  zoom: { focal: Point; factor: number } | null;
  rotate: number | null;
  /** Capture this pointer id after the event, or null to leave capture alone. */
  captureId: number | null;
  /** Replacement for the grabbing cursor, or null to leave it. */
  panning: boolean | null;
  /** A press that never crossed the drag threshold. */
  click: { target: EventTarget | null } | null;
  activity: boolean;
};

/** Two taps inside this window and this distance are one double-tap. */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_SLOP = 28;

export type TapPoint = { time: number; x: number; y: number };

/**
 * A touch double-tap. The first tap is remembered. The second, close in time
 * and position, is the double. A double clears the memory so a third tap starts over.
 */
export function classifyTap(
  previous: TapPoint | null,
  tap: TapPoint,
  options?: { maxMs?: number; slop?: number },
): { double: boolean; previous: TapPoint | null } {
  const maxMs = options?.maxMs ?? DOUBLE_TAP_MS;
  const slop = options?.slop ?? DOUBLE_TAP_SLOP;
  if (
    previous &&
    tap.time >= previous.time &&
    tap.time - previous.time <= maxMs &&
    Math.hypot(tap.x - previous.x, tap.y - previous.y) <= slop
  ) {
    return { double: true, previous: null };
  }
  return { double: false, previous: tap };
}

export function emptyGestureSession(): GestureSession {
  return {
    pointers: new Map(),
    gesture: { kind: "none" },
    press: null,
    panning: false,
  };
}

export function focalFromClient(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number } | null,
): Point {
  if (!rect) return { x: 0, y: 0 };
  return {
    x: clientX - rect.left - rect.width / 2,
    y: clientY - rect.top - rect.height / 2,
  };
}

/** Wheel focal from the stage box, or the last pointer position when the box is missing. */
export function wheelFocal(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number } | null,
  fallback: Point,
): Point {
  if (!rect) return fallback;
  return focalFromClient(clientX, clientY, rect);
}

/** Apply one wheel gesture to a camera. Zoom keeps the focal diagram point fixed. */
export function viewFromWheel(
  view: ViewTransform,
  focal: Point,
  gesture: WheelGesture,
  limits?: ZoomLimits,
): ViewTransform {
  if (gesture.type === "zoom") return zoomAt(view, focal, gesture.factor, limits);
  return panBy(view, gesture.dx, gesture.dy);
}

export function wheelFromEvent(event: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}): WheelGesture {
  return wheelGesture(event);
}

function idleResult(session: GestureSession, activity = false): GestureResult {
  return {
    session,
    focal: null,
    pan: null,
    zoom: null,
    rotate: null,
    captureId: null,
    panning: null,
    click: null,
    activity,
  };
}

function pairInfo(pointers: Map<number, Point>): { distance: number; midpoint: Point } | null {
  const points = [...pointers.values()];
  if (points.length < 2) return null;
  const [a, b] = points;
  if (!a || !b) return null;
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

export function pointerDown(
  session: GestureSession,
  input: PointerInput,
  focal: Point,
  mode: GestureMode,
): GestureResult {
  if (input.button !== 0 && input.pointerType === "mouse") return idleResult(session);
  const pointers = new Map(session.pointers);
  pointers.set(input.pointerId, focal);
  const press: GesturePress = {
    x: input.clientX,
    y: input.clientY,
    dragged: false,
    target: input.target,
  };
  let gesture: ActiveGesture;
  let panning: boolean | null = null;
  let captureId: number | null = null;
  if (pointers.size >= 2) {
    captureId = input.pointerId;
    const info = pairInfo(pointers);
    gesture = info ? { kind: "pinch", distance: info.distance, midpoint: info.midpoint } : session.gesture;
  } else if (input.altKey && mode.rotate) {
    gesture = { kind: "rotate", id: input.pointerId, lastAngle: pointerAngle(focal) };
  } else {
    gesture = { kind: "pan", id: input.pointerId, last: focal };
    panning = true;
  }
  return {
    session: { pointers, gesture, press, panning: panning ?? session.panning },
    focal,
    pan: null,
    zoom: null,
    rotate: null,
    captureId,
    panning,
    click: null,
    activity: true,
  };
}

export function pointerMove(
  session: GestureSession,
  input: PointerInput,
  focal: Point,
): GestureResult {
  if (!session.pointers.has(input.pointerId)) return idleResult(session, true);
  const pointers = new Map(session.pointers);
  pointers.set(input.pointerId, focal);
  const press = session.press ? { ...session.press } : null;
  let captureId: number | null = null;
  if (press && pointerMovedPastClick(input.clientX - press.x, input.clientY - press.y)) {
    press.dragged = true;
    captureId = input.pointerId;
  }
  let pan: { dx: number; dy: number } | null = null;
  let zoom: { focal: Point; factor: number } | null = null;
  let rotate: number | null = null;
  let gesture = session.gesture;
  if (gesture.kind === "pinch") {
    const info = pairInfo(pointers);
    if (info) {
      const update = pinchUpdate(
        { distance: gesture.distance, midpoint: gesture.midpoint },
        info,
      );
      zoom = { focal: info.midpoint, factor: update.factor };
      pan = { dx: update.panX, dy: update.panY };
      gesture = { kind: "pinch", distance: info.distance, midpoint: info.midpoint };
    }
  } else if (gesture.kind === "rotate" && gesture.id === input.pointerId) {
    const angle = pointerAngle(focal);
    rotate = rotationDelta(gesture.lastAngle, angle);
    gesture = { kind: "rotate", id: gesture.id, lastAngle: angle };
  } else if (gesture.kind === "pan" && gesture.id === input.pointerId) {
    pan = { dx: focal.x - gesture.last.x, dy: focal.y - gesture.last.y };
    gesture = { kind: "pan", id: gesture.id, last: focal };
  }
  return {
    session: { pointers, gesture, press, panning: session.panning },
    focal,
    pan,
    zoom,
    rotate,
    captureId,
    panning: null,
    click: null,
    activity: true,
  };
}

export function pointerUp(session: GestureSession, input: PointerInput): GestureResult {
  if (!session.pointers.has(input.pointerId)) return idleResult(session);
  const pointers = new Map(session.pointers);
  pointers.delete(input.pointerId);
  if (pointers.size === 0) {
    const dragged = session.press?.dragged ?? false;
    const click =
      !dragged && session.press && (input.button === 0 || input.pointerType !== "mouse")
        ? { target: session.press.target }
        : null;
    return {
      session: { pointers, gesture: { kind: "none" }, press: null, panning: false },
      focal: null,
      pan: null,
      zoom: null,
      rotate: null,
      captureId: null,
      panning: false,
      click,
      activity: true,
    };
  }
  if (pointers.size === 1) {
    const entry = [...pointers.entries()][0];
    if (entry) {
      return {
        session: {
          pointers,
          gesture: { kind: "pan", id: entry[0], last: entry[1] },
          press: session.press,
          panning: session.panning,
        },
        focal: null,
        pan: null,
        zoom: null,
        rotate: null,
        captureId: null,
        panning: null,
        click: null,
        activity: false,
      };
    }
  }
  return {
    session: { ...session, pointers },
    focal: null,
    pan: null,
    zoom: null,
    rotate: null,
    captureId: null,
    panning: null,
    click: null,
    activity: false,
  };
}
