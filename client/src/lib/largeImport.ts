import { hubLeafCount } from "../../../server/src/hubLayout.ts";

/** Show the From data warning at this many nodes, or this many leaf neighbors. */
export const LARGE_IMPORT_NODES = 200;
export const LARGE_IMPORT_LEAVES = 50;

export type LargeImportAdvice = {
  nodes: number;
  message: string;
};

export function largeImportAdvice(source: string, nodeCount: number): LargeImportAdvice | null {
  const nodes = Math.max(0, nodeCount);
  const leaves = hubLeafCount(source);
  if (nodes < LARGE_IMPORT_NODES && leaves < LARGE_IMPORT_LEAVES) return null;
  const count = nodes.toLocaleString("en-US");
  const slow = `This diagram has ${count} nodes. Rendering a diagram this large can take a while.`;
  if (leaves >= LARGE_IMPORT_LEAVES) {
    return {
      nodes,
      message: `${slow} Default rank draws this hub as one long column, so the preview can shrink it until it is hard to read. Compact or Radial keeps it readable.`,
    };
  }
  return { nodes, message: slow };
}
