export function RenderProgress({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <div className="render-progress" role="status">
      <p>{text}</p>
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
