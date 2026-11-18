import { useState } from "react";
import { FontFamilyField } from "./FontFamilyField";
import {
  ELK_NODE_PLACEMENTS,
  FLOWCHART_CURVES,
  MERMAID_LAYOUTS,
  MERMAID_LOOKS,
  MERMAID_THEMES,
  themeLabel,
} from "../lib/frontMatter";
import { emptyStyle, type StyleSnapshot } from "../lib/stylePresets";

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

const VARIABLE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,80}$/;

export function StyleFields({
  style,
  disabled,
  onChange,
}: {
  style: StyleSnapshot;
  disabled?: boolean;
  onChange: (style: StyleSnapshot) => void;
}) {
  const [extraName, setExtraName] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const variableKeys = [
    ...THEME_FIELDS.map(([key]) => key),
    ...Object.keys(style.themeVariables).filter((key) => !THEME_FIELDS.some(([name]) => name === key)),
  ];

  function setVariable(key: string, value: string) {
    const next = { ...style.themeVariables };
    if (!value.trim()) delete next[key];
    else next[key] = value;
    onChange({ ...style, themeVariables: next });
  }

  return (
    <div className="style-fields">
      <label>
        Theme
        <select
          aria-label="Preset theme"
          value={style.theme ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ ...style, theme: event.target.value || null })}
        >
          <option value="">App default (dark)</option>
          {style.theme && !MERMAID_THEMES.includes(style.theme as (typeof MERMAID_THEMES)[number]) ? (
            <option value={style.theme}>{style.theme}</option>
          ) : null}
          {MERMAID_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {themeLabel(theme)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Look
        <select
          aria-label="Preset look"
          value={style.look ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ ...style, look: event.target.value || null })}
        >
          <option value="">Engine default</option>
          {MERMAID_LOOKS.map((look) => (
            <option key={look} value={look}>
              {look === "handDrawn" ? "Hand-drawn" : look === "neo" ? "Neo" : "Classic"}
            </option>
          ))}
        </select>
      </label>
      {style.look === "handDrawn" ? (
        <label>
          Hand-drawn seed
          <input
            type="number"
            aria-label="Preset hand-drawn seed"
            value={style.handDrawnSeed ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const raw = event.target.value.trim();
              onChange({ ...style, handDrawnSeed: raw === "" ? null : Number(raw) });
            }}
          />
        </label>
      ) : null}
      <label>
        Layout
        <select
          aria-label="Preset layout"
          value={style.layout ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ ...style, layout: event.target.value || null })}
        >
          <option value="">Engine default</option>
          {MERMAID_LAYOUTS.map((layout) => (
            <option key={layout} value={layout}>
              {layout === "elk" ? "ELK" : "Dagre"}
            </option>
          ))}
        </select>
      </label>
      <FontFamilyField
        value={style.fontFamily}
        disabled={Boolean(disabled)}
        onCommit={(fontFamily) => onChange({ ...style, fontFamily })}
      />
      <label>
        Gantt display
        <select
          aria-label="Preset Gantt display"
          value={style.displayMode ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ ...style, displayMode: event.target.value || null })}
        >
          <option value="">Default</option>
          {style.displayMode && style.displayMode !== "compact" ? (
            <option value={style.displayMode}>{style.displayMode}</option>
          ) : null}
          <option value="compact">Compact</option>
        </select>
      </label>
      <label>
        Flowchart curve
        <select
          aria-label="Preset flowchart curve"
          value={style.flowchartCurve ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ ...style, flowchartCurve: event.target.value || null })}
        >
          <option value="">Engine default</option>
          {FLOWCHART_CURVES.map((curve) => (
            <option key={curve} value={curve}>
              {curve}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="info-group" disabled={disabled}>
        <legend>Theme variables</legend>
        {variableKeys.map((key) => {
          const label = THEME_FIELDS.find(([name]) => name === key)?.[1] ?? key;
          const current = style.themeVariables[key];
          return (
            <label key={key}>
              {label}
              <input
                aria-label={`Preset theme variable ${label}`}
                value={current == null ? "" : String(current)}
                onChange={(event) => setVariable(key, event.target.value)}
              />
            </label>
          );
        })}
        <div className="style-preset-actions">
          <input
            aria-label="New theme variable name"
            placeholder="Variable name"
            value={extraName}
            onChange={(event) => setExtraName(event.target.value)}
          />
          <input
            aria-label="New theme variable value"
            placeholder="Value"
            value={extraValue}
            onChange={(event) => setExtraValue(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const key = extraName.trim();
              if (!VARIABLE_KEY.test(key) || !extraValue.trim()) return;
              onChange({ ...style, themeVariables: { ...style.themeVariables, [key]: extraValue.trim() } });
              setExtraName("");
              setExtraValue("");
            }}
          >
            Add variable
          </button>
        </div>
      </fieldset>
      <label>
        Theme CSS
        <textarea
          rows={3}
          aria-label="Preset theme CSS"
          spellCheck={false}
          value={style.themeCSS ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ ...style, themeCSS: event.target.value || null })}
        />
      </label>
      <fieldset className="info-group" disabled={disabled}>
        <legend>ELK options</legend>
        <label className="info-check">
          <input
            type="checkbox"
            checked={style.elk.mergeEdges === true}
            onChange={(event) =>
              onChange({ ...style, elk: { ...style.elk, mergeEdges: event.target.checked ? true : null } })
            }
          />
          Merge edges
        </label>
        <label>
          Node placement
          <select
            aria-label="Preset node placement"
            value={style.elk.nodePlacementStrategy ?? ""}
            onChange={(event) =>
              onChange({
                ...style,
                elk: { ...style.elk, nodePlacementStrategy: event.target.value || null },
              })
            }
          >
            <option value="">Engine default</option>
            {ELK_NODE_PLACEMENTS.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => onChange(emptyStyle())}>
        Clear style fields
      </button>
    </div>
  );
}
