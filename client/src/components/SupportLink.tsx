import type { ReactNode } from "react";
import { KOFI_URL, SUPPORT_ACCESSIBLE_NAME } from "../lib/support";

type SupportLinkProps = {
  /** Visible label. The accessible name stays the full Ko-fi phrase. */
  label?: string;
  /** Keep the visible label at narrow widths. The header button collapses to the cup. */
  keepLabel?: boolean;
};

export function SupportLink({ label = "Support", keepLabel = false }: SupportLinkProps) {
  const className = keepLabel ? "support-link support-link-text" : "support-link";
  return (
    <a
      className={className}
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={SUPPORT_ACCESSIBLE_NAME}
      title={SUPPORT_ACCESSIBLE_NAME}
    >
      <CupIcon />
      <span className="support-link-label">{label}</span>
    </a>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function CupIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <path d="M6 2v2" />
      <path d="M10 2v2" />
      <path d="M14 2v2" />
    </svg>
  );
}
