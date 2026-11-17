import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  collapseBreadcrumb,
  editorBreadcrumb,
  fullBreadcrumbTitle,
  type BreadcrumbItem,
} from "../lib/editorBreadcrumb";

function itemKey(item: BreadcrumbItem, index: number): string {
  if ("kind" in item) return `ellipsis-${index}`;
  return `${item.href ?? "file"}:${item.label}`;
}

type EditorBreadcrumbProps = {
  filePath: string;
  /** When set, the trail is Templates / User created / name instead of the file path. */
  templateName?: string | null;
  renaming?: boolean;
  renameValue?: string;
  onRenameValue?: (value: string) => void;
  onStartRename?: () => void;
  onCommitRename?: () => void;
  onCancelRename?: () => void;
};

/** Editor header path. The last segment is the file name, never the front matter title. */
export function EditorBreadcrumb({
  filePath,
  templateName = null,
  renaming = false,
  renameValue = "",
  onRenameValue,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: EditorBreadcrumbProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const segments = templateName
    ? [
        { label: "Templates", href: "/templates" },
        { label: "User created", href: "/templates" },
        { label: templateName, href: null },
      ]
    : editorBreadcrumb(filePath);
  const items = collapseBreadcrumb(segments);
  const full = fullBreadcrumbTitle(segments);
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);
  return (
    <nav className="breadcrumb" aria-label="Folder path" title={full}>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <span className="breadcrumb-part" key={itemKey(item, index)}>
            {index > 0 ? (
              <span className="breadcrumb-sep" aria-hidden="true">
                /
              </span>
            ) : null}
            {"kind" in item ? (
              <span className="breadcrumb-ellipsis" title={item.title} aria-hidden="true">
                …
              </span>
            ) : item.href ? (
              <Link to={item.href}>{item.label}</Link>
            ) : renaming && last ? (
              <form
                className="breadcrumb-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  onCommitRename?.();
                }}
              >
                <input
                  ref={inputRef}
                  aria-label="File name"
                  value={renameValue}
                  onChange={(event) => onRenameValue?.(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelRename?.();
                    }
                  }}
                  onBlur={() => onCommitRename?.()}
                />
              </form>
            ) : (
              <button type="button" className="breadcrumb-current" onClick={() => onStartRename?.()}>
                {item.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
