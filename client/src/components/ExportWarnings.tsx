type ExportNotice = {
  title: string;
  items: readonly string[];
};

/** Dismissible note for warnings that came back with a lab or automation download. */
export function ExportWarnings({
  notice,
  onDismiss,
}: {
  notice: ExportNotice | null;
  onDismiss: () => void;
}) {
  if (!notice) return null;
  return (
    <div className="editor-banner export-warnings" role="status">
      <strong>{notice.title}</strong>
      <ul>
        {notice.items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
      <div className="editor-banner-actions">
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
