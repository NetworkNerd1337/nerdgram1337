import { useEffect, useReducer, useState } from "react";
import { IMPORT_DATA_KEY } from "../lib/importRecognize";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { Brand } from "../components/Brand";
import { HeaderActions } from "../components/HeaderActions";
import { FolderPicker } from "../components/FolderPicker";
import { GenerateWizard } from "../components/GenerateWizard";
import { StylePresetChoice, type PresetChoice } from "../components/StylePresetChoice";
import { useCommandHost } from "../components/commandPaletteContext";
import { usePageTitle } from "../hooks/usePageTitle";
import { pageTitle } from "../lib/pageTitle";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  diagramFilePath,
  initialWizardState,
  previewRequest,
  wizardReducer,
  type MapperWarning,
  type TranslatorChoice,
  type WizardInspection,
  type WizardState,
} from "../lib/generateWizard";
import { contentWithStyle } from "../lib/stylePresets";
import { applyDiagramPatch } from "../lib/frontMatter";

export function GeneratePage() {
  const navigate = useNavigate();
  usePageTitle(pageTitle("Generate"));
  const [params] = useSearchParams();
  const { tree } = useWorkspace();
  const [state, dispatch] = useReducer(wizardReducer, params.get("folder") ?? "", initialWizardState);
  const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState<PresetChoice>({ id: "", style: null });
  const [translators, setTranslators] = useState<TranslatorChoice[]>([]);

  useEffect(() => {
    const raw = sessionStorage.getItem(IMPORT_DATA_KEY);
    if (!raw) return;
    sessionStorage.removeItem(IMPORT_DATA_KEY);
    try {
      const payload = JSON.parse(raw) as { text?: string; fileName?: string; format?: WizardState["format"] };
      if (typeof payload.text === "string" && payload.text) {
        dispatch({ type: "text", text: payload.text, fileName: payload.fileName });
        if (payload.format && payload.format !== "auto") dispatch({ type: "format", format: payload.format });
      }
    } catch {
      // A bad handoff is ignored. The page still opens empty.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .listTranslators()
      .then((body) => {
        if (!cancelled) setTranslators(body.translators);
      })
      .catch(() => {
        if (!cancelled) setTranslators([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const inspect = async (step: "map" | "preview", patch?: { documentText: string; mapperWarnings: MapperWarning[] }) => {
    setBusy(true);
    dispatch({ type: "fatal", message: "" });
    try {
      const current: WizardState = patch
        ? { ...state, documentText: patch.documentText, mapperWarnings: patch.mapperWarnings }
        : state;
      const result = await api.previewGenerate(previewRequest(current));
      const mapper = (patch?.mapperWarnings ?? current.mapperWarnings).map((warning) => ({
        path: warning.path,
        message: warning.message,
        row: 0,
      }));
      dispatch({
        type: "result",
        result: { ...(result as WizardInspection), warnings: [...mapper, ...result.warnings] },
        step,
      });
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
      let next = created.mermaid;
      if (preset.style) next = contentWithStyle(next, preset.style);
      if (state.hubLayout === "compact" || state.hubLayout === "radial") {
        const patched = applyDiagramPatch(next, { hubLayout: state.hubLayout });
        if (patched.ok) next = patched.source;
      }
      if (next !== created.mermaid) await api.writeFile(created.path, next, { force: true });
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
          <HeaderActions className="paste-top-actions header-actions" backToDashboard />
        </header>
        <h1>Generate a diagram from data</h1>
        <p className="entry-lead">
          Paste a links table, a list of nodes and edges, Cisco CDP, LLDP neighbor output, a Cisco routing table, ARP and MAC tables, or network JSON.
          Network JSON draws a Layer 3 or Layer 2 view. The diagram stays tied to that data file so it can be
          refreshed.
        </p>
        <GenerateWizard
          state={state}
          dispatch={dispatch}
          busy={busy}
          translators={translators}
          folderControl={<FolderPicker tree={tree} value={state.folder} onChange={(folder) => dispatch({ type: "meta", folder })} />}
          styleControl={<StylePresetChoice mode="create" onChange={setPreset} />}
          onConvert={async (id, text) => {
            let body: unknown;
            try {
              body = JSON.parse(text) as unknown;
            } catch {
              throw new Error("The export is not valid JSON.");
            }
            const converted = await api.convertTranslator(id, body);
            return {
              documentText: JSON.stringify(converted.document),
              mapperWarnings: converted.warnings,
            };
          }}
          onInspect={(step, patch) => void inspect(step, patch)}
          onCreate={() => void create()}
        />
      </div>
    </div>
  );
}
