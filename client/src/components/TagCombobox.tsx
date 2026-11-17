import { useId, useMemo, useRef, useState } from "react";
import { suggestTags, tagMatchParts, type TagCount } from "../lib/tagSuggestions";

type TagComboboxProps = {
  catalog: readonly TagCount[];
  exclude?: readonly string[];
  disabled?: boolean;
  /** When false, a typed value that is not an existing tag is not offered. */
  allowCreate?: boolean;
  label?: string;
  placeholder?: string;
  onAdd: (tag: string) => void;
};

/**
 * Typeahead for tags. Up and Down move, Enter or Tab picks the highlighted
 * row, Escape closes, and Enter or comma with nothing highlighted keeps the
 * typed text.
 */
export function TagCombobox({
  catalog,
  exclude = [],
  disabled = false,
  allowCreate = true,
  label = "Add a tag",
  placeholder = "Add a tag",
  onAdd,
}: TagComboboxProps) {
  const listId = useId();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const rows = suggestTags(catalog, value, exclude);
    if (allowCreate) return rows;
    return rows.filter((row) => row.kind === "tag");
  }, [allowCreate, catalog, exclude, value]);

  const active = open && highlight >= 0 && highlight < suggestions.length ? suggestions[highlight] : null;

  const close = () => {
    setOpen(false);
    setHighlight(-1);
  };

  const pick = (tag: string) => {
    const text = tag.trim();
    if (!text || disabled) return;
    onAdd(text);
    setValue("");
    setHighlight(-1);
    setOpen(true);
    inputRef.current?.focus();
  };

  const pickHighlighted = () => {
    if (!active) return false;
    if (active.kind === "create") pick(active.text);
    else pick(active.tag);
    return true;
  };

  return (
    <div className="tag-combobox">
      <input
        ref={inputRef}
        className="tag-combobox-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active ? `${listId}-opt-${highlight}` : undefined}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => close(), 120);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlight((current) => {
              if (suggestions.length === 0) return -1;
              return current < 0 ? 0 : Math.min(suggestions.length - 1, current + 1);
            });
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setHighlight((current) => {
              if (suggestions.length === 0) return -1;
              return current < 0 ? suggestions.length - 1 : Math.max(0, current - 1);
            });
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
          }
          if (event.key === "Tab" && active) {
            event.preventDefault();
            pickHighlighted();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (pickHighlighted()) return;
            pick(value);
            return;
          }
          if (event.key === "," ) {
            event.preventDefault();
            pick(value);
          }
        }}
      />
      <button type="button" className="btn btn-ghost" disabled={disabled || !value.trim()} onClick={() => pick(value)}>
        Add
      </button>
      {open && suggestions.length > 0 ? (
        <ul className="tag-suggestions" id={listId} role="listbox" aria-label="Tag suggestions">
          {suggestions.map((row, index) => {
            const selected = index === highlight;
            const id = `${listId}-opt-${index}`;
            if (row.kind === "create") {
              return (
                <li key={`create:${row.text}`} id={id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={selected ? "is-active" : ""}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pick(row.text)}
                  >
                    Create “{row.text}”
                  </button>
                </li>
              );
            }
            return (
              <li key={row.tag} id={id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={selected ? "is-active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(row.tag)}
                >
                  <span>
                    {tagMatchParts(row.tag, value).map((part, partIndex) =>
                      part.match ? <mark key={partIndex}>{part.text}</mark> : <span key={partIndex}>{part.text}</span>,
                    )}
                  </span>
                  <span className="tag-suggestion-count">
                    {row.count} {row.count === 1 ? "diagram" : "diagrams"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
