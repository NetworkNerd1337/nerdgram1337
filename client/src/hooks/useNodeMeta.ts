import { useEffect, useMemo, useState } from "react";
import { recordedSourceFile } from "../../../server/src/diagramData.ts";
import { api } from "../api";
import { metaFromSidecar, type NodeMeta } from "../lib/nodeMeta";

/**
 * Addresses and interfaces from the data file named on this diagram.
 * Empty when the diagram has no data file, or that file cannot be read.
 */
export function useNodeMeta(diagramPath: string, diagramSource: string | null): NodeMeta[] {
  const hasSource = useMemo(() => Boolean(diagramSource && recordedSourceFile(diagramSource)), [diagramSource]);
  const [meta, setMeta] = useState<NodeMeta[]>([]);
  useEffect(() => {
    if (!diagramPath || !hasSource) {
      setMeta([]);
      return;
    }
    let cancelled = false;
    void api.readDiagramSidecar(diagramPath).then(
      (payload) => {
        if (!cancelled) setMeta(metaFromSidecar(payload.content));
      },
      () => {
        if (!cancelled) setMeta([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [diagramPath, hasSource]);
  return meta;
}
