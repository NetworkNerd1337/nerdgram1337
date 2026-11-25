import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, api } from "../api";
import {
  AUTHOR_GITHUB_URL,
  AUTHOR_HANDLE,
  AUTHOR_NAME,
  AUTHOR_SITE_URL,
  DOCS_URL,
  ISSUES_URL,
  LICENSE_URL,
  REPO_URL,
} from "../lib/support";
import { requestUpdateReload } from "../lib/updateReload";
import { mermaidEngineLabel, mermaidEngineReleaseUrl } from "../lib/mermaidVersion";
import { formatVersionLabel, knownCodeName } from "../lib/versionLabel";
import type { UpdateJob, UpdateRelease, UpdateStatus, VersionInfo } from "../types";
import { Brand } from "./Brand";
import { UpgradeBlockers } from "./DataFolderExtras";
import type { DataDoctorReport } from "../types";
import { ReleaseMarkdown } from "./ReleaseMarkdown";
import { ExternalLink, SupportLink } from "./SupportLink";
import { UpdateContext, useUpdate, type CheckFeedback, type UpdatePanel } from "./updateContext";

const TARGET_KEY = "nerdgram-update-target";
const TLS_INSPECTION_DOCS_URL =
  "https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs/troubleshooting.md#corporate-tls-inspection";

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "The update request failed.";
}

function runningLabel(status: UpdateStatus): string {
  return formatVersionLabel(status.currentVersion, status.codename);
}

function releaseLabel(release: Pick<UpdateRelease, "version" | "codename">): string {
  return formatVersionLabel(release.version, release.codename);
}

function shortCommit(commit: string | null): string | null {
  if (!commit) return null;
  return commit.slice(0, 7);
}

function manualCheckMessage(next: UpdateStatus): string | null {
  if (next.error) return next.error.message;
  return null;
}

function UpdateErrorMessage({ message }: { message: string }) {
  const index = message.indexOf(TLS_INSPECTION_DOCS_URL);
  if (index < 0) return message;
  return (
    <>
      {message.slice(0, index)}
      <ExternalLink href={TLS_INSPECTION_DOCS_URL}>corporate TLS inspection</ExternalLink>
      {message.slice(index + TLS_INSPECTION_DOCS_URL.length)}
    </>
  );
}

export function UpdateHost({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [panel, setPanel] = useState<UpdatePanel>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFeedback, setCheckFeedback] = useState<CheckFeedback | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const checkSerial = useRef(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(() => document.body.dataset.presenting === "true");
  const [dockerGuide, setDockerGuide] = useState<UpdateStatus["docker"]>(null);
  const [doctorReport, setDoctorReport] = useState<DataDoctorReport | null>(null);

  useEffect(() => {
    if (panel !== "docker" && panel !== "progress") return;
    let cancelled = false;
    void api
      .doctor()
      .then((next) => {
        if (!cancelled) setDoctorReport(next);
      })
      .catch(() => {
        if (!cancelled) setDoctorReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [panel]);

  const applyStatus = useCallback((next: UpdateStatus) => {
    setStatus(next);
    const target = sessionStorage.getItem(TARGET_KEY);
    if (target && next.currentVersion === target) {
      sessionStorage.removeItem(TARGET_KEY);
      setNotice(`This install is running ${runningLabel(next)}, the release you updated to.`);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.updates();
      applyStatus(next);
      setUpdateError(null);
      return next;
    } catch (err) {
      setStatus(null);
      setUpdateError(messageOf(err));
      throw err;
    }
  }, [applyStatus]);

  const checkNow = useCallback(async (options?: { keepPanel?: boolean }) => {
    const id = checkSerial.current + 1;
    checkSerial.current = id;
    setBusy(true);
    setChecking(true);
    setActionError(null);
    setCheckFeedback(null);
    try {
      const next = await api.checkUpdates();
      applyStatus(next);
      const message = manualCheckMessage(next);
      const feedback = message ? { id, code: next.error?.code ?? null, message } : null;
      if (options?.keepPanel) {
        setCheckFeedback(feedback);
        if (next.error) setActionError(next.error.message);
        return;
      }
      if (next.updateAvailable && !next.dismissed && !next.error) {
        setCheckFeedback(null);
        setPanel(null);
        return;
      }
      setCheckFeedback(feedback);
      if (message && !next.error) setNotice(message);
      setPanel("about");
    } catch (err) {
      const message = messageOf(err);
      setCheckFeedback({ id, code: "update", message });
      setActionError(message);
      if (!options?.keepPanel) setPanel("about");
    } finally {
      setChecking(false);
      setBusy(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    void api
      .version()
      .then((info) => {
        if (!cancelled) setVersionInfo(info);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // The failure is kept in updateError. This catch only avoids an unhandled rejection.
      void refresh().catch(() => undefined);
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(load, 15 * 60 * 1000);
    let attempts = 0;
    const early = window.setInterval(() => {
      attempts += 1;
      if (cancelled || attempts > 15) {
        window.clearInterval(early);
        return;
      }
      load();
    }, 2000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
      window.clearInterval(early);
    };
  }, [refresh]);

  useEffect(() => {
    const onAbout = () => setPanel("about");
    const onCheck = () => {
      void checkNow();
    };
    window.addEventListener("nerdgram:about", onAbout);
    window.addEventListener("nerdgram:check-updates", onCheck);
    return () => {
      window.removeEventListener("nerdgram:about", onAbout);
      window.removeEventListener("nerdgram:check-updates", onCheck);
    };
  }, [checkNow]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setPresenting(document.body.dataset.presenting === "true");
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-presenting"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!job?.running) return;
    const timer = window.setInterval(() => {
      void api
        .updateJob()
        .then((payload) => {
          setJob(payload.job);
          if (payload.job?.result?.version) {
            sessionStorage.setItem(TARGET_KEY, payload.job.result.version);
          }
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [job?.running]);

  const runSettings = async (body: { automatic?: boolean; includePrerelease?: boolean; clearSkipped?: boolean }) => {
    setBusy(true);
    setActionError(null);
    try {
      applyStatus(await api.updateSettings(body));
    } catch (err) {
      setCheckFeedback(null);
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    setBusy(true);
    try {
      applyStatus(await api.laterUpdate());
      setPanel(null);
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      applyStatus(await api.skipUpdate());
      setPanel(null);
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const openUpgrade = () => {
    if (status?.latest?.version) sessionStorage.setItem(TARGET_KEY, status.latest.version);
    if (status?.installKind === "docker" && status.docker) {
      setDockerGuide(status.docker);
      setPanel("docker");
      return;
    }
    setPanel("manual");
  };

  const startApply = async () => {
    setBusy(true);
    setActionError(null);
    setPanel("progress");
    try {
      const started = await api.applyUpdate();
      setJob(started.job);
      if (status?.latest?.version) sessionStorage.setItem(TARGET_KEY, status.latest.version);
    } catch (err) {
      setJob({
        running: false,
        phase: "failed",
        lines: [messageOf(err)],
        error: { code: err instanceof ApiError ? err.code ?? "update" : "update", message: messageOf(err) },
        result: null,
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
    } catch {
      setActionError("Could not copy. Select the command and copy it yourself.");
    }
  };

  const routePresenting =
    location.pathname.startsWith("/present") || location.pathname.startsWith("/templates/present");
  const showBanner = Boolean(
    status?.updateAvailable && !status.dismissed && !status.skipped && !presenting && !routePresenting,
  );

  const value = {
    status,
    versionInfo,
    updateError,
    job,
    busy,
    checking,
    checkFeedback,
    notice,
    panel,
    actionError,
    openAbout: () => setPanel("about"),
    closePanel: () => setPanel(null),
    checkNow,
    later,
    skip,
    clearSkipped: () => runSettings({ clearSkipped: true }),
    setAutomatic: (automatic: boolean) => runSettings({ automatic }),
    setPrerelease: (includePrerelease: boolean) => runSettings({ includePrerelease }),
    openNotes: () => setPanel("notes"),
    openUpgrade,
    startApply,
    reload: requestUpdateReload,
    dismissNotice: () => setNotice(null),
  };

  return (
    <UpdateContext.Provider value={value}>
      {children}
      {notice && !showBanner ? (
        <div className="update-banner update-banner-quiet" role="status">
          <p>{notice}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {showBanner && status?.latest ? (
        <div className="update-banner" role="status">
          <p>
            This install is running <strong>{runningLabel(status)}</strong>. The latest release is{" "}
            <strong>{releaseLabel(status.latest)}</strong>.
          </p>
          <div className="update-banner-actions">
            <button type="button" className="btn" onClick={() => setPanel("notes")}>
              View release notes
            </button>
            {status.canApply ? (
              <button type="button" className="btn btn-primary" onClick={() => setPanel("progress")}>
                Update now
              </button>
            ) : null}
            {status.installKind === "docker" ? (
              <button type="button" className="btn btn-primary" onClick={openUpgrade}>
                Show upgrade steps
              </button>
            ) : null}
            {status.installKind === "zip" || status.installKind === "unknown" ? (
              <button type="button" className="btn" onClick={() => setPanel("manual")}>
                How to update
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => void later()}>
              Later
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void skip()}>
              Skip this version
            </button>
          </div>
        </div>
      ) : null}
      {panel === "about" ? (
        <Dialog title="About NerdGram1337" onClose={() => setPanel(null)}>
          <AboutBody />
        </Dialog>
      ) : null}
      {panel === "notes" && status?.latest ? (
        <Dialog title={`Release ${releaseLabel(status.latest)}`} onClose={() => setPanel(null)}>
          <p className="update-version-line">
            This install is running {runningLabel(status)}
            {shortCommit(status.commit) ? ` (${shortCommit(status.commit)})` : ""}. The latest release is{" "}
            {releaseLabel(status.latest)}.
          </p>
          <p>
            <a href={status.latest.htmlUrl} target="_blank" rel="noreferrer noopener">
              Open this release on GitHub
            </a>
          </p>
          <ReleaseMarkdown markdown={status.latest.body || "This release has no notes."} />
        </Dialog>
      ) : null}
      {panel === "docker" && dockerGuide && status ? (
        <Dialog title={`Upgrade to ${dockerGuide.tag}`} onClose={() => setPanel(null)}>
          <UpgradeBlockers report={doctorReport} />
          <p className="update-version-line">NerdGram will not change the container from the inside.</p>
          {status.latest ? <ReleaseMarkdown markdown={status.latest.body || "This release has no notes."} /> : null}
          {status.latest ? (
            <p>
              <a href={status.latest.htmlUrl} target="_blank" rel="noreferrer noopener">
                Open this release on GitHub
              </a>
            </p>
          ) : null}
          <h4>docker run</h4>
          {dockerGuide.steps.map((step) => (
            <CommandBlock key={step.title} title={step.title} command={step.command} copied={copied} onCopy={copy} />
          ))}
          <h4>Docker Compose</h4>
          <p>{dockerGuide.composeNote}</p>
          {dockerGuide.compose.map((step) => (
            <CommandBlock key={step.title} title={step.title} command={step.command} copied={copied} onCopy={copy} />
          ))}
          <p className="update-persist">{dockerGuide.persistNote}</p>
          <div className="update-banner-actions">
            <button type="button" className="btn btn-primary" disabled={busy} aria-busy={checking} onClick={() => void checkNow({ keepPanel: true })}>
              {checking ? "Checking…" : "Check again"}
            </button>
          </div>
          {checking ? (
            <p className="update-check-status" role="status">
              Checking for updates…
            </p>
          ) : null}
          {actionError ? <p className="update-error">{actionError}</p> : null}
          <p role="status">{dockerStatusLine(status, dockerGuide.tag)}</p>
        </Dialog>
      ) : null}
      {panel === "manual" && status ? (
        <Dialog title="Update by hand" onClose={() => setPanel(null)}>
          <ManualCopy status={status} />
        </Dialog>
      ) : null}
      {panel === "progress" && status ? (
        <Dialog title={job?.result ? "Restart to finish" : "Update now"} onClose={() => setPanel(null)}>
          {!job ? (
            <>
              <UpgradeBlockers report={doctorReport} />
              <p>
                Update to {status.latest ? releaseLabel(status.latest) : "the release"}? NerdGram will fetch that release, reinstall from the lockfiles,
                and rebuild. Your diagrams are not modified. The git tree has to be clean, on main or a detached
                release tag, and the release has to be a fast-forward. You will restart the app when it finishes.
              </p>
              <div className="update-banner-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !status.canApply || (doctorReport?.blockers.length ?? 0) > 0}
                  onClick={() => void startApply()}
                >
                  Update now
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                {job.phase === "done" ? "The build finished." : job.running ? "Working…" : "Stopped."}
              </p>
              <ol className="update-log" aria-live="polite">
                {job.lines.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ol>
              {job.error ? <p className="update-error">{job.error.message}</p> : null}
              {job.result ? (
                <>
                  <p>{job.result.restart.instructions}</p>
                  <div className="update-banner-actions">
                    <button type="button" className="btn btn-primary" onClick={requestUpdateReload}>
                      Reload
                    </button>
                  </div>
                </>
              ) : null}
              {!job.running && !job.result ? (
                <div className="update-banner-actions">
                  <button type="button" className="btn" onClick={() => setJob(null)}>
                    Try again
                  </button>
                </div>
              ) : null}
            </>
          )}
        </Dialog>
      ) : null}
    </UpdateContext.Provider>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <h3 id="update-dialog-title">{title}</h3>
        <div className="modal-scroll">{children}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdateSettingsFields() {
  const { status, busy, checking, setAutomatic, setPrerelease, clearSkipped, checkNow } = useUpdate();
  if (!status) return <p>Loading update settings…</p>;
  const lockedOff = !status.enabled;
  return (
    <div>
      <p>
        Version {runningLabel(status)}
        {status.commit ? ` · ${shortCommit(status.commit)}` : ""} · {installLabel(status.installKind)}
      </p>
      <label className="sync-check">
        <input
          type="checkbox"
          checked={status.automatic && status.enabled}
          disabled={busy || lockedOff}
          onChange={(event) => void setAutomatic(event.target.checked)}
        />
        <span>Check for updates automatically</span>
      </label>
      {lockedOff ? <p>NERDGRAM_UPDATE_CHECK=false turns checks off, including Check for updates.</p> : null}
      <label className="sync-check">
        <input
          type="checkbox"
          checked={status.includePrerelease}
          disabled={busy || lockedOff}
          onChange={(event) => void setPrerelease(event.target.checked)}
        />
        <span>Include prereleases</span>
      </label>
      {status.skippedVersions.length > 0 ? (
        <p>
          Skipped: {status.skippedVersions.join(", ")}{" "}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void clearSkipped()}>
            Reset skipped versions
          </button>
        </p>
      ) : null}
      <div className="update-banner-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || lockedOff}
          aria-busy={checking}
          onClick={() => void checkNow()}
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>
    </div>
  );
}

function AboutBody() {
  const { status, versionInfo, updateError, actionError, busy, checking, checkFeedback, openUpgrade } = useUpdate();
  if (!status && !versionInfo && !updateError) {
    return <p>{busy ? "Loading…" : "Version information is not available yet."}</p>;
  }
  return (
    <>
      {status ? (
        <AboutSummary
          status={status}
          actionError={actionError}
          checking={checking}
          checkFeedback={checkFeedback}
          onShowUpgrade={openUpgrade}
          upgradeDisabled={busy}
        />
      ) : (
        <AboutVersionFallback versionInfo={versionInfo} updateError={updateError} />
      )}
      {status ? <UpdateSettingsFields /> : null}
    </>
  );
}

function AboutVersionFallback({
  versionInfo,
  updateError,
}: {
  versionInfo: VersionInfo | null;
  updateError: string | null;
}) {
  const version = versionInfo?.version?.trim() ?? "";
  const versionText = version ? (version.startsWith("v") ? version : `v${version}`) : "Unknown";
  const codeName = knownCodeName(versionInfo?.codename);
  const engine = mermaidEngineLabel();
  const engineUrl = mermaidEngineReleaseUrl();
  return (
    <div className="about-summary">
      <div className="about-identity">
        <Brand />
        <p className="about-lead">
          A local Mermaid diagramming tool for network engineers. Write diagrams as text, build them from CDP/LLDP,
          routing and ARP data, import Visio and Lucidchart, and keep them in Git.
        </p>
      </div>
      <dl className="about-facts">
        <dt>Version</dt>
        <dd>
          <span className="about-version">{versionText}</span>
        </dd>
        {codeName ? (
          <>
            <dt>Code name</dt>
            <dd>{codeName}</dd>
          </>
        ) : null}
        {engine ? (
          <>
            <dt>Engine</dt>
            <dd>{engineUrl ? <ExternalLink href={engineUrl}>{engine}</ExternalLink> : engine}</dd>
          </>
        ) : null}
        {versionInfo ? (
          <>
            <dt>Install</dt>
            <dd>{installLabel(versionInfo.installKind)}</dd>
          </>
        ) : null}
        {versionInfo?.commit ? (
          <>
            <dt>Commit</dt>
            <dd>
              <code className="about-commit">{versionInfo.commit}</code>
            </dd>
          </>
        ) : null}
      </dl>
      {updateError ? <p className="about-status">Update status unavailable: {updateError}</p> : null}
    </div>
  );
}

function updateSummary(status: UpdateStatus): string | null {
  return installStatusLine(status);
}

/** Status word next to the version. Null means the check did not confirm latest or a newer release. */
export function versionStatusWord(status: UpdateStatus): "latest" | "upgrade available" | null {
  if (!status.enabled || status.phase === "disabled" || status.error) return null;
  if (status.phase === "ahead" || status.phase === "unknown" || status.phase === "no_release") return null;
  if (status.matchesLatest || status.phase === "current") return "latest";
  if (status.updateAvailable && status.latest && !status.skipped) return "upgrade available";
  return null;
}

/** One plain sentence for About, the banner, and the upgrade panel. */
export function installStatusLine(status: UpdateStatus): string | null {
  const running = runningLabel(status);
  const latest = status.latest ? releaseLabel(status.latest) : null;
  const latestKind = status.latest?.prerelease ? "prerelease" : "release";
  if (status.phase === "disabled") return "Update checks are turned off.";
  if (status.error) {
    const reach = status.error.code === "offline" || status.error.code === "tls";
    return reach
      ? `This install is running ${running}. The update check could not reach GitHub.`
      : `This install is running ${running}. The update check did not finish.`;
  }
  if (status.matchesLatest || status.phase === "current") {
    return `This install is running ${running}, the latest release.`;
  }
  if (status.updateAvailable && latest && !status.skipped) {
    return `This install is running ${running}. The latest ${latestKind} is ${latest}.`;
  }
  if (status.phase === "ahead") {
    return latest
      ? `This install is running ${running}, which is newer than the latest ${latestKind} ${latest}.`
      : `This install is running ${running}, which is newer than the latest stable release.`;
  }
  if (status.phase === "no_release") {
    return `This install is running ${running}. No stable release has been published yet.`;
  }
  if (status.skipped && latest) {
    return `This install is running ${running}. ${latest} is skipped. Reset skipped versions in About to see it again.`;
  }
  if (status.phase === "unknown") {
    return `This install is running ${running}. NerdGram has not checked for a newer release.`;
  }
  return null;
}

function dockerStatusLine(status: UpdateStatus, tag: string): string {
  const running = runningLabel(status);
  const same = status.currentVersion === tag.replace(/^v/, "");
  if (same) return `This install is running ${running}, the latest release.`;
  const name = formatVersionLabel(tag, status.latest?.tag === tag ? status.latest.codename : status.codename);
  return `This install is running ${running}. The latest release is ${name}. Recreate the container with the steps above, then check again.`;
}

export function AboutSummary({
  status,
  actionError,
  checking = false,
  checkFeedback = null,
  onShowUpgrade,
  upgradeDisabled = false,
}: {
  status: UpdateStatus;
  actionError: string | null;
  checking?: boolean;
  checkFeedback?: CheckFeedback | null;
  onShowUpgrade?: () => void;
  upgradeDisabled?: boolean;
}) {
  const summary = updateSummary(status);
  const codeName = knownCodeName(status.codename);
  const engine = mermaidEngineLabel();
  const engineUrl = mermaidEngineReleaseUrl();
  const versionWord = versionStatusWord(status);
  const versionText = status.currentVersion.trim().startsWith("v") ? status.currentVersion.trim() : `v${status.currentVersion.trim()}`;
  return (
    <div className="about-summary">
      <div className="about-identity">
        <Brand />
        <p className="about-lead">
          A local Mermaid diagramming tool for network engineers. Write diagrams as text, build them from CDP/LLDP,
          routing and ARP data, import Visio and Lucidchart, and keep them in Git.
        </p>
      </div>
      <dl className="about-facts">
        <dt>Version</dt>
        <dd>
          <span className="about-version">{versionText}</span>
          {versionWord === "latest" ? <span className="about-version-status is-latest">latest</span> : null}
          {versionWord === "upgrade available" ? (
            <button type="button" className="about-version-status is-upgrade" onClick={onShowUpgrade} disabled={!onShowUpgrade || upgradeDisabled}>
              upgrade available
            </button>
          ) : null}
        </dd>
        {codeName ? (
          <>
            <dt>Code name</dt>
            <dd>{codeName}</dd>
          </>
        ) : null}
        {engine ? (
          <>
            <dt>Engine</dt>
            <dd>{engineUrl ? <ExternalLink href={engineUrl}>{engine}</ExternalLink> : engine}</dd>
          </>
        ) : null}
        <dt>Install</dt>
        <dd>{installLabel(status.installKind)}</dd>
        {status.commit ? (
          <>
            <dt>Commit</dt>
            <dd>
              <code className="about-commit">{status.commit}</code>
            </dd>
          </>
        ) : null}
      </dl>
      {summary ? <p className="about-status">{summary}</p> : null}
      <div className="about-links">
        <p>
          <ExternalLink href={AUTHOR_SITE_URL}>{AUTHOR_NAME}</ExternalLink>
          {" ("}
          <ExternalLink href={AUTHOR_GITHUB_URL}>{AUTHOR_HANDLE}</ExternalLink>
          {"). "}
          <ExternalLink href={REPO_URL}>NerdGram1337 on GitHub</ExternalLink>
        </p>
        <p>
          <ExternalLink href={ISSUES_URL}>Report a bug or request a feature</ExternalLink>
          {" · "}
          <ExternalLink href={DOCS_URL}>Documentation</ExternalLink>
        </p>
        <p>
          <ExternalLink href={LICENSE_URL}>MIT License</ExternalLink>
          {" · © 2026 "}
          {AUTHOR_NAME}
          {" · "}
          <ExternalLink href={AUTHOR_SITE_URL}>ryanthomashuff.com</ExternalLink>
        </p>
      </div>
      <div className="about-support">
        <p>
          NerdGram1337 is free and open source, built by one developer. If it's useful to you, you can support
          continued development.
        </p>
        <SupportLink label="Support on Ko-fi" keepLabel />
      </div>
      {status.installKind === "docker" ? (
        <>
          <p>
            This is a Docker install. NerdGram does not change the container from the inside. Pull a new image and
            start it again with the same /data volume. The steps use{" "}
            <code>ghcr.io/networknerd1337/nerdgram1337</code>, container <code>nerdgram1337</code>, volume{" "}
            <code>nerdgram-data</code>, and <code>127.0.0.1:8787:8787</code>.
          </p>
          {status.docker && onShowUpgrade ? (
            <p>
              <button type="button" className="btn btn-secondary" disabled={upgradeDisabled} onClick={onShowUpgrade}>
                Show upgrade steps
              </button>
            </p>
          ) : null}
        </>
      ) : null}
      <div className="update-check-feedback" aria-live="polite">
        {checking ? (
          <p className="update-check-status" role="status">
            Checking for updates…
          </p>
        ) : checkFeedback ? (
          <p
            className={checkFeedback.code ? "update-error" : "about-status"}
            role={checkFeedback.code ? "alert" : "status"}
            data-check-id={checkFeedback.id}
          >
            <UpdateErrorMessage message={checkFeedback.message} />
          </p>
        ) : actionError ? (
          <p className="update-error" role="alert">
            <UpdateErrorMessage message={actionError} />
          </p>
        ) : status.error ? (
          <p className="update-error" role="alert">
            <UpdateErrorMessage message={status.error.message} />
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ManualCopy({ status }: { status: UpdateStatus }) {
  const latest = status.latest;
  return (
    <>
      <p>
        This install is running {runningLabel(status)}
        {latest ? `. The latest release is ${releaseLabel(latest)}.` : "."} Update now is not available for a{" "}
        {status.installKind} install.
      </p>
      {status.installKind === "zip" ? (
        <p>
          Download the new ZIP from the release page, extract it, and run <code>npm run install:all</code> from that
          folder. Copy your <code>diagrams</code> folder into it, or keep <code>NERDGRAM_DATA_DIR</code> pointed at
          the same path.
        </p>
      ) : (
        <p>
          NerdGram could not tell how this copy was installed, so it will not change files. Download the release or
          switch to a git clone, and keep your diagrams folder or <code>NERDGRAM_DATA_DIR</code>.
        </p>
      )}
      {latest ? (
        <p>
          <a href={latest.htmlUrl} target="_blank" rel="noreferrer noopener">
            Open this release on GitHub
          </a>
        </p>
      ) : null}
      {latest?.body ? <ReleaseMarkdown markdown={latest.body} /> : null}
    </>
  );
}

function CommandBlock({
  title,
  command,
  copied,
  onCopy,
}: {
  title: string;
  command: string;
  copied: string | null;
  onCopy: (command: string) => Promise<void>;
}) {
  return (
    <div className="update-command">
      <div className="update-command-head">
        <span>{title}</span>
        <button type="button" className="btn" onClick={() => void onCopy(command)}>
          {copied === command ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{command}</code>
      </pre>
    </div>
  );
}

function installLabel(kind: UpdateStatus["installKind"]): string {
  if (kind === "git") return "git clone";
  if (kind === "docker") return "Docker";
  if (kind === "zip") return "ZIP download";
  return "unknown";
}
