import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Brand } from "../components/Brand";
import { HeaderActions } from "../components/HeaderActions";
import { FolderPicker } from "../components/FolderPicker";
import { Modal } from "../components/Modal";
import { SourceThumbnail } from "../components/MermaidThumbnail";
import { useCommandHost } from "../components/commandPaletteContext";
import { usePageTitle } from "../hooks/usePageTitle";
import { pageTitle } from "../lib/pageTitle";
import { useWorkspace } from "../hooks/useWorkspace";
import { FileNameField } from "../components/FileNameField";
import { StylePresetChoice, type PresetChoice } from "../components/StylePresetChoice";
import { fileNameIssue } from "../lib/fileName";
import {
  TEMPLATE_CATEGORIES,
  folderInTree,
  groupTemplateSections,
  templateEditHref,
  templatePresentHref,
  uniqueSorted,
} from "../lib/templateGallery";
import { foldSections, sectionIsOpen, writeSectionOpen } from "../lib/templateSections";
import type { TemplateSummary } from "../types";
import { contentWithStyle } from "../lib/stylePresets";

export function TemplatesPage() {
  const navigate = useNavigate();
  usePageTitle(pageTitle("Template gallery"));
  const [searchParams, setSearchParams] = useSearchParams();
  const { tree, loading: treeLoading } = useWorkspace();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [diagramType, setDiagramType] = useState("");
  const [tag, setTag] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [namedFor, setNamedFor] = useState<string | null>(null);
  const [folderChoice, setFolderChoice] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState<PresetChoice>({ id: "", style: null });
  const [reloadKey, setReloadKey] = useState(0);
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});
  const [renameTarget, setRenameTarget] = useState<TemplateSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TemplateSummary | null>(null);
  const savingRef = useRef(false);
  const requestedFolder = searchParams.get("folder") ?? "";
  const folder =
    folderChoice ??
    (treeLoading || folderInTree(tree, requestedFolder) ? requestedFolder : "");

  useCommandHost({
    route: "other",
    actions: {
      newDiagram: () => navigate("/?new=diagram"),
    },
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
      .templates()
      .then((result) => {
        if (cancelled) return;
        setTemplates(result.templates);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load templates");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const types = useMemo(() => uniqueSorted(templates.map((item) => item.diagramType)), [templates]);
  const tags = useMemo(() => uniqueSorted(templates.flatMap((item) => item.tags)), [templates]);
  const sections = useMemo(
    () => groupTemplateSections(templates, { query, category, diagramType, tag }),
    [templates, query, category, diagramType, tag],
  );
  const filtering = Boolean(query.trim() || category || diagramType || tag);
  const requestedUse = searchParams.get("use") ?? "";
  const linked = templates.find((item) => item.id === requestedUse) ?? null;
  const picked = templates.find((item) => item.id === pickedId) ?? null;
  const selected = picked ?? linked;
  const unknownTemplate = !loading && requestedUse.length > 0 && !linked && !picked;
  if (selected && namedFor !== selected.id) {
    setNamedFor(selected.id);
    setName(selected.title);
    setDialogError(null);
  }

  const openUse = (template: TemplateSummary) => {
    setPreset({ id: "", style: null });
    setPickedId(template.id);
  };

  const closeDialog = () => {
    if (saving) return;
    setPickedId(null);
    setNamedFor(null);
    if (!searchParams.has("use")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("use");
    setSearchParams(next, { replace: true });
  };

  const create = async () => {
    if (!selected || savingRef.current) return;
    if (fileNameIssue(name, []).empty) {
      setDialogError("Enter a file name.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setDialogError(null);
    try {
      const result = await api.createFromTemplate(selected.id, { name, folder });
      if (preset.style) {
        const file = await api.readFile(result.path);
        const next = contentWithStyle(file.content, preset.style);
        if (next !== file.content) await api.writeFile(result.path, next, { force: true });
      }
      navigate(`/edit/${result.path}`);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Could not create the diagram");
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="reference-layout">
      <header className="reference-top">
        <div className="reference-top-left">
          <Link to="/" aria-label="NerdGram1337 dashboard">
            <Brand />
          </Link>
          <h1>Template gallery</h1>
        </div>
        <HeaderActions className="reference-top-actions header-actions" backToDashboard />
      </header>

      <main className="template-main">
        <p className="template-intro">
          Pick a starter. Use template copies it into a folder you choose and opens the copy in the
          editor. The original stays in the gallery.
        </p>
        {error || unknownTemplate ? (
          <div className="error-banner">{error || "That template is not available."}</div>
        ) : null}

        <div className="template-toolbar">
          <div className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, description, tags, category, or type"
              aria-label="Search templates"
            />
          </div>
          <label className="template-select">
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
              <option value="">All</option>
              {TEMPLATE_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="template-select">
            Diagram type
            <select
              value={diagramType}
              onChange={(event) => setDiagramType(event.target.value)}
              aria-label="Filter by diagram type"
            >
              <option value="">All</option>
              {types.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="template-select">
            Tag
            <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Filter by tag">
              <option value="">All</option>
              {tags.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <div className="tree-fold-control" role="group" aria-label="Template sections">
            <button
              type="button"
              className="tree-fold-button"
              disabled={sections.length === 0}
              onClick={() => {
                const next = foldSections(sections.map((section) => section.category), true, sectionOpen);
                setSectionOpen(next);
                for (const section of sections) writeSectionOpen(section.category, true);
              }}
            >
              Expand all
            </button>
            <button
              type="button"
              className="tree-fold-button"
              disabled={sections.length === 0}
              onClick={() => {
                const next = foldSections(sections.map((section) => section.category), false, sectionOpen);
                setSectionOpen(next);
                for (const section of sections) writeSectionOpen(section.category, false);
              }}
            >
              Collapse all
            </button>
          </div>
        </div>
        {!loading && !filtering ? (
          <nav className="template-jumps" aria-label="Template categories">
            {TEMPLATE_CATEGORIES.map((item) => (
              <a key={item} href={`#template-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                {item}
              </a>
            ))}
          </nav>
        ) : null}
        {loading ? <p>Loading templates…</p> : null}
        {!loading && sections.length === 0 ? (
          <div className="empty-state">No templates match that search.</div>
        ) : null}
        {!loading
          ? sections.map((section) => {
              const storedOpen = (() => {
                try {
                  const raw = localStorage.getItem(`nerdgram.templateSection.${section.category}`);
                  if (raw == null) return true;
                  return raw === "1";
                } catch {
                  return true;
                }
              })();
              const open = sectionIsOpen(section.category, filtering, sectionOpen, storedOpen);
              const sectionId = `template-${section.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
              return (
                <section key={section.category} className="template-section" id={sectionId} aria-labelledby={`${sectionId}-title`}>
                  <div className="template-section-head">
                    <button
                      type="button"
                      className="tree-chevron"
                      aria-expanded={open}
                      aria-controls={`${sectionId}-cards`}
                      onClick={() => {
                        const next = !open;
                        setSectionOpen((current) => ({ ...current, [section.category]: next }));
                        writeSectionOpen(section.category, next);
                      }}
                    >
                      <span className="visually-hidden">{open ? "Collapse" : "Expand"} {section.category}</span>
                    </button>
                    <h2 id={`${sectionId}-title`}>
                      {section.category} <span className="template-count">{section.templates.length}</span>
                    </h2>
                  </div>
                  {open ? (
                    <div id={`${sectionId}-cards`}>
                      {section.templates.length === 0 ? (
                        <div className="template-empty">
                          <span className="template-empty-icon" aria-hidden="true">
                            □
                          </span>
                          <p>No templates here yet</p>
                          {section.category === "User created" ? (
                            <p>Open a diagram and choose Create as template to add one here.</p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="card-grid">
                          {section.templates.map((template) => (
                            <article className="card template-card" key={template.id}>
                              <SourceThumbnail id={template.id} source={template.source} cacheKey={template.cacheKey} />
                              <div className="card-body">
                                <h3>{template.title}</h3>
                                <p className="card-description">
                                  {template.malformed
                                    ? template.error || "This template could not be read."
                                    : template.description}
                                </p>
                                <p className="template-meta">
                                  <span>{template.category || "General"}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{template.diagramType}</span>
                                </p>
                                {template.tags.length > 0 ? (
                                  <div className="tag-row">
                                    {template.tags.map((item) => (
                                      <span className="tag-chip" key={item}>
                                        {item}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="card-actions">
                                  <button type="button" className="btn btn-primary" onClick={() => openUse(template)}>
                                    Use template
                                  </button>
                                  <Link className="btn btn-ghost" to={templatePresentHref(template.id)}>
                                    Present
                                  </Link>
                                  {template.origin === "user" ? (
                                    <>
                                      <Link className="btn btn-ghost" to={templateEditHref(template.id)}>
                                        Edit
                                      </Link>
                                      <button
                                        type="button"
                                        className="btn btn-ghost"
                                        onClick={() => {
                                          setRenameTarget(template);
                                          setRenameValue(template.title);
                                        }}
                                      >
                                        Rename
                                      </button>
                                      <button type="button" className="btn btn-ghost" onClick={() => setDeleteTarget(template)}>
                                        Delete
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })
          : null}
      </main>

      {selected ? (
        <Modal
          className="modal-wide"
          title={`Use ${selected.title}`}
          confirmLabel={saving ? "Creating…" : "Create diagram"}
          onClose={closeDialog}
          onConfirm={() => void create()}
        >
          <p className="template-dialog-note">
            If that name is already in the folder, a number is added and the existing diagram is
            kept.
          </p>
          {dialogError ? <div className="error-banner">{dialogError}</div> : null}
          <FileNameField id="template-name" value={name} autoFocus onChange={setName} />
          <div className="template-folder-label">Folder</div>
          <FolderPicker tree={tree} value={folder} onChange={setFolderChoice} />
          <StylePresetChoice mode="template" onChange={setPreset} />
        </Modal>
      ) : null}
      {renameTarget ? (
        <Modal
          title={`Rename ${renameTarget.title}`}
          confirmLabel="Rename"
          onClose={() => setRenameTarget(null)}
          onConfirm={() => {
            void api.renameTemplate(renameTarget.id, renameValue).then(() => {
              setRenameTarget(null);
              setReloadKey((value) => value + 1);
            });
          }}
        >
          <label htmlFor="rename-template">Name</label>
          <input id="rename-template" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
        </Modal>
      ) : null}
      {deleteTarget ? (
        <Modal
          title={`Delete ${deleteTarget.title}`}
          confirmLabel="Delete"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            void api.deleteTemplate(deleteTarget.id).then(() => {
              setDeleteTarget(null);
              setReloadKey((value) => value + 1);
            });
          }}
        >
          <p>Delete this template? Diagrams already created from it stay where they are.</p>
        </Modal>
      ) : null}
    </div>
  );
}
