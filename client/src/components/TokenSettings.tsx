import { useEffect, useState } from "react";
import { api } from "../api";
import { SettingsCard } from "./SettingsCard";

const NAME_MAX = 40;
import { Modal } from "./Modal";

type TokenMeta = {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "read-write";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Confirm =
  | { type: "revoke"; id: string }
  | { type: "delete"; id: string }
  | { type: "clear" };

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not update tokens";
}

export function TokenSettings() {
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "read-write">("read");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const refresh = async () => {
    const listed = await api.listTokens();
    setTokens(listed.tokens);
  };

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(messageOf(err)));
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const pending = confirm && confirm.type !== "clear" ? tokens.find((token) => token.id === confirm.id) : null;
  const revokedCount = tokens.filter((token) => token.revokedAt).length;

  const copyToken = () => {
    if (!revealed) return;
    void navigator.clipboard.writeText(revealed).then(
      () => setCopied(true),
      () => setError("Could not copy the token. Select it and copy it manually."),
    );
  };

  const dismissReveal = () => {
    setRevealed(null);
    setCopied(false);
  };

  return (
    <SettingsCard id="tokens" title="Automation tokens" summary="Bearer tokens for scripts and CI.">
      <p>
        Scripts and CI call <code>/api/v1</code> with <code>Authorization: Bearer</code>.
        The browser UI does not use a token. A token is shown once. Read can list, search,
        lint, and render. Read-write can also create, update, move, and trash diagrams.
        Revoking a token stops it immediately and cannot be undone. Delete and Clear revoked
        only remove revoked tokens from this list. These tokens do not protect the browser
        routes. The server listens on loopback until you change <a href="#host">Host</a> or
        set <code>HOST</code>. Anyone who can reach the port can use the browser routes.
      </p>
      {error ? <div className="error-banner">{error}</div> : null}
      {revealed ? (
        <div className="token-reveal" role="status" data-testid="new-token-panel">
          <h3>Your new token</h3>
          <p>Copy this token now. It will not be shown again, because NerdGram stores only a hash.</p>
          <p className="token-once" data-testid="new-token-value">
            {revealed}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={copyToken}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={dismissReveal}>
              Done
            </button>
          </div>
        </div>
      ) : null}
      <label htmlFor="token-name">Name</label>
      <input
        id="token-name"
        value={name}
        maxLength={NAME_MAX}
        onChange={(event) => setName(event.target.value.slice(0, NAME_MAX))}
        autoComplete="off"
        spellCheck={false}
        placeholder="CI render"
        aria-describedby="token-name-count"
      />
      <p className="field-count" id="token-name-count">
        {name.length}/{NAME_MAX}. At least 1 character.
      </p>
      <label htmlFor="token-scope">Scope</label>
      <select id="token-scope" value={scope} onChange={(event) => setScope(event.target.value === "read-write" ? "read-write" : "read")}>
        <option value="read">Read</option>
        <option value="read-write">Read and write</option>
      </select>
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || name.trim().length < 1}
          onClick={() => {
            setBusy(true);
            setError(null);
            setCopied(false);
            void api
              .createToken(name.trim(), scope)
              .then(async (created) => {
                setRevealed(created.token);
                setName("");
                await refresh();
              })
              .catch((err: unknown) => setError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          Create token
        </button>
        {revokedCount > 0 ? (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirm({ type: "clear" })}>
            Clear revoked
          </button>
        ) : null}
      </div>
      {tokens.length === 0 ? <p>No tokens yet.</p> : null}
      {tokens.map((token) => (
        <div className="token-row" key={token.id}>
          <div>
            <strong className="clipped-name" title={token.name}>
              {token.name}
            </strong>
            <p>
              {token.prefix}… · {token.scope === "read-write" ? "read and write" : "read"}
              {token.revokedAt ? " · revoked" : ""}
            </p>
          </div>
          <div className="token-row-actions">
            {token.revokedAt ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => setConfirm({ type: "delete", id: token.id })}
              >
                Delete
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => setConfirm({ type: "revoke", id: token.id })}
              >
                Revoke
              </button>
            )}
          </div>
        </div>
      ))}
      {confirm?.type === "revoke" && pending ? (
        <Modal
          title={`Revoke ${pending.name}?`}
          confirmLabel="Revoke token"
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const id = pending.id;
            setConfirm(null);
            setBusy(true);
            setError(null);
            void api
              .revokeToken(id)
              .then(() => refresh())
              .catch((err: unknown) => setError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          <p>
            {pending.name} ({pending.prefix}…) stops working immediately. Revoking cannot be undone.
            This does not delete diagrams.
          </p>
        </Modal>
      ) : null}
      {confirm?.type === "delete" && pending ? (
        <Modal
          title={`Delete ${pending.name}?`}
          confirmLabel="Delete token"
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const id = pending.id;
            setConfirm(null);
            setBusy(true);
            setError(null);
            void api
              .deleteRevokedToken(id)
              .then(() => refresh())
              .catch((err: unknown) => setError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          <p>
            {pending.name} ({pending.prefix}…) is removed from the list. It stays revoked and cannot be
            used again.
          </p>
        </Modal>
      ) : null}
      {confirm?.type === "clear" ? (
        <Modal
          title="Clear revoked tokens?"
          confirmLabel="Clear revoked"
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            setBusy(true);
            setError(null);
            void api
              .clearRevokedTokens()
              .then(() => refresh())
              .catch((err: unknown) => setError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          <p>
            Remove {revokedCount} revoked token{revokedCount === 1 ? "" : "s"} from the list. This does
            not reactivate them, and active tokens stay.
          </p>
        </Modal>
      ) : null}
    </SettingsCard>
  );
}
