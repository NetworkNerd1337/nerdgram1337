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

/** Editor header path. The last segment is the file name, never the front matter title. */
export function EditorBreadcrumb({ filePath }: { filePath: string }) {
  const segments = editorBreadcrumb(filePath);
  const items = collapseBreadcrumb(segments);
  const full = fullBreadcrumbTitle(segments);
  return (
    <nav className="breadcrumb" aria-label="Folder path" title={full}>
      {items.map((item, index) => (
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
          ) : (
            <strong className="breadcrumb-current">{item.label}</strong>
          )}
        </span>
      ))}
    </nav>
  );
}
