import { useId, type FormEvent, type ReactNode } from "react";
import { useCloseOnEscape } from "./useCloseOnEscape";

type ModalProps = {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  onClose: () => void;
  onConfirm: () => void;
};

export function Modal({
  title,
  children,
  confirmLabel = "Save",
  className,
  onClose,
  onConfirm,
}: ModalProps) {
  const titleId = useId();
  useCloseOnEscape(onClose);
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onConfirm();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className={className ? `modal ${className}` : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h3 id={titleId}>{title}</h3>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
