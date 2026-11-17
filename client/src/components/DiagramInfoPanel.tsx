import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyDiagramPatch,
  diagramConfigKey,
  ELK_NODE_PLACEMENTS,
  FLOWCHART_CURVES,
  MERMAID_LAYOUTS,
  MERMAID_LOOKS,
  MERMAID_THEMES,
  migrateInitDirectives,
  parseDiagram,
  themeLabel,
  type DiagramPatch,
  type Scalar,
} from "../lib/frontMatter";
import { FONT_PRESETS, fontSelection } from "../lib/fontFamily";
import { api } from "../api";
import { TagCombobox } from "./TagCombobox";
import type { TagCount } from "../lib/tagSuggestions";

const THEME_FIELDS: [string, string][] = [
  ["primaryColor", "Primary"],
  ["primaryTextColor", "Primary text"],
  ["primaryBorderColor", "Primary border"],
  ["lineColor", "Line"],
  ["secondaryColor", "Secondary"],
  ["tertiaryColor", "Tertiary"],
  ["background", "Background"],
  ["mainBkg", "Main background"],
];

export type DiagramLinkRow = {
  path: string | null;
  label: string;
  broken?: boolean;
};

type DiagramInfoPanelProps = {
  source: string;
  fileName: string;
  readOnly: boolean;
  linksTo?: readonly DiagramLinkRow[];
  linkedFrom?: readonly DiagramLinkRow[];
  onOpenDiagram?: (path: string) => void;
  onChange: (source: string) => void;
  onClose: () => void;
};

export function DiagramInfoPanel({
  source,
  fileName,
  readOnly,
  linksTo = [],
  linkedFrom = [],
  onOpenDiagram,
  onChange,
  onClose,
}: DiagramInfoPanelProps) {
  const info = useMemo(() => parseDiagram(source), [source]);
  const diagramKey = useMemo(() => diagramConfigKey(info.body), [info.body]);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<TagCount[]>([]);
  const locked = readOnly || info.malformed;

  function commit(patch: DiagramPatch) {
    if (locked) return;
    const next = applyDiagramPatch(source, patch);
    if (!next.ok) {
      setPatchError(next.error);
      return;
    }
    setPatchError(null);
    onChange(next.source);
  }

  function migrate() {
    if (readOnly) return;
    const next = migrateInitDirectives(source);
    if (!next.ok) {
      setPatchError(next.error);
      return;
    }
    setPatchError(null);
    if (next.migrated) onChange(next.source);
  }

  useEffect(() => {
    let cancelled = false;
    void api.tags().then(
      (result) => {
        if (!cancelled) setCatalog(result.tags);
      },
      () => {
        if (!cancelled) setCatalog([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function addTag(tag: string) {
    const text = tag.trim();
    if (!text || info.tags.some((item) => item.toLowerCase() === text.toLowerCase())) return;
    commit({ tags: [...info.tags, text] });
  }

  const variableKeys = [
    ...THEME_FIELDS.map(([key]) => key),
    ...Object.keys(info.themeVariables).filter((key) => !THEME_FIELDS.some(([name]) => name === key)),
  ];

  return (
    <aside className="diagram-info" id="diagram-info-panel" aria-label="Diagram info">
      <div className="diagram-info-head">
        <h2>Diagram info</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="diagram-info-file">File name: {fileName}</p>
      <section className="info-links" aria-label="Diagram links">
        <h3>Links to</h3>
        {linksTo.length === 0 ? (
          <p>This diagram does not link to another diagram.</p>
        ) : (
          <ul>
            {linksTo.map((link) => (
              <li key={`${link.label}:${link.path ?? "missing"}`}>
                {link.path && !link.broken && onOpenDiagram ? (
                  <button type="button" onClick={() => onOpenDiagram(link.path as string)}>
                    {link.label}
                  </button>
                ) : (
                  <span>
                    {link.label}
                    {link.broken ? " (missing)" : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <h3>Linked from</h3>
        {linkedFrom.length === 0 ? (
          <p>No other diagram links here.</p>
        ) : (
          <ul>
            {linkedFrom.map((link) => (
              <li key={link.path ?? link.label}>
                {link.path && onOpenDiagram ? (
                  <button type="button" onClick={() => onOpenDiagram(link.path as string)}>
                    {link.label}
                  </button>
                ) : (
                  <span>{link.label}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {info.malformed && (
        <p className="info-error" role="alert">
          The YAML header could not be parsed{info.error ? `: ${info.error}` : ""}. Edit it in the
          code pane. Saving keeps that text and does not replace the header.
        </p>
      )}
      {patchError && !info.malformed && (
        <p className="info-error" role="alert">
          {patchError}
        </p>
      )}
      {info.hasLegacyInit && (
        <div className="info-note">
          <p>
            This file still has a <code>%%{"{init}"}%%</code> directive. Mermaid still applies it.
            Moving it into front matter keeps the directive&apos;s values where both set the same
            option.
          </p>
          <button type="button" className="btn btn-primary" onClick={migrate} disabled={readOnly || info.malformed}>
            Move into front matter
          </button>
          {info.initError && <p className="info-error">{info.initError}</p>}
        </div>
      )}

      <label>
        Title
        <input
          value={info.title ?? ""}
          disabled={locked}
          aria-label="Diagram title"
          onChange={(event) => commit({ title: event.target.value })}
        />
      </label>
      <label>
        Description
        <input
          value={info.description}
          disabled={locked}
          aria-label="Diagram description"
          onChange={(event) => commit({ description: event.target.value })}
        />
      </label>
      <label>
        Notes
        <textarea
          rows={4}
          value={info.notes}
          disabled={locked}
          aria-label="Diagram notes"
          onChange={(event) => commit({ notes: event.target.value })}
        />
      </label>
      <div className="info-tags">
        <span>Tags</span>
        <div className="tag-row">
          {info.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="tag-chip"
              disabled={locked}
              onClick={() => commit({ tags: info.tags.filter((item) => item !== tag) })}
            >
              {tag} ×
            </button>
          ))}
        </div>
        <TagCombobox catalog={catalog} exclude={info.tags} disabled={locked} onAdd={addTag} />
      </div>

      <SelectField
        label="Theme"
        value={info.theme ?? ""}
        emptyLabel="App default (dark)"
        options={MERMAID_THEMES.map((theme) => [theme, themeLabel(theme)])}
        disabled={locked}
        onChange={(theme) => commit({ theme })}
      />
      <SelectField
        label="Look"
        value={info.look ?? ""}
        emptyLabel="Engine default"
        options={MERMAID_LOOKS.map((look) => [look, look === "handDrawn" ? "Hand-drawn" : look === "neo" ? "Neo" : "Classic"])}
        disabled={locked}
        onChange={(look) => commit({ look })}
      />
      {info.look === "handDrawn" && (
        <label>
          Hand-drawn seed
          <input
            type="number"
            value={info.handDrawnSeed ?? ""}
            disabled={locked}
            aria-label="Hand-drawn seed"
            onChange={(event) => {
              const raw = event.target.value.trim();
              commit({ handDrawnSeed: raw === "" ? null : Number(raw) });
            }}
          />
        </label>
      )}
      <SelectField
        label="Layout"
        value={info.layout ?? ""}
        emptyLabel="Engine default"
        options={MERMAID_LAYOUTS.map((layout) => [layout, layout === "elk" ? "ELK" : "Dagre"])}
        disabled={locked}
        onChange={(layout) => commit({ layout })}
      />
      <FontFamilyField
        value={info.fontFamily}
        disabled={locked}
        onCommit={(fontFamily) => commit({ fontFamily })}
      />
      <SelectField
        label="Gantt display"
        value={info.displayMode ?? ""}
        emptyLabel="Default"
        options={[["compact", "Compact"]]}
        disabled={locked}
        onChange={(displayMode) => commit({ displayMode })}
      />
      {diagramKey === "flowchart" && (
        <SelectField
          label="Flowchart curve"
          value={info.flowchartCurve ?? ""}
          emptyLabel="Engine default"
          options={FLOWCHART_CURVES.map((curve) => [curve, curve])}
          disabled={locked}
          onChange={(flowchartCurve) => commit({ flowchartCurve })}
        />
      )}

      <fieldset className="info-group" disabled={locked}>
        <legend>Theme variables</legend>
        <p>Stored in <code>config.themeVariables</code>. They apply on any theme, and they are the palette for base.</p>
        {variableKeys.map((key) => {
          const label = THEME_FIELDS.find(([name]) => name === key)?.[1] ?? key;
          const current = info.themeVariables[key];
          return (
            <label key={key}>
              {label}
              <input
                value={current == null ? "" : String(current)}
                aria-label={`Theme variable ${label}`}
                onChange={(event) =>
                  commit({ themeVariables: { [key]: event.target.value as Scalar } })
                }
              />
            </label>
          );
        })}
      </fieldset>
      <label>
        Theme CSS
        <textarea
          rows={3}
          value={info.themeCSS ?? ""}
          disabled={locked}
          aria-label="Theme CSS"
          spellCheck={false}
          onChange={(event) => commit({ themeCSS: event.target.value })}
        />
      </label>
      {info.layout !== "dagre" && (
        <fieldset className="info-group" disabled={locked}>
          <legend>ELK options</legend>
          <label className="info-check">
            <input
              type="checkbox"
              checked={info.elk.mergeEdges === true}
              onChange={(event) => commit({ elk: { mergeEdges: event.target.checked } })}
            />
            Merge edges
          </label>
          <SelectField
            label="Node placement"
            value={typeof info.elk.nodePlacementStrategy === "string" ? info.elk.nodePlacementStrategy : ""}
            emptyLabel="Engine default"
            options={ELK_NODE_PLACEMENTS.map((strategy) => [strategy, strategy])}
            disabled={locked}
            onChange={(nodePlacementStrategy) => commit({ elk: { nodePlacementStrategy } })}
          />
        </fieldset>
      )}
    </aside>
  );
}

function FontFamilyField({
  value,
  disabled,
  onCommit,
}: {
  value: string | null;
  disabled: boolean;
  onCommit: (fontFamily: string | null) => void;
}) {
  const selection = fontSelection(value);
  const valueKey = value?.trim() ?? "";
  const [customMode, setCustomMode] = useState(selection.preset === "custom");
  const [draft, setDraft] = useState(selection.custom);
  const focused = useRef(false);
  const seen = useRef(valueKey);
  const mode = customMode ? "custom" : selection.preset;

  useEffect(() => {
    if (focused.current || seen.current === valueKey) return;
    seen.current = valueKey;
    const next = fontSelection(value);
    setCustomMode(next.preset === "custom");
    setDraft(next.custom);
  }, [value, valueKey]);

  const choose = (next: string) => {
    if (next === "custom") {
      setCustomMode(true);
      const starting = selection.preset === "custom" ? selection.custom : selection.preset;
      setDraft(starting);
      return;
    }
    setCustomMode(false);
    onCommit(next || null);
  };

  const saveDraft = () => {
    focused.current = false;
    const trimmed = draft.trim();
    const next = fontSelection(trimmed);
    setCustomMode(next.preset === "custom");
    setDraft(next.custom);
    seen.current = trimmed;
    onCommit(trimmed || null);
  };

  return (
    <div className="font-family-field">
      <label>
        Font family
        <select
          aria-label="Font family"
          value={mode}
          disabled={disabled}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">Default</option>
          {FONT_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {mode === "custom" ? (
        <label>
          Custom font family
          <input
            aria-label="Custom font family"
            value={draft}
            disabled={disabled}
            spellCheck={false}
            placeholder="IBM Plex Sans, system-ui, sans-serif"
            onFocus={() => {
              focused.current = true;
            }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={saveDraft}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              event.currentTarget.blur();
            }}
          />
        </label>
      ) : null}
      <p className="font-family-help">
        Fonts must be installed on the computer that views or renders the diagram. Separate fallbacks with commas.
      </p>
    </div>
  );
}

function SelectField({
  label,
  value,
  emptyLabel,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  options: [string, string][];
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const known = new Set(options.map(([option]) => option));
  return (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{emptyLabel}</option>
        {value && !known.has(value) ? <option value={value}>{value}</option> : null}
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
