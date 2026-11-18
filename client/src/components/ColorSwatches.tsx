import { useState } from "react";
import { swatchColors, type WorkspaceColor } from "../lib/stylePresets";

export function ColorSwatches({
  label,
  colors,
  recent,
  current,
  disabled,
  onPick,
}: {
  label: string;
  colors: readonly WorkspaceColor[];
  recent: readonly string[];
  current: string;
  disabled: boolean;
  onPick: (color: string) => void;
}) {
  const swatches = swatchColors(colors, recent);
  const [active, setActive] = useState(0);
  if (swatches.length === 0) return null;
  const index = Math.min(active, swatches.length - 1);
  const selected = swatches[index];

  return (
    <div
      className="color-swatches"
      role="listbox"
      aria-label={`Colors for ${label}`}
      aria-activedescendant={selected ? `swatch-${label}-${selected.color}` : undefined}
    >
      {swatches.map((swatch, swatchIndex) => {
        const name =
          swatch.source === "recent"
            ? `Recent color ${swatch.color}`
            : `${swatch.color}, used on ${swatch.count} ${swatch.count === 1 ? "diagram" : "diagrams"}`;
        return (
          <button
            key={`${swatch.source}:${swatch.color}`}
            id={`swatch-${label}-${swatch.color}`}
            type="button"
            className="color-swatch"
            role="option"
            aria-selected={current.trim().toLowerCase() === swatch.color}
            aria-label={name}
            title={name}
            disabled={disabled}
            tabIndex={swatchIndex === index ? 0 : -1}
            style={{ background: swatch.color }}
            onFocus={() => setActive(swatchIndex)}
            onClick={() => onPick(swatch.color)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowUp") {
                return;
              }
              event.preventDefault();
              const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
              const next = (swatchIndex + delta + swatches.length) % swatches.length;
              setActive(next);
              const button = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".color-swatch")[next];
              button?.focus();
            }}
          />
        );
      })}
    </div>
  );
}
