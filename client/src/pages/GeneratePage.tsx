import { useReducer, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { Brand } from "../components/Brand";
import { CommandsButton } from "../components/CommandPalette";
import { SupportLink } from "../components/SupportLink";
import { FolderPicker } from "../components/FolderPicker";
import { GenerateWizard } from "../components/GenerateWizard";
import { StylePresetChoice, type PresetChoice } from "../components/StylePresetChoice";
import { useCommandHost } from "../components/commandPaletteContext";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  diagramFilePath,
  initialWizardState,
  previewRequest,
  wizardReducer,
  type WizardInspection,
} from "../lib/generateWizard";
import { contentWithStyle } from "../lib/stylePresets";

export function GeneratePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { tree } = useWorkspace();
  const [state, dispatch] = useReducer(wizardReducer, params.get("folder") ?? "", initialWizardState);
  const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState<PresetChoice>({ id: "", style: null });

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

  const inspect = async (step: "map" | "preview") => {
    setBusy(true);
    dispatch({ type: "fatal", message: "" });
    try {
      const result = await api.previewGenerate(previewRequest(state));
      dispatch({ type: "result", result: result as WizardInspection, step });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read that data.";
      const rows = err instanceof ApiError && err.errors?.length ? ` ${err.errors.map((item) => item.message).join(" ")}` : "";
      dispatch({ type: "fatal", message: `${message}${rows}`.trim() });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const request = previewRequest(state);
      const created = await api.createGenerate({
        ...request,
        path: diagramFilePath(state),
        storeData: true,
        dataName: request.sourceFile,
      });
      if (preset.style) {
        const next = contentWithStyle(created.mermaid, preset.style);
        if (next !== created.mermaid) await api.writeFile(created.path, next, { force: true });
      }
      navigate(`/edit/${created.path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the diagram.";
      const rows = err instanceof ApiError && err.errors?.length ? ` ${err.errors.map((item) => item.message).join(" ")}` : "";
      dispatch({ type: "fatal", message: `${message}${rows}`.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="paste-page">
      <div className="paste-shell generate-shell">
        <header className="paste-top">
          <Link to="/">
            <Brand />
          </Link>
          <div className="paste-top-actions">
            <SupportLink />
            <CommandsButton />
          </div>
        </header>
        <h1>Generate a diagram from data</h1>
        <p className="generate-lead">
          Paste a links table, a list of nodes and edges, Cisco CDP, LLDP neighbor output, or network JSON.
          Network JSON draws a Layer 3 or Layer 2 view. The diagram stays tied to that data file so it can be
          refreshed.
        </p>
        <GenerateWizard
          state={state}
          dispatch={dispatch}
          busy={busy}
          folderControl={<FolderPicker tree={tree} value={state.folder} onChange={(folder) => dispatch({ type: "meta", folder })} />}
          styleControl={<StylePresetChoice mode="create" onChange={setPreset} />}
          onInspect={(step) => void inspect(step)}
          onCreate={() => void create()}
        />
        <div className="paste-actions">
          <Link className="btn btn-ghost" to="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
