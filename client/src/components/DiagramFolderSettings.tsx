import { useEffect, useState } from "react";
import { api, type DataDirStatus } from "../api";
import { SettingsCard } from "./SettingsCard";

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not save the diagram folder";
}

function needsRestart(status: DataDirStatus): boolean {
  return !status.readOnly && status.persisted && status.saved !== status.running;
}

export function DiagramFolderSettings({ githubSync = false }: { githubSync?: boolean }) {
  const [status, setStatus] = useState<DataDirStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .dataDir()
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
  }, [githubSync]);

  const readOnly = status?.readOnly === true || githubSync;
  const showRestart = status ? needsRestart(status) : false;

  return (
    <SettingsCard id="diagram-folder" title="Diagram folder" summary="Where .mmd files are read after the next start.">
      <p>
        This sets <code>NERDGRAM_DATA_DIR</code>, the folder of <code>.mmd</code> files NerdGram
        reads after the next start. The default is the <code>diagrams</code> folder in this
        install. A saved path is stored in this computer's startup config, not in the shared
        folder, and it applies when you start NerdGram again. NerdGram does not restart itself.
      </p>
      <p>
        When <code>NERDGRAM_DATA_DIR</code> is set in the shell, a service file, or Docker, that
        value is the only source of truth and this box cannot change it.
      </p>
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="status-banner">{notice}</div> : null}
      {status?.envManaged && status.envSource === "shell" ? (
        <div className="host-override" role="status" data-testid="data-dir-env-note">
          <code>NERDGRAM_DATA_DIR</code> is set to <code>{status.envValue}</code> in the environment
          (the shell or a service file). That value is the source of truth. Unset it and start
          NerdGram again to use a folder saved here.
        </div>
      ) : null}
      {status?.docker ? (
        <p data-testid="data-dir-docker-note">
          This install is Docker, so the Diagram folder box is read-only. The image sets{" "}
          <code>NERDGRAM_DATA_DIR</code>
          {status.envValue ? (
            <>
              {" "}
              to <code>{status.envValue}</code>
            </>
          ) : null}
          . Change the volume mount to use another folder. The container keeps using that mount
          until you recreate it.
        </p>
      ) : null}
      {status?.githubSync || githubSync ? (
        <p data-testid="data-dir-github-note">
          GitHub sync is on, so this field is disabled. Each instance keeps its own copy of the
          repository. The diagram folder setting is for a shared folder on local or on-premises
          storage.
        </p>
      ) : null}
      <label htmlFor="diagram-folder-path">Diagram folder</label>
      <input
        id="diagram-folder-path"
        value={draft}
        disabled={readOnly || busy || status == null}
        onChange={(event) => setDraft(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder={status?.defaultPath ?? "diagrams"}
        aria-describedby="diagram-folder-help"
      />
      <p id="diagram-folder-help">
        An absolute path is required. A relative path is rejected. The folder has to exist, or
        its parent has to exist so NerdGram can create it, and it has to be writable.
        {status ? ` This process is using ${status.running}.` : ""}
      </p>
      {showRestart && status ? (
        <div className="host-restart-notice" role="status" data-testid="data-dir-restart-notice">
          Saved diagram folder is {status.saved}. Restart NerdGram manually before that folder
          takes effect. NerdGram does not restart itself. Until then it keeps using {status.running}.
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
                .saveDataDir(draft.trim())
                .then((next) => {
                  setStatus(next);
                  setDraft(next.saved);
                  setNotice(
                    needsRestart(next)
                      ? `Saved ${next.saved}. Start NerdGram again for it to use that folder.`
                      : `Saved ${next.saved}. NerdGram is already using that folder.`,
                  );
                })
                .catch((err: unknown) => setError(messageOf(err)))
                .finally(() => setBusy(false));
            }}
          >
            Save diagram folder
          </button>
        </div>
      )}
    </SettingsCard>
  );
}
