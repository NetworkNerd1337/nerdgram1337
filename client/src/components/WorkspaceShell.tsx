import type { CSSProperties, ReactNode } from "react";
import type { useSidebarWidth } from "../hooks/useSidebarWidth";
import { SIDEBAR_STEP } from "../lib/sidebarWidth";
import { EditorDivider } from "./EditorDivider";
import { AboutButton, SupportLink } from "./SupportLink";

type SidebarWidth = ReturnType<typeof useSidebarWidth>;

/**
 * Sidebar, the 8px resize column, then the page.
 * `.app-shell` is a three-column grid. A page that omits the divider
 * drops its main region into the 8px track.
 */
export function WorkspaceShell({
  sidebar,
  width,
  children,
}: {
  sidebar: ReactNode;
  width: SidebarWidth;
  children: ReactNode;
}) {
  return (
    <div className="app-shell" style={{ "--sidebar-width": `${width.width}px` } as CSSProperties}>
      {sidebar}
      <EditorDivider
        className="app-split"
        label="Resize sidebar"
        value={width.width}
        min={width.bounds.min}
        max={width.bounds.max}
        step={SIDEBAR_STEP}
        valueText={`${Math.round(width.width)} pixels`}
        onChange={width.onChange}
        onReset={width.onReset}
        onHome={width.onReset}
        onPointerDown={width.onPointerDown}
        onPointerMove={width.onPointerMove}
        onPointerUp={width.onPointerUp}
      />
      {children}
      <div className="narrow-app-bar">
        <AboutButton />
        <SupportLink />
      </div>
    </div>
  );
}
