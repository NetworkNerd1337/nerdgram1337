export function NodeFindBar({
  query,
  onQuery,
  index,
  count,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (value: string) => void;
  index: number;
  count: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  return (
    <form
      className="node-find"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onStep(1);
      }}
    >
      <input
        aria-label="Find node"
        value={query}
        placeholder="Name or IP"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        autoFocus
      />
      <span className="node-find-count">{count > 0 ? `${index + 1} of ${count}` : "No matches"}</span>
      <button type="button" className="btn" aria-label="Previous node" onClick={() => onStep(-1)}>
        Previous
      </button>
      <button type="button" className="btn" aria-label="Next node" onClick={() => onStep(1)}>
        Next
      </button>
      <button type="button" className="btn" aria-label="Close node search" onClick={onClose}>
        Close
      </button>
    </form>
  );
}
