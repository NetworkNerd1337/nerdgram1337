import type { DiagramCardHealth } from "../lib/diagramCardHealth";

/** Pill for lint errors or unmuted warnings. A parse error keeps the thumbnail pill instead. */
export function DiagramHealthBadge({
  health,
  thumbnailShowsParseError = false,
}: {
  health: DiagramCardHealth;
  thumbnailShowsParseError?: boolean;
}) {
  if (health.tone === "none" || !health.label || thumbnailShowsParseError) return null;
  const warning = health.tone === "warning";
  const name = health.title ?? health.label;
  return (
    <span className={`thumb-badge diagram-card-health${warning ? " is-warning" : ""}`} title={name} aria-label={name}>
      {health.label}
    </span>
  );
}
