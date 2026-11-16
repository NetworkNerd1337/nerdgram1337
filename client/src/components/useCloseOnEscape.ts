import { useEffect } from "react";

/** Escape closes a dialog even when focus is still on the control that opened it. */
export function useCloseOnEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
