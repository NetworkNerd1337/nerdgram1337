import type { ReactNode } from "react";
import { useContext } from "react";
import { UpdateContext } from "./updateContext";
import { formatVersionLabel } from "../lib/versionLabel";
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

/** Header About control. The version comes from the update status, not a fixed string. */
export function AboutButton() {
  const updates = useContext(UpdateContext);
  if (!updates) return null;
  const version = updates.status
    ? formatVersionLabel(updates.status.currentVersion, updates.status.codename)
    : updates.versionInfo
      ? formatVersionLabel(updates.versionInfo.version, updates.versionInfo.codename)
      : "";
  return (
    <button
      type="button"
      className="about-link"
      aria-label="About NerdGram1337"
      title={version || "About NerdGram1337"}
      onClick={updates.openAbout}
    >
      <InfoIcon />
      <span className="about-link-label">About</span>
    </button>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <path d="M12 7.5h.01" />
    </svg>
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
