import { useEffect, useMemo, useState } from "react";
import { readDataSource } from "../../../server/src/diagramData.ts";
import { api } from "../api";
import { metaFromSidecar, type NodeMeta } from "../lib/nodeMeta";

/** Addresses and interfaces from the diagram's data file. Empty when it has none. */
export function useNodeMeta(diagramSource: string | null): NodeMeta[] {
  const file = useMemo(() => (diagramSource ? readDataSource(diagramSource)?.file ?? "" : ""), [diagramSource]);
  const [meta, setMeta] = useState<NodeMeta[]>([]);
  useEffect(() => {
    if (!file) {
      setMeta([]);
      return;
    }
    let cancelled = false;
    void api.readFile(file).then(
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
  }, [file]);
  return meta;
}
