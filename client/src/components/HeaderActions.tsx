import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CommandsButton } from "./CommandPalette";
import { AboutButton, SupportLink } from "./SupportLink";

/**
 * The standard page header: About, Support, Commands, then Back to dashboard
 * when this page leaves the dashboard, then any buttons that belong only here.
 */
export function HeaderActions({
  backToDashboard = false,
  className = "header-actions",
  children,
}: {
  backToDashboard?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      <AboutButton />
      <SupportLink />
      <CommandsButton />
      {backToDashboard ? (
        <Link className="btn btn-ghost" to="/">
          Back to dashboard
        </Link>
      ) : null}
      {children}
    </div>
  );
}
