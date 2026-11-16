import { describe, expect, it } from "vitest";
import { wheelGesture } from "../src/lib/presentationKeys";
import {
  emptyGestureSession,
  focalFromClient,
  pointerDown,
  pointerMove,
  pointerUp,
  viewFromWheel,
  wheelFocal,
  type PointerInput,
} from "../src/lib/viewGestures";
import { fit, identityView, screenToContent, type Size } from "../src/lib/viewTransform";

const stage = { left: 100, top: 50, width: 400, height: 300 };

function pointer(partial: Partial<PointerInput> & Pick<PointerInput, "clientX" | "clientY">): PointerInput {
  return {
    pointerId: 1,
    button: 0,
    pointerType: "mouse",
    altKey: false,
    target: null,
    ...partial,
  };
}

describe("view gestures", () => {
  it("pans by the pointer delta and treats a short move as a click", () => {
    const origin = focalFromClient(120, 80, stage);
    const down = pointerDown(emptyGestureSession(), pointer({ clientX: 120, clientY: 80 }), origin, {
      rotate: true,
    });
    expect(down.session.gesture.kind).toBe("pan");
    expect(down.panning).toBe(true);
    expect(down.session.press?.dragged).toBe(false);

    const nudged = pointerMove(down.session, pointer({ clientX: 124, clientY: 82 }), focalFromClient(124, 82, stage));
    expect(nudged.session.press?.dragged).toBe(false);
    expect(nudged.pan).toEqual({ dx: 4, dy: 2 });
    expect(pointerUp(nudged.session, pointer({ clientX: 124, clientY: 82 })).click).toEqual({ target: null });

    const dragged = pointerMove(down.session, pointer({ clientX: 180, clientY: 80 }), focalFromClient(180, 80, stage));
    expect(dragged.session.press?.dragged).toBe(true);
    expect(dragged.captureId).toBe(1);
    expect(dragged.pan).toEqual({ dx: 60, dy: 0 });
    expect(pointerUp(dragged.session, pointer({ clientX: 180, clientY: 80 })).click).toBeNull();
  });

  it("zooms a mouse wheel around the pointer and pans a trackpad scroll", () => {
    const focal = { x: 80, y: -30 };
    const start = identityView();
    const zoomed = viewFromWheel(
      start,
      focal,
      wheelGesture({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, metaKey: false }),
    );
    expect(zoomed.scale).toBeLessThan(1);
    const before = screenToContent(start, focal);
    const after = screenToContent(zoomed, focal);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);

    const panned = viewFromWheel(
      start,
      focal,
      wheelGesture({ deltaX: 12, deltaY: 4.5, deltaMode: 0, ctrlKey: false, metaKey: false }),
    );
    expect(panned).toMatchObject({ x: -12, y: -4.5, scale: 1 });
    expect(wheelFocal(10, 10, null, focal)).toEqual(focal);
  });

  it("rotates on alt+drag only when rotation is enabled, and pinches with two pointers", () => {
    const focal = focalFromClient(200, 200, stage);
    const down = pointerDown(emptyGestureSession(), pointer({ clientX: 200, clientY: 200, altKey: true }), focal, {
      rotate: true,
    });
    expect(down.session.gesture.kind).toBe("rotate");
    const preview = pointerDown(
      emptyGestureSession(),
      pointer({ clientX: 200, clientY: 200, altKey: true }),
      focal,
      { rotate: false },
    );
    expect(preview.session.gesture.kind).toBe("pan");

    const second = pointerDown(
      down.session,
      pointer({ pointerId: 2, clientX: 260, clientY: 200 }),
      focalFromClient(260, 200, stage),
      { rotate: true },
    );
    expect(second.session.gesture.kind).toBe("pinch");
    expect(second.captureId).toBe(2);
    const moved = pointerMove(
      second.session,
      pointer({ pointerId: 2, clientX: 320, clientY: 200 }),
      focalFromClient(320, 200, stage),
    );
    expect(moved.zoom?.factor).toBeGreaterThan(1);
    expect(moved.pan).not.toBeNull();
  });

  it("does not reset a fitted preview just because the same picture is measured again", () => {
    const viewport: Size = { width: 800, height: 600 };
    const content: Size = { width: 400, height: 200 };
    const fitted = fit(viewport, content, 0);
    const again = viewFromWheel(fitted, { x: 0, y: 0 }, { type: "zoom", factor: 1 });
    expect(again.scale).toBeCloseTo(fitted.scale);
    expect(again.x).toBeCloseTo(fitted.x);
    expect(again.y).toBeCloseTo(fitted.y);
  });
});
