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
  const now = clampAria(value, min, max);
  const low = Math.round(min);
  const high = Math.round(max);
  return (
    <div
      className="editor-split"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={now}
      aria-valuemin={Math.min(low, high)}
      aria-valuemax={Math.max(low, high)}
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

function clampAria(value: number, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const next = Math.round(Number.isFinite(value) ? value : low);
  return Math.min(high, Math.max(low, next));
}
