import { describe, expect, it } from "vitest";
import { githubSyncStatusCopy } from "../src/lib/githubSyncStatus";

const base = {
  enabled: false,
  login: null,
  tokenSource: null,
  repo: null,
  error: null,
  device: null,
} as const;

describe("GitHub sync status copy", () => {
  it("describes the four setup states", () => {
    expect(githubSyncStatusCopy(base)).toEqual({
      state: "setup",
      label: "Not set up",
      detail: "",
    });
    expect(
      githubSyncStatusCopy({
        ...base,
        tokenSource: "file",
        login: "octocat",
      }).label,
    ).toBe("Signed in as @octocat");
    expect(
      githubSyncStatusCopy({
        ...base,
        enabled: true,
        login: "octocat",
        tokenSource: "file",
        repo: { owner: "octocat", name: "nerdgram-diagrams" },
      }).label,
    ).toBe("Connected to octocat/nerdgram-diagrams");
    const attention = githubSyncStatusCopy({
      ...base,
      enabled: false,
      tokenSource: "file",
      login: "octocat",
      repo: { owner: "octocat", name: "nerdgram-diagrams" },
      error: { message: "GitHub rejected the saved authorization. It may have been revoked. Connect again." },
    });
    expect(attention.state).toBe("attention");
    expect(attention.label).toBe("Needs attention");
    expect(attention.detail).toMatch(/octocat\/nerdgram-diagrams/);
    expect(attention.detail).toMatch(/Connect again/);
  });
});
