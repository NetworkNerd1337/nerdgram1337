import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { findingsFromLint, type DiagramCheckFinding } from "../lib/diagramChecks";
import type { UnreadableDiagram } from "../../../server/src/readError.ts";

export type DiagramLintSnapshot = {
  findings: DiagramCheckFinding[] | null;
  unreadable: UnreadableDiagram[];
  error: string | null;
  reload: () => void;
};

const DiagramLintContext = createContext<DiagramLintSnapshot | null>(null);

/**
 * One workspace check shared by Diagram checks and Needs attention.
 * A change in `revision` runs the check again, after a short wait so a bulk
 * action does not start one check per file.
 */
export function DiagramLintProvider({ revision, children }: { revision: number; children: ReactNode }) {
  const [findings, setFindings] = useState<DiagramCheckFinding[] | null>(null);
  const [unreadable, setUnreadable] = useState<UnreadableDiagram[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const delay = revision <= 1 && tick === 0 ? 0 : 300;
    const timer = window.setTimeout(() => {
      void api.diagramLint().then(
        (result) => {
          if (cancelled) return;
          setFindings(findingsFromLint(result));
          setUnreadable(result.unreadable ?? []);
          setError(null);
        },
        (err: unknown) => {
          if (cancelled) return;
          setFindings(null);
          setUnreadable([]);
          setError(err instanceof Error ? err.message : "Could not check the diagrams");
        },
      );
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [revision, tick]);

  const value: DiagramLintSnapshot = {
    findings,
    unreadable,
    error,
    reload: () => setTick((value) => value + 1),
  };
  return <DiagramLintContext.Provider value={value}>{children}</DiagramLintContext.Provider>;
}

export function useSharedDiagramLint(): DiagramLintSnapshot | null {
  return useContext(DiagramLintContext);
}
