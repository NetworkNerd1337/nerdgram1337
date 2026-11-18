import type { PointerEvent } from "react";
import { SPLIT_STEP } from "../lib/editorSplit";

type EditorDividerProps = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
};

/** Vertical separator between the code pane and the preview. */
export function EditorDivider({
  value,
  min,
  max,
  onChange,
  onReset,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: EditorDividerProps) {
  const low = Math.round(Math.min(min, max));
  const high = Math.round(Math.max(min, max));
  const now = clampAria(value, low, high);
  return (
    <div
      className="editor-split"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={now}
      aria-valuemin={low}
      aria-valuemax={high}
      aria-valuetext={`${now} percent`}
      aria-label="Resize editor and preview"
      tabIndex={0}
      style={{ cursor: "col-resize" }}
      onDoubleClick={(event) => {
        event.preventDefault();
        onReset();
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? SPLIT_STEP * 5 : SPLIT_STEP;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          onChange(value - step);
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          onChange(value + step);
        } else if (event.key === "Home") {
          event.preventDefault();
          onChange(min);
        } else if (event.key === "End") {
          event.preventDefault();
          onChange(max);
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

/** Whole-number ARIA value inside the already-rounded limits. */
function clampAria(value: number, low: number, high: number): number {
  const next = Math.round(Number.isFinite(value) ? value : low);
  return Math.min(high, Math.max(low, next));
}
