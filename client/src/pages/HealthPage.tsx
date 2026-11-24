import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { HeaderActions } from "../components/HeaderActions";
import { RepairLinksDialog } from "../components/RepairLinksDialog";
import { Sidebar } from "../components/Sidebar";
import { WorkspaceShell } from "../components/WorkspaceShell";
import { useCommandHost } from "../components/commandPaletteContext";
import { useSidebarWidth } from "../hooks/useSidebarWidth";
import { useWorkspace } from "../hooks/useWorkspace";
import { findingsFromLint, groupDiagramChecks, mutedWarningNote, type DiagramCheckFinding } from "../lib/diagramChecks";
import { formatProblem } from "../lib/problemText";
import { usePageTitle } from "../hooks/usePageTitle";
import { pageTitle } from "../lib/pageTitle";
import { editorHref } from "../lib/diagramSearch";
import { displayName } from "../lib/paths";
import { readRecent, writeRecent, pruneRecent, type RecentEntry } from "../lib/recent";
import { EMPTY_BOOKMARKS } from "../lib/bookmarks";
import type { UnreadableDiagram } from "../../../server/src/readError.ts";
import { infoIssues } from "../lib/dataFolderNotice";
import type { DataHealthIssue } from "../types";
import { DataFolderNotes } from "../components/DataHealthNotice";

type SeverityFilter = "all" | "errors" | "warnings" | "unreadable" | "muted";

function browserStore(): Storage {
  return window.localStorage;
}

export function HealthPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sidebar = useSidebarWidth();
  const { tree, bookmarks, saveBookmarks, loading } = useWorkspace();
  const [recent, setRecent] = useState<RecentEntry[]>(() => readRecent(browserStore()));
  const [findings, setFindings] = useState<DiagramCheckFinding[] | null>(null);
  const [unreadable, setUnreadable] = useState<UnreadableDiagram[]>([]);
  const [muted, setMuted] = useState<string[]>([]);
  const [checked, setChecked] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [folder, setFolder] = useState("");
  const [query, setQuery] = useState(params.get("path") ?? "");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [repairOpen, setRepairOpen] = useState(false);
  const [pass, setPass] = useState(0);
  const [folderNotes, setFolderNotes] = useState<DataHealthIssue[]>([]);

  useCommandHost({
    route: "other",
    actions: {},
    items: [],
    trashItems: [],
    hasPreview: false,
    autoUpdate: false,
    readOnly: false,
    conflictOpen: false,
  });

  useEffect(() => {
    let cancelled = false;
    void api
      .doctor()
      .then((report) => {
        if (!cancelled) setFolderNotes(infoIssues(report.issues));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    void api.diagramLint().then(
      (result) => {
        if (cancelled) return;
        setFindings(findingsFromLint(result));
        setUnreadable(result.unreadable ?? []);
        setMuted(result.muted ?? []);
        setChecked(result.checked);
        setCheckedAt(result.cachedAt ?? new Date().toISOString());
        setError(null);
        setChecking(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not check the diagrams");
        setChecking(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pass]);

  const knownPaths = useMemo(() => {
    const paths = new Set<string>();
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        if (node.type === "file") paths.add(node.path);
        if (node.children) walk(node.children);
      }
    };
    walk(tree);
    return paths;
  }, [tree]);

  useEffect(() => {
    if (loading) return;
    const pruned = pruneRecent(readRecent(browserStore()), knownPaths);
    writeRecent(browserStore(), pruned);
    setRecent(pruned);
  }, [knownPaths, loading]);

  const folders = useMemo(() => {
    const names: string[] = [];
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        if (node.type === "folder") {
          names.push(node.path);
          if (node.children) walk(node.children);
        }
      }
    };
    walk(tree);
    return names.sort();
  }, [tree]);

  const inFolder = (filePath: string) => !folder || filePath === folder || filePath.startsWith(`${folder}/`);
  const matchesName = (filePath: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return filePath.toLowerCase().includes(needle) || displayName(filePath).toLowerCase().includes(needle);
  };

  const visibleFindings = (findings ?? []).filter((item) => {
    if (!inFolder(item.path) || !matchesName(item.path)) return false;
    if (severity === "errors") return item.severity === "error";
    if (severity === "warnings") return item.severity === "warning";
    if (severity === "unreadable" || severity === "muted") return false;
    return true;
  });
  const groups = groupDiagramChecks(visibleFindings).sort((a, b) => {
    const rank = (items: DiagramCheckFinding[]) => (items.some((item) => item.severity === "error") ? 0 : 1);
    const score = rank(a.findings) - rank(b.findings);
    return score !== 0 ? score : a.path.localeCompare(b.path);
  });
  const visibleUnreadable = unreadable.filter((item) => inFolder(item.path) && matchesName(item.path));
  const visibleMuted = muted.filter((item) => inFolder(item) && matchesName(item));
  const errorCount = (findings ?? []).filter((item) => item.severity === "error").length;
  const warningCount = (findings ?? []).filter((item) => item.severity === "warning").length;
  const attentionDiagrams = new Set((findings ?? []).map((item) => item.path)).size;
  usePageTitle(pageTitle("Diagram health"));
  const showUnreadable = severity === "all" || severity === "unreadable";
  const showMuted = severity === "all" || severity === "muted";
  const showFindings = severity !== "unreadable" && severity !== "muted";
  const nothing =
    findings != null &&
    visibleFindings.length === 0 &&
    (severity === "unreadable" ? visibleUnreadable.length === 0 : true) &&
    (severity === "muted" ? visibleMuted.length === 0 : true) &&
    (severity === "all" ? visibleUnreadable.length === 0 : true);
  const canRepair = (findings ?? []).some((item) => item.ruleId === "broken-click");
  const allCollapsed = groups.length > 0 && groups.every((group) => collapsed.has(group.path));
  const noneCollapsed = collapsed.size === 0;

  return (
    <WorkspaceShell
      width={sidebar}
      sidebar={
        <Sidebar
          tree={tree}
          bookmarks={bookmarks ?? EMPTY_BOOKMARKS}
          onBookmarks={(next) => void saveBookmarks(next)}
          knownPaths={knownPaths}
          recent={recent}
          onClearRecent={() => {
            writeRecent(browserStore(), []);
            setRecent([]);
          }}
          attentionCount={findings == null ? null : attentionDiagrams}
          currentFolder="__health__"
          healthActive
          search=""
          onSearch={() => navigate("/")}
          onSelectFolder={(path) => navigate(path ? `/?folder=${encodeURIComponent(path)}` : "/")}
          onOpenTrash={() => navigate("/")}
        />
      }
    >
      <main className="health-page">
        <header className="health-head">
          <div>
            <h1>Diagram health</h1>
            <p className="reference-meta">Every diagram in the library, checked when you open this page.</p>
          </div>
          <HeaderActions className="header-actions">
            <Link className="btn btn-ghost" to="/settings#diagram-checks">
              Rule settings
            </Link>
          </HeaderActions>
        </header>
        <DataFolderNotes notes={folderNotes} />
        <section className="health-strip" aria-label="Check summary">
          <span>{checked == null ? "—" : checked} checked</span>
          <span>{findings == null ? "—" : errorCount} errors</span>
          <span>{findings == null ? "—" : warningCount} warnings</span>
          <span>{findings == null ? "—" : unreadable.length} unreadable</span>
          <span>{findings == null ? "—" : muted.length} muted</span>
          <span>{checking ? "Checking…" : checkedAt ? `Last checked ${new Date(checkedAt).toLocaleString()}` : "Not checked yet"}</span>
          <button type="button" className="btn btn-primary" onClick={() => setPass((value) => value + 1)} disabled={checking}>
            Check again
          </button>
        </section>
        <div className="health-filters">
          <label>
            Severity
            <select aria-label="Severity" value={severity} onChange={(event) => setSeverity(event.target.value as SeverityFilter)}>
              <option value="all">All</option>
              <option value="errors">Errors</option>
              <option value="warnings">Warnings</option>
              <option value="unreadable">Unreadable</option>
              <option value="muted">Muted</option>
            </select>
          </label>
          <label>
            Folder
            <select aria-label="Folder" value={folder} onChange={(event) => setFolder(event.target.value)}>
              <option value="">All folders</option>
              {folders.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="health-search">
            Name
            <input aria-label="Filter by name" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name" />
          </label>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        {findings == null && !checking ? (
          <div className="empty-state">
            <p>Not checked yet.</p>
          </div>
        ) : null}
        {findings != null && nothing && !checking ? (
          <div className="empty-state attention-clear">
            <span className="attention-check" aria-hidden="true">
              ✓
            </span>
            <p>Every diagram looks good.</p>
          </div>
        ) : null}
        {groups.length > 0 && showFindings ? (
          <div className="health-groups-head">
            <div className="tree-fold-control" role="group" aria-label="Finding groups">
              <button
                type="button"
                className="tree-fold-button"
                aria-disabled={noneCollapsed}
                onClick={() => {
                  if (!noneCollapsed) setCollapsed(new Set());
                }}
              >
                Expand all
              </button>
              <button
                type="button"
                className="tree-fold-button"
                aria-disabled={allCollapsed}
                onClick={() => {
                  if (!allCollapsed) setCollapsed(new Set(groups.map((group) => group.path)));
                }}
              >
                Collapse all
              </button>
            </div>
            {canRepair ? (
              <button type="button" className="btn btn-ghost" onClick={() => setRepairOpen(true)}>
                Repair links
              </button>
            ) : null}
          </div>
        ) : null}
        {showUnreadable && visibleUnreadable.length > 0 ? (
          <ul className="diagram-checks-unreadable">
            {visibleUnreadable.map((item) => (
              <li key={item.path}>{item.message}</li>
            ))}
          </ul>
        ) : null}
        {showMuted && visibleMuted.length > 0 ? (
          <p className="muted-warnings-note">
            {mutedWarningNote(visibleMuted.length)}{" "}
            {visibleMuted.map((item) => (
              <Link key={item} to={editorHref(item, 1, "")}>
                {displayName(item)}
              </Link>
            ))}
          </p>
        ) : null}
        {showFindings
          ? groups.map((group) => {
              const open = !collapsed.has(group.path);
              return (
                <section key={group.path} className="health-group">
                  <button
                    type="button"
                    className="health-group-toggle"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group.path)) next.delete(group.path);
                        else next.add(group.path);
                        return next;
                      })
                    }
                  >
                    {displayName(group.path)}
                    <span>{group.path}</span>
                  </button>
                  {open ? (
                    <ul>
                      {group.findings.map((item, index) => {
                        const view = formatProblem(item);
                        return (
                        <li key={`${item.ruleId}-${item.line}-${index}`}>
                          <Link to={editorHref(item.path, item.line, "")} title={view.title || undefined}>
                            <span className={`diagram-checks-severity ${item.severity}`}>
                              {item.severity === "error" ? "Error" : "Warning"}
                            </span>
                            <span>{view.where}</span>
                            <span>{view.message}</span>
                          </Link>
                        </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </section>
              );
            })
          : null}
        {repairOpen ? (
          <RepairLinksDialog
            onClose={() => setRepairOpen(false)}
            onApplied={() => {
              setRepairOpen(false);
              setPass((value) => value + 1);
            }}
          />
        ) : null}
      </main>
    </WorkspaceShell>
  );
}
