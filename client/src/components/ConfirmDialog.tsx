import { useEffect, useId, useRef, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions use the danger button. Reload stays a normal confirm. */
  danger?: boolean;
};

type ConfirmDialogProps = ConfirmOptions & {
  onConfirm: () => void;
  onCancel: () => void;
};

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

/**
 * Themed confirm. Escape cancels, Enter confirms, and Tab stays inside.
 * Cancel stays a cancel when it is the focused control.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef(onConfirm);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    confirmRef.current = onConfirm;
    cancelRef.current = onCancel;
  });

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-confirm-cancel]")) cancelRef.current();
        else confirmRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      const next =
        index < 0
          ? event.shiftKey
            ? items[items.length - 1]
            : items[0]
          : items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length];
      next?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    root.querySelector<HTMLElement>("[data-confirm-accept]")?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onClick={() => cancelRef.current()}>
      <form
        ref={dialogRef}
        className="modal confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          confirmRef.current();
        }}
      >
        <h3 id={titleId}>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" data-confirm-cancel="" onClick={() => cancelRef.current()}>
            {cancelLabel}
          </button>
          <button type="submit" className={danger ? "btn btn-danger" : "btn btn-primary"} data-confirm-accept="">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
