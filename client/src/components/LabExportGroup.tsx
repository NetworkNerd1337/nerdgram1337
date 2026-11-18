export type LabExporter = {
  id: string;
  name: string;
  description: string;
};

/** The Export as group for installed design exporters. Render it only when the diagram has network JSON. */
export function LabExportGroup({ exporters }: { exporters: readonly LabExporter[] }) {
  if (exporters.length === 0) return null;
  return (
    <optgroup label="Lab and automation">
      {exporters.map((item) => (
        <option key={item.id} value={`lab:${item.id}`} title={item.description}>
          {item.name}
        </option>
      ))}
    </optgroup>
  );
}
