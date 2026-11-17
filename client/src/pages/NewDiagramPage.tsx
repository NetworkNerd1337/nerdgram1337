import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Brand } from "../components/Brand";
import { CommandsButton } from "../components/CommandPalette";
import { SupportLink } from "../components/SupportLink";
import { FolderPicker } from "../components/FolderPicker";
import { useCommandHost } from "../components/commandPaletteContext";
import { useWorkspace } from "../hooks/useWorkspace";
import { FileNameField } from "../components/FileNameField";
import { fileNameIssue, suggestFileStem } from "../lib/fileName";
import { ensureMmd, flattenFiles, joinPath } from "../lib/paths";

const PLACEHOLDER = `%% Paste your Mermaid code
%% We'll render it with mermaid.js

flowchart LR
  A[Paste] --> B[Preview]
  B --> C[Export]`;

export function NewDiagramPage() {
  const navigate = useNavigate();
  const { tree } = useWorkspace();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [folder, setFolder] = useState("");
  const [nameHint, setNameHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useCommandHost({
    route: "new",
    actions: {},
    items: [],
    trashItems: [],
    hasPreview: false,
    autoUpdate: false,
    readOnly: false,
    conflictOpen: false,
  });

  const suggestion = useMemo(() => suggestFileStem(code), [code]);
  useEffect(() => {
    if (!nameTouched) setName(suggestion);
  }, [suggestion, nameTouched]);

  const taken = useMemo(
    () =>
      flattenFiles(tree)
        .filter((file) => {
          const parent = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
          return parent === folder;
        })
        .map((file) => file.name),
    [tree, folder],
  );
  const lineCount = useMemo(
    () => Math.max(1, (code || PLACEHOLDER).split("\n").length),
    [code],
  );

  const handleCreate = async () => {
    setError(null);
    const issue = fileNameIssue(name, taken);
    if (issue.empty) {
      setNameHint("Enter a file name before creating the diagram.");
      return;
    }
    setNameHint(null);
    setSaving(true);
    try {
      const content = code.trim()
        ? code
        : "flowchart TD\n  A[Start] --> B[Edit me]\n";
      const filename = ensureMmd(issue.suggestion);
      const path = joinPath(folder.trim(), filename);
      await api.writeFile(path, content);
      navigate(`/edit/${path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create diagram");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="paste-page">
      <div className="paste-shell">
        <header className="paste-top">
          <Link to="/">
            <Brand />
          </Link>
          <div className="paste-top-actions">
            <SupportLink />
            <CommandsButton />
          </div>
        </header>
        <h1>What do you want to diagram?</h1>
        <div className="paste-mode">
          <span aria-hidden="true">{`</>`}</span>
          Paste Mermaid code
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="paste-fields">
          <div>
            <FileNameField
              id="diagram-name"
              value={name}
              taken={taken}
              onChange={(value) => {
                setNameTouched(true);
                setName(value);
                setNameHint(null);
              }}
            />
            {nameHint ? <p className="file-name-hint">{nameHint}</p> : null}
          </div>
          <div>
            <span className="paste-label" id="diagram-folder-label">
              Folder
            </span>
            <FolderPicker tree={tree} value={folder} onChange={setFolder} />
          </div>
        </div>

        <div className="paste-box">
          <div className="line-gutter">
            {Array.from({ length: Math.min(lineCount, 40) }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            aria-label="Mermaid source"
          />
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => void handleCreate()}
            disabled={saving}
            style={{
              position: "absolute",
              right: "0.85rem",
              bottom: "0.85rem",
              width: 44,
              height: 44,
              borderRadius: "50%",
              padding: 0,
            }}
            aria-label="Create diagram"
            title="Create diagram"
          >
            ↑
          </button>
        </div>

        <div className="paste-actions">
          <Link className="btn btn-ghost" to="/">
            Back to dashboard
          </Link>
          <Link className="btn btn-ghost" to={`/templates?folder=${encodeURIComponent(folder)}`}>
            Browse templates
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleCreate()}
            disabled={saving}
          >
            {saving ? "Creating…" : "Start with pasted code"}
          </button>
        </div>
      </div>
    </div>
  );
}
