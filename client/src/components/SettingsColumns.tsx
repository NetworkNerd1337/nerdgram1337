import { useLayoutEffect, useRef, type ReactNode } from "react";
import { packSettingsColumns } from "../lib/settingsColumns";

const WIDE_QUERY = "(min-width: 1100px)";

function gapPixels(): number {
  const font = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(font) && font > 0 ? font : 16;
}

function writeStyle(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
}

function clearPlacement(root: HTMLElement, cards: readonly HTMLElement[]): void {
  root.style.removeProperty("height");
  for (const card of cards) {
    card.style.removeProperty("position");
    card.style.removeProperty("top");
    card.style.removeProperty("left");
    card.style.removeProperty("width");
  }
}

/**
 * On a wide window, place the direct card children in two columns whose
 * heights stay close. Narrow windows keep source order in one column.
 * Cards stay in the DOM, so anchors and the scroll-spy still find them.
 */
export function SettingsColumns({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === "undefined" || typeof window.matchMedia !== "function") return;

    const placed = { heights: [] as number[] };

    const apply = () => {
      const cards = [...root.querySelectorAll<HTMLElement>(":scope > .sync-card")];
      const wide = window.matchMedia(WIDE_QUERY).matches;
      if (!wide || cards.length === 0) {
        clearPlacement(root, cards);
        placed.heights = [];
        return;
      }
      const gap = gapPixels();
      const width = `calc(50% - ${gap / 2}px)`;
      const right = `calc(50% + ${gap / 2}px)`;
      for (const card of cards) {
        writeStyle(card, "position", "absolute");
        writeStyle(card, "width", width);
      }
      const heights = cards.map((card) => card.offsetHeight);
      if (heights.every((height) => height === 0)) return;
      if (
        placed.heights.length === heights.length &&
        heights.every((height, index) => Math.abs(height - (placed.heights[index] ?? 0)) < 2)
      ) {
        return;
      }
      const columns = packSettingsColumns(heights, gap);
      const top = [0, 0];
      cards.forEach((card, index) => {
        const column = columns[index] ?? 0;
        writeStyle(card, "top", `${top[column]}px`);
        writeStyle(card, "left", column === 0 ? "0px" : right);
        top[column] += heights[index] + gap;
      });
      writeStyle(root, "height", `${Math.max(top[0], top[1]) - gap}px`);
      placed.heights = heights;
    };

    apply();
    const observer = new ResizeObserver(() => apply());
    observer.observe(root);
    for (const card of root.querySelectorAll<HTMLElement>(":scope > .sync-card")) observer.observe(card);
    const media = window.matchMedia(WIDE_QUERY);
    media.addEventListener("change", apply);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", apply);
    };
  }, []);

  return (
    <div className="settings-columns" ref={ref}>
      {children}
    </div>
  );
}
