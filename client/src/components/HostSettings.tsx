import { useEffect, useState } from "react";
import { api, type ListenHostStatus } from "../api";

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not save the host";
}

function listeningLabel(hosts: readonly string[]): string {
  if (hosts.length === 0) return "127.0.0.1 and ::1";
  return hosts.join(", ");
}

export function HostSettings() {
  const [status, setStatus] = useState<ListenHostStatus | null>(null);
  const [draft, setDraft] = useState("127.0.0.1");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .listenHost()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setDraft(next.saved);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const readOnly = status?.readOnly === true;
  const showRestart = status?.restartNotice === true;

  return (
    <section className="sync-card" id="host">
      <h2>Host</h2>
      <p>
        This address is where NerdGram listens after the next start, and it is the{" "}
        <code>Host</code> name LAN callers may use. <code>127.0.0.1</code> is the default and
        keeps today's loopback bind: <code>127.0.0.1</code> and <code>::1</code>. A machine IP
        listens on that interface only. <code>0.0.0.0</code> listens on every IPv4 interface, and{" "}
        <code>::</code> listens on every IPv6 interface. Loopback names stay allowed. Names in{" "}
        <code>NERDGRAM_ALLOWED_HOSTS</code> are merged in. NerdGram does not restart itself.
      </p>
      <p>
        When <code>HOST</code> is set in the environment, it wins over this saved value. Inside
        Docker the image sets <code>HOST=0.0.0.0</code>, so this box cannot change the bind.
        Other machines reach the container only through the published port.
      </p>
      {status?.invalid ? (
        <div className="error-banner">
          The saved host file is not a valid address. NerdGram is using the default loopback bind until you save a new value.
        </div>
      ) : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="status-banner">{notice}</div> : null}
      {status?.envOverrides ? (
        <div className="host-override" role="status">
          <code>HOST</code> is set to <code>{status.envHost}</code> and overrides the saved
          setting. The process listens on {listeningLabel(status.effectiveHosts)}. Unset{" "}
          <code>HOST</code> and start NerdGram again to use the saved value.
        </div>
      ) : null}
      {status?.docker ? (
        <p>
          This install is Docker, so the Host box is read-only. Publish{" "}
          <code>127.0.0.1:8787:8787</code> to keep the tool port on the host loopback, or publish{" "}
          <code>&lt;lan-ip&gt;:8787:8787</code> to reach it on that address. The container does
          not see the host's LAN addresses. Set <code>NERDGRAM_ALLOWED_HOSTS</code> to the
          address callers put in the URL, or those calls get <strong>403</strong>. Browser
          changes from another origin also need <code>NERDGRAM_CORS_ORIGINS</code>.
        </p>
      ) : null}
      <label htmlFor="listen-host">Host</label>
      <input
        id="listen-host"
        value={draft}
        disabled={readOnly || busy || status == null}
        onChange={(event) => setDraft(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="127.0.0.1"
        aria-describedby="listen-host-help"
      />
      <p id="listen-host-help">
        IPv4, IPv6, <code>0.0.0.0</code>, or <code>::</code>. A hostname is not accepted. Use{" "}
        <code>NERDGRAM_ALLOWED_HOSTS</code> for a DNS name.
        {status ? ` Listening now on ${listeningLabel(status.effectiveHosts)}.` : ""}
        {status && status.acceptedHosts.length > 0
          ? ` Callers may use ${status.acceptedHosts.join(", ")} in the Host header, with or without the API port.`
          : ""}
      </p>
      {showRestart && status ? (
        <div className="host-restart-notice" role="status" data-testid="host-restart-notice">
          Saved host is {status.saved}. Restart NerdGram manually before that address takes
          effect. NerdGram does not restart itself.
          {status.envOverrides
            ? " HOST is set, so a restart still uses HOST until that variable is unset."
            : ` Until then it keeps listening on ${listeningLabel(status.effectiveHosts)}.`}
          {!status.envOverrides && status.saved !== "0.0.0.0" && status.saved !== "::"
            ? ` After the restart, open the app on ${status.saved} and the API port. Loopback will not answer if the bind is that address only.`
            : ""}
        </div>
      ) : null}
      {readOnly ? null : (
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || status == null || draft.trim().length === 0}
            onClick={() => {
              setBusy(true);
              setError(null);
              setNotice(null);
              void api
                .saveListenHost(draft.trim())
                .then((next) => {
                  setStatus(next);
                  setDraft(next.saved);
                  setNotice(
                    next.restartNotice
                      ? `Saved ${next.saved}. Start NerdGram again for it to listen there.`
                      : `Saved ${next.saved}. The default loopback bind stays in place.`,
                  );
                })
                .catch((err: unknown) => setError(messageOf(err)))
                .finally(() => setBusy(false));
            }}
          >
            Save host
          </button>
        </div>
      )}
    </section>
  );
}
