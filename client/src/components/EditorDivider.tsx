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
  /** Keyboard step. The editor split uses percent points. The sidebar uses pixels. */
  step?: number;
  className?: string;
  label?: string;
  valueText?: string;
  /**
   * When set, Home and Enter call this instead of jumping to the minimum.
   * The sidebar uses it to restore the default width.
   */
  onHome?: () => void;
};

/** Vertical separator. The editor uses it between code and preview. The shell uses it for the sidebar. */
export function EditorDivider({
  value,
  min,
  max,
  onChange,
  onReset,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  step = SPLIT_STEP,
  className,
  label = "Resize editor and preview",
  valueText,
  onHome,
}: EditorDividerProps) {
  const low = Math.round(Math.min(min, max));
  const high = Math.round(Math.max(min, max));
  const now = clampAria(value, low, high);
  const move = Number.isFinite(step) && step > 0 ? step : SPLIT_STEP;
  return (
    <div
      className={className ? `editor-split ${className}` : "editor-split"}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={now}
      aria-valuemin={low}
      aria-valuemax={high}
      aria-valuetext={valueText ?? `${now} percent`}
      aria-label={label}
      tabIndex={0}
      style={{ cursor: "col-resize" }}
      onDoubleClick={(event) => {
        event.preventDefault();
        onReset();
      }}
      onKeyDown={(event) => {
        const amount = event.shiftKey ? move * 5 : move;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          onChange(value - amount);
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          onChange(value + amount);
        } else if (event.key === "Home" || (onHome && event.key === "Enter")) {
          event.preventDefault();
          if (onHome) onHome();
          else onChange(min);
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
