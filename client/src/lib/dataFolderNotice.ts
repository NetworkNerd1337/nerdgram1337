import type { DataHealthIssue } from "../types";

const DISMISS_KEY = "nerdgram.dataFolder.dismissed";

export function problemIssues(issues: readonly DataHealthIssue[]): DataHealthIssue[] {
  return issues.filter((issue) => issue.severity !== "info");
}

export function infoIssues(issues: readonly DataHealthIssue[]): DataHealthIssue[] {
  return issues.filter((issue) => issue.severity === "info");
}

/** Stable identity of the real problems. Info notes are not part of it. */
export function problemSignature(issues: readonly DataHealthIssue[]): string {
  return problemIssues(issues)
    .map((issue) => `${issue.code}\t${issue.file ?? ""}\t${issue.message}`)
    .sort()
    .join("\n");
}

export function isDataFolderDismissed(store: Storage, signature: string): boolean {
  if (!signature) return false;
  try {
    return store.getItem(DISMISS_KEY) === signature;
  } catch {
    return false;
  }
}

export function dismissDataFolder(store: Storage, signature: string): void {
  if (!signature) return;
  try {
    store.setItem(DISMISS_KEY, signature);
  } catch {
    // A private window can refuse storage. The banner stays until the next load.
  }
}
