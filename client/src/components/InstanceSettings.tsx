import { useEffect, useState } from "react";
import { api, type InstanceStatus } from "../api";
import { SettingsCard } from "./SettingsCard";

const NAME_MAX = 32;

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not save the instance name";
}

export function InstanceSettings() {
  const [status, setStatus] = useState<InstanceStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .instance()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setDraft(next.configuredName ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsCard id="instance" title="Instance name" summary={status?.configuredName ? `Name: ${status.configuredName}` : "Name: hostname"}>
      <p>
        Other NerdGram instances use this name when a diagram is open here. Leave it blank to use
        the hostname
        {status ? (
          <>
            {" ("}
            <span className="clipped-name" title={status.hostname}>
              {status.hostname}
            </span>
            {"). "}
          </>
        ) : (
          ". "
        )}
        The name is stored with this install,
        not in the diagram folder. It applies the next time a diagram is opened. It does not need
        a restart.
      </p>
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="status-banner">{notice}</div> : null}
      <label htmlFor="instance-name">Instance name</label>
      <input
        id="instance-name"
        value={draft}
        disabled={busy || status == null}
        maxLength={draft.length > NAME_MAX ? undefined : NAME_MAX}
        onChange={(event) => {
          const next = event.target.value;
          if (next.length <= NAME_MAX || next.length < draft.length) setDraft(next);
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder={status?.hostname ?? "hostname"}
        aria-describedby="instance-name-help"
      />
      <p className="field-count" id="instance-name-help">
        {draft.length}/{NAME_MAX}. Leave blank to use the hostname.
        {status ? (
          <>
            {" "}
            Showing as{" "}
            <span className="clipped-name" title={status.instanceName}>
              {status.instanceName}
            </span>
            . The hostname is{" "}
            <span className="clipped-name" title={status.hostname}>
              {status.hostname}
            </span>
            .
          </>
        ) : (
          " The hostname is the default."
        )}
      </p>
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || status == null}
          onClick={() => {
            setBusy(true);
            setError(null);
            setNotice(null);
            void api
              .saveInstanceName(draft.trim())
              .then((next) => {
                setStatus(next);
                setDraft(next.configuredName ?? "");
                setNotice(
                  next.nameIsDefault
                    ? `Instance name cleared. Other instances will see ${next.instanceName}.`
                    : `Instance name saved. Other instances will see ${next.instanceName}.`,
                );
              })
              .catch((err: unknown) => setError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          Save instance name
        </button>
      </div>
    </SettingsCard>
  );
}
