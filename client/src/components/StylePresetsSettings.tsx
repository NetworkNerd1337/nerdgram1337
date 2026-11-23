import { useEffect, useState } from "react";
import { IMPORT_PRESET_KEY } from "../lib/importRecognize";
import { api } from "../api";
import { SettingsCard } from "./SettingsCard";

const NAME_MAX = 40;
import { StyleFields } from "./StyleFields";
import {
  copyPresetName,
  emptyStyle,
  emptyStyleDocument,
  type StylePreset,
  type StylePresetDocument,
  type StyleSnapshot,
} from "../lib/stylePresets";

export function StylePresetsSettings() {
  const [doc, setDoc] = useState<StylePresetDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editStyle, setEditStyle] = useState<StyleSnapshot>(emptyStyle());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [replaceOnImport, setReplaceOnImport] = useState(false);

  const load = async () => {
    const next = await api.stylePresets();
    setDoc(next);
  };

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Style presets could not be loaded.");
    });
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update style presets.");
    } finally {
      setBusy(false);
    }
  };

  const setDefault = (id: string) => {
    const current = doc?.defaultId;
    if (!doc) return;
    if (id === (current ?? "")) return;
    void run(async () => {
      if (!id) {
        if (current) await api.updateStylePreset(current, { default: false });
        return;
      }
      await api.updateStylePreset(id, { default: true });
    });
  };

  const exportFile = () => {
    const payload = doc ?? emptyStyleDocument();
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "style-presets.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importText = async (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      setError("That file is not JSON.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("That file is not a style preset document.");
      return;
    }
    const body = parsed as { version?: unknown; defaultId?: unknown; presets?: unknown };
    await run(async () => {
      await api.importStylePresets({
        version: body.version,
        defaultId: body.defaultId ?? null,
        presets: body.presets,
        mode: replaceOnImport ? "replace" : "add",
      });
      setNotice(replaceOnImport ? "Replaced the presets on this computer." : "Imported presets.");
    });
  };

  const importFile = async (file: File) => {
    await importText(await file.text());
  };

  useEffect(() => {
    const raw = sessionStorage.getItem(IMPORT_PRESET_KEY);
    if (!raw) return;
    sessionStorage.removeItem(IMPORT_PRESET_KEY);
    void importText(raw);
  }, []);

  return (
    <SettingsCard id="style-presets" title="Style presets" summary="Named copies of theme, look, layout, and font.">
      <p>
        A preset is a named copy of theme, look, layout, font, colors, and the other style fields
        from Diagram info. It is stored in <code>.meta/style-presets.json</code> on this computer.
        Applying one copies those values into the diagram file. Deleting a preset does not change
        diagrams that already used it. GitHub sync does not copy this file.
      </p>
      {error ? (
        <p className="info-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="style-preset-notice">{notice}</p> : null}
      <label htmlFor="default-style-preset">Default for new diagrams</label>
      <select
        id="default-style-preset"
        aria-label="Default style preset"
        value={doc?.defaultId ?? ""}
        disabled={!doc || busy}
        onChange={(event) => setDefault(event.target.value)}
      >
        <option value="">No default</option>
        {(doc?.presets ?? []).map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      <p>New diagram, Paste Mermaid, and From data start on this preset. A template keeps its own style until you choose one.</p>
      {!doc ? <p>Loading presets…</p> : null}
      {doc && doc.presets.length === 0 ? <p>No style presets yet. Save one from Diagram info.</p> : null}
      <ul className="style-preset-list">
        {(doc?.presets ?? []).map((preset) => (
          <li key={preset.id}>
            <PresetRow
              preset={preset}
              isDefault={preset.id === doc?.defaultId}
              busy={busy}
              renaming={renameId === preset.id}
              renameValue={renameValue}
              editing={editId === preset.id}
              editStyle={editStyle}
              confirmingDelete={deleteId === preset.id}
              onRenameStart={() => {
                setRenameId(preset.id);
                setRenameValue(preset.name);
                setEditId(null);
                setDeleteId(null);
              }}
              onRenameValue={setRenameValue}
              onRenameCancel={() => setRenameId(null)}
              onRenameSave={() => {
                void run(async () => {
                  await api.updateStylePreset(preset.id, { name: renameValue });
                  setRenameId(null);
                  setNotice(`Renamed to “${renameValue.trim()}”.`);
                });
              }}
              onEditStart={() => {
                setEditId(preset.id);
                setEditStyle(preset.style);
                setRenameId(null);
                setDeleteId(null);
              }}
              onEditStyle={setEditStyle}
              onEditCancel={() => setEditId(null)}
              onEditSave={() => {
                void run(async () => {
                  await api.updateStylePreset(preset.id, { style: editStyle });
                  setEditId(null);
                  setNotice(`Updated “${preset.name}”. Existing diagrams were not changed.`);
                });
              }}
              onDuplicate={() => {
                const nextName = copyPresetName(preset.name, (doc?.presets ?? []).map((item) => item.name));
                void run(async () => {
                  await api.createStylePreset({ name: nextName, style: preset.style });
                  setNotice(`Duplicated as “${nextName}”.`);
                });
              }}
              onDeleteAsk={() => {
                setDeleteId(preset.id);
                setRenameId(null);
                setEditId(null);
              }}
              onDeleteCancel={() => setDeleteId(null)}
              onDeleteConfirm={() => {
                void run(async () => {
                  await api.deleteStylePreset(preset.id);
                  setDeleteId(null);
                  setNotice(`Deleted “${preset.name}”. Diagrams were not changed.`);
                });
              }}
            />
          </li>
        ))}
      </ul>
      <div className="style-preset-actions">
        <button type="button" className="btn btn-ghost" onClick={exportFile} disabled={!doc}>
          Export JSON
        </button>
        <label className="btn btn-ghost style-preset-import">
          Import JSON
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import style presets"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </label>
      </div>
      <label className="sync-check">
        <input
          type="checkbox"
          checked={replaceOnImport}
          onChange={(event) => setReplaceOnImport(event.target.checked)}
        />
        <span>Replace the presets on this computer. Diagrams are not changed.</span>
      </label>
    </SettingsCard>
  );
}

function PresetRow({
  preset,
  isDefault,
  busy,
  renaming,
  renameValue,
  editing,
  editStyle,
  confirmingDelete,
  onRenameStart,
  onRenameValue,
  onRenameCancel,
  onRenameSave,
  onEditStart,
  onEditStyle,
  onEditCancel,
  onEditSave,
  onDuplicate,
  onDeleteAsk,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  preset: StylePreset;
  isDefault: boolean;
  busy: boolean;
  renaming: boolean;
  renameValue: string;
  editing: boolean;
  editStyle: StyleSnapshot;
  confirmingDelete: boolean;
  onRenameStart: () => void;
  onRenameValue: (value: string) => void;
  onRenameCancel: () => void;
  onRenameSave: () => void;
  onEditStart: () => void;
  onEditStyle: (style: StyleSnapshot) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onDuplicate: () => void;
  onDeleteAsk: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  return (
    <article className="style-preset-card" aria-label={preset.name}>
      <div className="style-preset-row">
        <strong className="clipped-name" title={preset.name}>
          {preset.name}
        </strong>
        {isDefault ? <span className="style-preset-badge">Default</span> : null}
        <div className="style-preset-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRenameStart}>
            Rename
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onEditStart}>
            Edit
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onDeleteAsk}>
            Delete
          </button>
        </div>
      </div>
      {renaming ? (
        <div className="style-preset-editor">
          <label>
            Name
            <input
              aria-label={`Rename ${preset.name}`}
              value={renameValue}
              maxLength={renameValue.length > NAME_MAX ? undefined : NAME_MAX}
              aria-describedby="preset-rename-count"
              onChange={(event) => {
                const next = event.target.value;
                if (next.length <= NAME_MAX || next.length < renameValue.length) onRenameValue(next);
              }}
            />
            <span className="field-count" id="preset-rename-count">
              {renameValue.length}/{NAME_MAX}
            </span>
          </label>
          <div className="style-preset-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onRenameSave}>
              Save name
            </button>
            <button type="button" className="btn btn-ghost" onClick={onRenameCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {editing ? (
        <div className="style-preset-editor">
          <StyleFields style={editStyle} disabled={busy} onChange={onEditStyle} />
          <div className="style-preset-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onEditSave}>
              Save preset
            </button>
            <button type="button" className="btn btn-ghost" onClick={onEditCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {confirmingDelete ? (
        <div className="style-preset-editor">
          <p>Delete “{preset.name}”? Diagrams that used it stay as they are.</p>
          <div className="style-preset-actions">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={onDeleteConfirm}>
              Delete preset
            </button>
            <button type="button" className="btn btn-ghost" onClick={onDeleteCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
