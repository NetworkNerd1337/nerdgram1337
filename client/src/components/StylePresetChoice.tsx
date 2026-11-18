import { useEffect, useState } from "react";
import { api } from "../api";
import { initialPresetId, type StylePresetDocument, type StyleSnapshot } from "../lib/stylePresets";

export type PresetChoice = {
  id: string;
  style: StyleSnapshot | null;
};

/**
 * Preset picker for a create flow. New, paste, and from-data start on the
 * default preset. A template keeps its own style until a preset is chosen.
 */
export function StylePresetChoice({
  mode,
  onChange,
}: {
  mode: "create" | "template";
  onChange: (choice: PresetChoice) => void;
}) {
  const [doc, setDoc] = useState<StylePresetDocument | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const id = override ?? (doc ? initialPresetId(mode, doc) : "");

  useEffect(() => {
    let cancelled = false;
    void api.stylePresets().then(
      (next) => {
        if (!cancelled) setDoc(next);
      },
      () => {
        if (!cancelled) setDoc({ version: 1, defaultId: null, presets: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!doc) return;
    const preset = doc.presets.find((item) => item.id === id) ?? null;
    onChange({ id: preset?.id ?? "", style: preset?.style ?? null });
  }, [doc, id, onChange]);

  return (
    <div className="style-preset-choice">
      <label>
        Style preset
        <select
          aria-label="Style preset"
          value={id}
          onChange={(event) => setOverride(event.target.value)}
        >
          <option value="">{mode === "template" ? "Keep template style" : "No preset"}</option>
          {(doc?.presets ?? []).map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
              {preset.id === doc?.defaultId ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="file-name-hint">
        {mode === "template"
          ? "The template’s own style is kept unless you choose a preset. A preset copies its values into the new file."
          : "A default preset is selected when one is set. Choosing a preset copies its values into the new file."}
      </p>
    </div>
  );
}
