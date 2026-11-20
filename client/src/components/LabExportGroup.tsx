import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { ExportFormat } from "../lib/exportDiagram";

export type LabExporter = {
  id: string;
  name: string;
  description: string;
};

export const LAB_EXPORT_HINT_ID = "lab-export-hint";

export const LAB_EXPORT_HINT = "Needs network data. Generate the diagram from data to enable.";

/** The Export as group for installed design exporters. Entries are disabled when the diagram has no network JSON. */
export function LabExportGroup({
  exporters,
  enabled,
}: {
  exporters: readonly LabExporter[];
  enabled: boolean;
}) {
  if (exporters.length === 0) return null;
  return (
    <optgroup label="Lab and automation">
      {enabled ? null : (
        <option value="unavailable" disabled>
          {LAB_EXPORT_HINT}
        </option>
      )}
      {exporters.map((item) => (
        <option
          key={item.id}
          value={enabled ? `lab:${item.id}` : `unavailable:${item.id}`}
          disabled={!enabled}
          title={enabled ? item.description : LAB_EXPORT_HINT}
        >
          {item.name}
        </option>
      ))}
    </optgroup>
  );
}

/** Visible explanation under Export as. A native select cannot hold the link. */
export function LabExportHint({
  enabled,
  exporterCount,
  onOpenGenerate,
}: {
  enabled: boolean;
  exporterCount: number;
  onOpenGenerate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (enabled || exporterCount === 0) return null;
  return (
    <p id={LAB_EXPORT_HINT_ID} className="export-hint">
      Needs network data.{" "}
      <Link to="/generate" onClick={onOpenGenerate}>
        Generate the diagram from data
      </Link>{" "}
      to enable.
    </p>
  );
}

export function ExportFormatMenu({
  exporters,
  enabled,
  onImage,
  onLab,
  onOpenGenerate,
}: {
  exporters: readonly LabExporter[];
  enabled: boolean;
  onImage: (format: ExportFormat, transparent?: boolean) => void;
  onLab: (id: string) => void;
  onOpenGenerate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const locked = !enabled && exporters.length > 0;
  return (
    <div className="export-menu">
      <label className="export-label">
        Export as
        <select
          aria-label="Export format"
          aria-describedby={locked ? LAB_EXPORT_HINT_ID : undefined}
          defaultValue=""
          onChange={(event) => {
            const value = event.target.value;
            event.target.value = "";
            if (value === "png-transparent") {
              onImage("png", true);
            } else if (value === "svg" || value === "png" || value === "jpg" || value === "pdf") {
              onImage(value);
            } else if (value.startsWith("lab:")) {
              const id = value.slice(4);
              if (id) onLab(id);
            }
          }}
        >
          <option value="" disabled>
            Choose…
          </option>
          <option value="svg">SVG</option>
          <option value="png">PNG</option>
          <option value="png-transparent">PNG (transparent)</option>
          <option value="jpg">JPG</option>
          <option value="pdf">PDF</option>
          <LabExportGroup exporters={exporters} enabled={enabled} />
        </select>
      </label>
      <LabExportHint enabled={enabled} exporterCount={exporters.length} onOpenGenerate={onOpenGenerate} />
    </div>
  );
}
