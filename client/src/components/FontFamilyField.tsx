import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { FONT_PRESETS, fontSelection } from "../lib/fontFamily";
import { suggestTags, tagMatchParts } from "../lib/tagSuggestions";

/**
 * Font family list. Custom suggests families already stored on diagrams,
 * with the same keyboard pattern as the tag combobox. A comma stays in the
 * value, because a font list uses commas between fallbacks.
 */
export function FontFamilyField({
  value,
  disabled,
  onCommit,
}: {
  value: string | null;
  disabled: boolean;
  onCommit: (fontFamily: string | null) => void;
}) {
  const listId = useId();
  const selection = fontSelection(value);
  const valueKey = value?.trim() ?? "";
  const [customMode, setCustomMode] = useState(selection.preset === "custom");
  const [draft, setDraft] = useState(selection.custom);
  const [fonts, setFonts] = useState<{ fontFamily: string; count: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
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

  useEffect(() => {
    let cancelled = false;
    void api.fonts().then(
      (result) => {
        if (!cancelled) setFonts(result.fonts);
      },
      () => {
        if (!cancelled) setFonts([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const catalog = useMemo(
    () => fonts.map((item) => ({ tag: item.fontFamily, count: item.count })),
    [fonts],
  );
  const suggestions = useMemo(() => (mode === "custom" ? suggestTags(catalog, draft, []) : []), [catalog, draft, mode]);
  const active = open && highlight >= 0 && highlight < suggestions.length ? suggestions[highlight] : null;

  const choose = (next: string) => {
    if (next === "custom") {
      setCustomMode(true);
      const starting = selection.preset === "custom" ? selection.custom : selection.preset;
      setDraft(starting);
      setOpen(true);
      setHighlight(-1);
      return;
    }
    setCustomMode(false);
    setOpen(false);
    onCommit(next || null);
  };

  const commitDraft = (text: string) => {
    focused.current = false;
    const trimmed = text.trim();
    const next = fontSelection(trimmed);
    setCustomMode(next.preset === "custom");
    setDraft(next.custom);
    seen.current = trimmed;
    setOpen(false);
    setHighlight(-1);
    onCommit(trimmed || null);
  };

  const saveDraft = () => commitDraft(draft);

  const pick = (text: string) => {
    commitDraft(text);
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
        <div className="tag-combobox font-combobox">
          <input
            role="combobox"
            aria-label="Custom font family"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active ? `${listId}-opt-${highlight}` : undefined}
            value={draft}
            disabled={disabled}
            spellCheck={false}
            placeholder="IBM Plex Sans, system-ui, sans-serif"
            onFocus={() => {
              focused.current = true;
              setOpen(true);
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setOpen(true);
              setHighlight(-1);
            }}
            onBlur={saveDraft}
            onKeyDown={(event) => {
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length > 0) {
                event.preventDefault();
                setOpen(true);
                setHighlight((current) => {
                  if (event.key === "ArrowDown") return current < 0 ? 0 : Math.min(suggestions.length - 1, current + 1);
                  return current < 0 ? suggestions.length - 1 : Math.max(0, current - 1);
                });
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setHighlight(-1);
                return;
              }
              if ((event.key === "Tab" || event.key === "Enter") && active) {
                event.preventDefault();
                pick(active.kind === "create" ? active.text : active.tag);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          {open && suggestions.length > 0 ? (
            <ul className="tag-suggestions font-suggestions" id={listId} role="listbox" aria-label="Font suggestions">
              {suggestions.map((row, index) => {
                const selected = index === highlight;
                const id = `${listId}-opt-${index}`;
                const text = row.kind === "create" ? row.text : row.tag;
                return (
                  <li key={row.kind === "create" ? `create:${row.text}` : row.tag} id={id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={selected ? "is-active" : ""}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => pick(text)}
                    >
                      {row.kind === "create" ? (
                        <span>Create “{row.text}”</span>
                      ) : (
                        <span>
                          {tagMatchParts(row.tag, draft).map((part, partIndex) =>
                            part.match ? <mark key={partIndex}>{part.text}</mark> : <span key={partIndex}>{part.text}</span>,
                          )}
                        </span>
                      )}
                      {row.kind === "tag" ? (
                        <span className="tag-suggestion-count">
                          {row.count} {row.count === 1 ? "diagram" : "diagrams"}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p className="font-family-help">
        Fonts must be installed on the computer that views or renders the diagram. Separate fallbacks with commas.
        Custom suggests families already used in this workspace.
      </p>
    </div>
  );
}
