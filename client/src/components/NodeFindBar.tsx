import { nodeFindKey } from "../lib/nodeFind";

export function NodeFindBar({
  query,
  onQuery,
  index,
  count,
  onStep,
  onClose,
  floating = false,
}: {
  query: string;
  onQuery: (value: string) => void;
  index: number;
  count: number;
  onStep: (delta: number) => void;
  onClose: () => void;
  /** Present draws the box over the diagram instead of in the column. */
  floating?: boolean;
}) {
  return (
    <form
      className={floating ? "node-find node-find-float" : "node-find"}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onStep(1);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const action = nodeFindKey(event, true);
        if (action === "ignore") return;
        event.preventDefault();
        event.stopPropagation();
        if (action === "close") onClose();
        else onStep(action === "next" ? 1 : -1);
      }}
    >
      <input
        aria-label="Find node"
        value={query}
        placeholder="Name or IP"
        onChange={(event) => onQuery(event.target.value)}
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
