import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError, api } from "../api";
import { Brand } from "../components/Brand";
import { CommandsButton } from "../components/CommandPalette";
import { SupportLink } from "../components/SupportLink";
import { useCommandHost } from "../components/commandPaletteContext";
import { usePageTitle } from "../hooks/usePageTitle";
import { pageTitle } from "../lib/pageTitle";
import { Modal } from "../components/Modal";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { StylePresetsSettings } from "../components/StylePresetsSettings";
import { DiagramFolderSettings } from "../components/DiagramFolderSettings";
import { HostSettings } from "../components/HostSettings";
import { InstanceSettings } from "../components/InstanceSettings";
import { BookmarkManager } from "../components/BookmarkManager";
import { LintSettings } from "../components/LintSettings";
import { TokenSettings } from "../components/TokenSettings";
import { UpdateSettingsFields } from "../components/UpdateHost";
import type { SyncStatus } from "../types";
import { githubSyncStatusCopy } from "../lib/githubSyncStatus";

const DOCS = "https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs/github-sync.md";

function formatWhen(iso: string | null): string {
  if (!iso) return "Not yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "GitHub sync failed";
}

export function SettingsPage() {
  usePageTitle(pageTitle("Settings"));
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [repoName, setRepoName] = useState("nerdgram-diagrams");
  const [isPrivate, setIsPrivate] = useState(true);
  const [confirmNonEmpty, setConfirmNonEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  useCommandHost({
    route: "other",
    actions: {},
    items: [],
    trashItems: [],
    hasPreview: false,
    autoUpdate: false,
    readOnly: false,
    conflictOpen: false,
  });

  const refresh = async () => {
    try {
      const next = await api.syncStatus();
      setStatus(next);
      setClientId((current) => current || next.clientId || "");
      if (next.error) setError(next.error.message);
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const location = useLocation();

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const id = location.hash.replace(/^#/, "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [location.hash]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(messageOf(err));
      if (err instanceof ApiError && err.code === "repo_not_empty") setConfirmNonEmpty(false);
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const docs = status?.docsUrl || status?.error?.docsUrl || DOCS;
  const idleSeconds = Math.round((status?.idleMs ?? 20_000) / 1000);
  const needsConfirm = error?.includes("already has commits") || confirmNonEmpty;
  const syncCopy = status ? githubSyncStatusCopy(status) : null;

  return (
    <div className="reference-layout settings-screen">
      <header className="reference-top">
        <div className="reference-top-left">
          <Link to="/">
            <Brand compact />
          </Link>
          <div>
            <h1>Settings</h1>
            <p className="reference-meta">
              Appearance, style presets, GitHub sync, the listen host, the diagram folder, the instance name, automation tokens, and diagram checks.
            </p>
            <nav className="settings-nav" aria-label="Settings sections">
              <a href="#appearance">Appearance</a>
              <a href="#style-presets">Style presets</a>
              <a href="#github-sync">GitHub sync</a>
              <a href="#host">Host</a>
              <a href="#diagram-folder">Diagram folder</a>
              <a href="#instance">Instance name</a>
              <a href="#tokens">Automation tokens</a>
              <a href="#diagram-checks">Diagram checks</a>
              <a href="#bookmarks">Bookmarks</a>
              <a href="#app-updates">App updates</a>
            </nav>
          </div>
        </div>
        <div className="reference-top-actions">
          <SupportLink />
          <CommandsButton />
          <Link className="btn btn-ghost" to="/">
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="sync-page">
        <AppearanceSettings />
        <StylePresetsSettings />
        <section className="sync-card" id="github-sync">
          <h2>GitHub sync</h2>
          <p>
            GitHub sync keeps a private repository you own as a backup of the diagrams on this
            computer. You keep editing the local copies.
          </p>
          {syncCopy ? (
            <p className="sync-status" data-state={syncCopy.state} data-testid="github-sync-status">
              <span className="sync-status-label">{syncCopy.label}</span>
              {syncCopy.detail ? <span>{syncCopy.detail}</span> : null}
            </p>
          ) : null}
          {status?.clientId ? (
            <p>
              Saved client ID: <code>{status.clientId}</code>. This is not a secret.
              {status.clientIdSource === "env"
                ? " It comes from NERDGRAM_GITHUB_CLIENT_ID."
                : " No client secret is needed."}
            </p>
          ) : (
            <p>No client secret is needed. NerdGram does not ship one, and this page does not ask for one.</p>
          )}
          {!status?.tokenSource && !status?.device ? (
            <>
              <ol className="sync-steps">
                <li>
                  Create an OAuth app. Use{" "}
                  <a href="https://github.com/settings/applications/new">GitHub's new OAuth app page</a>.
                  Homepage URL and callback URL can both be <code>http://127.0.0.1:8787</code>.
                </li>
                <li>Turn on Device Flow.</li>
                <li>
                  Uncheck <strong>Expire user access tokens</strong>. GitHub turns this on for a new app.
                  Leave it unchecked so the sign-in does not expire after about 8 hours. If you leave it
                  on, NerdGram refreshes a Device Flow sign-in. If it cannot refresh, connect again.
                </li>
                <li>Paste the Client ID below.</li>
              </ol>
              <p>
                <a href={docs}>Full setup steps</a>
              </p>
              <label htmlFor="github-client-id">Client ID</label>
              <input
                id="github-client-id"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste the Client ID from your OAuth app"
              />
              <p>Leave the box empty and save to clear a client ID stored on this computer.</p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || (clientId.trim().length > 0 && clientId.trim().length < 8)}
                  onClick={() =>
                    void run(async () => {
                      const trimmed = clientId.trim();
                      const next = await api.saveGithubClientId(trimmed);
                      setClientId(trimmed);
                      setNotice(
                        trimmed
                          ? "Client ID saved on this computer."
                          : next.clientIdSource === "env"
                            ? "The saved client ID was cleared. NERDGRAM_GITHUB_CLIENT_ID is still set."
                            : "Client ID cleared.",
                      );
                    })
                  }
                >
                  Save client ID
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || clientId.trim().length < 8}
                  onClick={() =>
                    void run(async () => {
                      await api.saveGithubClientId(clientId.trim());
                      await api.startGithubDevice();
                    })
                  }
                >
                  Connect to GitHub
                </button>
              </div>
            </>
          ) : null}
          <p>
            Typing is saved locally right away. GitHub commits wait until the workspace has been idle
            for {idleSeconds} seconds, so autosave does not create a commit per keystroke. Renames,
            moves, deletes, and imports commit after about a second. Favorites, trash, history,
            thumbnails, and the token stay on this computer.
          </p>
        </section>

        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className="status-banner">{notice}</div> : null}

        {status?.device ? (
          <section className="sync-card">
            <h2>Confirm on GitHub</h2>
            <p>
              Open <a href={status.device.verificationUri}>{status.device.verificationUri}</a> and
              enter this code. NerdGram never sends the code to the page as a token.
            </p>
            <p className="sync-code">{status.device.userCode}</p>
          </section>
        ) : null}

        {status?.tokenSource && !status.enabled ? (
          <section className="sync-card">
            <h2>Create the repository</h2>
            <p>
              {status.login ? `Signed in as ${status.login}. ` : ""}
              {status.tokenSource === "env"
                ? "The access token comes from NERDGRAM_GITHUB_TOKEN and is not written to disk."
                : "The access token is stored on this computer and is not shown here."}
            </p>
            <label htmlFor="github-repo-name">Repository name</label>
            <input
              id="github-repo-name"
              value={repoName}
              onChange={(event) => setRepoName(event.target.value)}
              spellCheck={false}
            />
            <label className="sync-check">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />
              Private repository
            </label>
            {needsConfirm ? (
              <label className="sync-check">
                <input
                  type="checkbox"
                  checked={confirmNonEmpty}
                  onChange={(event) => setConfirmNonEmpty(event.target.checked)}
                />
                This repository already has commits. Add my diagrams as new commits on top.
                Do not erase the existing history and do not force-push.
              </label>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || (needsConfirm && !confirmNonEmpty)}
                onClick={() =>
                  void run(async () => {
                    await api.connectGithub({
                      name: repoName.trim() || "nerdgram-diagrams",
                      private: isPrivate,
                      confirmNonEmpty,
                    });
                    setNotice("GitHub sync is on. The first copy has been pushed.");
                    setConfirmNonEmpty(false);
                  })
                }
              >
                Create repository and sync
              </button>
            </div>
          </section>
        ) : null}

        {status?.enabled ? (
          <section className="sync-card">
            <h2>Status</h2>
            <dl className="sync-grid">
              <div>
                <dt>Account</dt>
                <dd>{status.login ?? "Connected"}</dd>
              </div>
              <div>
                <dt>Repository</dt>
                <dd>
                  {status.repo ? (
                    <a href={status.repo.htmlUrl}>{status.repo.htmlUrl}</a>
                  ) : (
                    "Not set"
                  )}
                </dd>
              </div>
              <div>
                <dt>Last sync</dt>
                <dd>{formatWhen(status.lastSyncAt)}</dd>
              </div>
              <div>
                <dt>Pending</dt>
                <dd>{status.pending ? "Yes, waiting to push" : "No"}</dd>
              </div>
            </dl>
            {status.behind > 0 || status.error?.code === "not_fast_forward" ? (
              <p>
                GitHub has commits that are not on this computer. NerdGram will not force-push.
                Pull when you want to bring those commits into the local folder.
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await api.syncNow();
                    setNotice(next.error ? next.error.message : "Sync finished.");
                    if (next.error) setError(next.error.message);
                  })
                }
              >
                Sync now
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await api.pullGithub();
                    setNotice(
                      next.conflicts.length > 0
                        ? "GitHub changes overlap local edits. Choose which copy to keep."
                        : "Pulled GitHub changes into the local folder.",
                    );
                  })
                }
              >
                Pull
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setDisconnectOpen(true)}>
                Disconnect
              </button>
            </div>
          </section>
        ) : null}

        {status && status.conflicts.length > 0 ? (
          <section className="sync-card">
            <h2>Conflicts</h2>
            <p>Nothing is overwritten until you choose. An open editor is left as it is.</p>
            {status.conflicts.map((conflict) => (
              <article key={conflict.path} className="sync-conflict">
                <h3>{conflict.path}</h3>
                <p>
                  {conflict.locked
                    ? "This diagram is open in an editor. Close it before using the GitHub copy."
                    : conflict.reason === "remote_deleted"
                      ? "GitHub deleted this diagram and the local copy also changed."
                      : "Both copies changed."}
                </p>
                <div className="compare-grid">
                  <div>
                    <strong>On this computer</strong>
                    <pre>{conflict.localPreview ?? "Deleted locally"}</pre>
                  </div>
                  <div>
                    <strong>On GitHub</strong>
                    <pre>{conflict.remotePreview ?? "Deleted on GitHub"}</pre>
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.resolveGithub([{ path: conflict.path, choice: "local" }]);
                      })
                    }
                  >
                    Keep local
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || conflict.remotePreview == null}
                    onClick={() =>
                      void run(async () => {
                        await api.resolveGithub([{ path: conflict.path, choice: "both" }]);
                      })
                    }
                  >
                    Keep both
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || conflict.locked}
                    onClick={() =>
                      void run(async () => {
                        await api.resolveGithub([{ path: conflict.path, choice: "remote" }]);
                      })
                    }
                  >
                    Use GitHub copy
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : null}
        <HostSettings />
        <DiagramFolderSettings githubSync={status?.enabled === true} />
        <InstanceSettings />
        <TokenSettings />
        <LintSettings />
        <BookmarkManager />
        <section className="sync-card" id="app-updates">
          <h2>App updates</h2>
          <p>
            Version checks are separate from GitHub sync. The sync token is not used. The server
            asks the public GitHub releases API whether a newer stable version of NerdGram exists.
          </p>
          <UpdateSettingsFields />
        </section>
      </main>

      {disconnectOpen ? (
        <Modal
          title="Disconnect GitHub sync?"
          confirmLabel="Disconnect"
          onClose={() => setDisconnectOpen(false)}
          onConfirm={() => {
            setDisconnectOpen(false);
            void run(async () => {
              const result = await api.disableGithub(true);
              const revoke = result.grantRevoked
                ? " The GitHub grant was revoked."
                : result.revokeUrl
                  ? ` Revoke the app any time at ${result.revokeUrl}.`
                  : "";
              setNotice(
                `Disconnected. The local mirror and saved authorization on this computer were removed. The GitHub repository stays in your account. Your diagrams stay in the local folder.${revoke}`,
              );
            });
          }}
        >
          <p>
            NerdGram will delete the local mirror and the saved authorization on this computer.
            The GitHub repository stays in your account. Your diagrams in the local folder stay
            put. This does not delete the OAuth app you created.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
