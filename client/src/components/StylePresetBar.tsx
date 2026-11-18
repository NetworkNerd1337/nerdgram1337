import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DiagramDocument } from "../lib/frontMatter";
import {
  applyStyleToSource,
  styleChanges,
  styleFromDiagram,
  type StylePreset,
  type StylePresetDocument,
} from "../lib/stylePresets";

export function StylePresetBar({
  source,
  info,
  locked,
  focus,
  onFocusHandled,
  onChange,
}: {
  source: string;
  info: DiagramDocument;
  locked: boolean;
  focus: "apply" | "save" | null;
  onFocusHandled: () => void;
  onChange: (source: string) => void;
}) {
  const [doc, setDoc] = useState<StylePresetDocument | null>(null);
  const [pickedId, setPickedId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoSource, setUndoSource] = useState<string | null>(null);
  const applied = useRef<string | null>(null);
  const applyRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    void api.stylePresets().then(
      (next) => setDoc(next),
      () => setDoc(null),
    );
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (undoSource == null) return;
    if (applied.current != null && source !== applied.current) {
      applied.current = null;
      setUndoSource(null);
    }
  }, [source, undoSource]);

  useEffect(() => {
    if (focus === "apply") applyRef.current?.focus();
    if (focus === "save") nameRef.current?.focus();
    if (focus) onFocusHandled();
  }, [focus, onFocusHandled]);

  const picked = doc?.presets.find((preset) => preset.id === pickedId) ?? null;
  const changes = picked && !info.malformed ? styleChanges(info, picked.style) : [];

  function apply(preset: StylePreset) {
    const result = applyStyleToSource(source, preset.style);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setNotice(null);
    if (result.source === source) return;
    applied.current = result.source;
    setUndoSource(source);
    onChange(result.source);
  }

  async function save() {
    const nextName = name.trim();
    if (!nextName) {
      setError("Enter a name for the preset.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await api.createStylePreset({ name: nextName, style: styleFromDiagram(info) });
      setName("");
      setNotice(`Saved “${nextName}”. The diagram file was not changed.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the preset.");
    }
  }

  return (
    <section className="style-preset-bar" aria-label="Style preset">
      <h3>Style preset</h3>
      <p>
        Applying a preset copies its values into this file. The file does not stay linked to the preset.
      </p>
      <label>
        Apply preset
        <select
          ref={applyRef}
          aria-label="Apply style preset"
          value={pickedId}
          disabled={locked}
          onChange={(event) => {
            setPickedId(event.target.value);
            setError(null);
          }}
        >
          <option value="">Choose a preset</option>
          {(doc?.presets ?? []).map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
              {preset.id === doc?.defaultId ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>
      {picked ? (
        <div className="style-preset-preview" aria-live="polite">
          <p>
            {changes.length === 0
              ? "This diagram already has these values."
              : `${picked.name} will change this file:`}
          </p>
          {changes.length > 0 ? (
            <ul>
              {changes.map((change) => (
                <li key={change.field}>
                  {change.label}: {change.before} → {change.after}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="style-preset-actions">
            <button type="button" className="btn btn-primary" disabled={locked} onClick={() => apply(picked)}>
              Apply
            </button>
          </div>
        </div>
      ) : null}
      {undoSource != null ? (
        <div className="style-preset-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const previous = undoSource;
              applied.current = null;
              setUndoSource(null);
              onChange(previous);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
      <label>
        Save as preset
        <input
          ref={nameRef}
          aria-label="Preset name"
          value={name}
          disabled={locked}
          placeholder="House style"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void save();
          }}
        />
      </label>
      <div className="style-preset-actions">
        <button type="button" className="btn btn-ghost" disabled={locked} onClick={() => void save()}>
          Save as preset
        </button>
        <a className="btn btn-ghost" href="/settings#style-presets">
          Manage presets
        </a>
      </div>
      {error ? (
        <p className="info-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="style-preset-notice">{notice}</p> : null}
    </section>
  );
}
