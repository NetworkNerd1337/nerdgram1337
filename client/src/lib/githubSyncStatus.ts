export type GithubSyncStatusInput = {
  enabled: boolean;
  login: string | null;
  tokenSource: "env" | "file" | null;
  repo: { owner: string; name: string } | null;
  error: { message: string } | null;
  device: unknown | null;
};

export type GithubSyncStatusCopy = {
  state: "attention" | "connected" | "signed-in" | "setup";
  label: string;
  detail: string;
};

/** Plain-language status for the Settings GitHub section. */
export function githubSyncStatusCopy(status: GithubSyncStatusInput): GithubSyncStatusCopy {
  if (status.error) {
    const repo = status.repo ? `${status.repo.owner}/${status.repo.name}. ` : "";
    return {
      state: "attention",
      label: "Needs attention",
      detail: `${repo}${status.error.message}`,
    };
  }
  if (status.enabled && status.repo) {
    return {
      state: "connected",
      label: `Connected to ${status.repo.owner}/${status.repo.name}`,
      detail: "",
    };
  }
  if (status.tokenSource) {
    return {
      state: "signed-in",
      label: status.login ? `Signed in as @${status.login}` : "Signed in",
      detail: "",
    };
  }
  return {
    state: "setup",
    label: "Not set up",
    detail: status.device ? "Enter the code on GitHub to finish signing in." : "",
  };
}
