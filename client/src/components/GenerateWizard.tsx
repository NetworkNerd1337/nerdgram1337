import { useState, type Dispatch, type ReactNode } from "react";
import { largeImportAdvice } from "../lib/largeImport";
import type { FlowDirection, NetworkView } from "../../../server/src/diagramData.ts";
import {
  canCreate,
  canInspect,
  edgeFields,
  fieldsFor,
  isNeighborSource,
  isRouteSource,
  isNetworkSource,
  issueListTitle,
  listedIssueText,
  noticeStorageKey,
  showEdgeFields,
  translatorDocsHref,
  type MapperWarning,
  type TranslatorChoice,
  type WizardAction,
  type WizardGroupBy,
  type WizardState,
} from "../lib/generateWizard";

const DIRECTIONS: { value: FlowDirection; label: string }[] = [
  { value: "LR", label: "Left to right" },
  { value: "TD", label: "Top to bottom" },
  { value: "RL", label: "Right to left" },
  { value: "BT", label: "Bottom to top" },
];

type GenerateWizardProps = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  busy: boolean;
  translators?: readonly TranslatorChoice[];
  folderControl?: ReactNode;
  styleControl?: ReactNode;
  onConvert?: (id: string, text: string) => Promise<{ documentText: string; mapperWarnings: MapperWarning[] }>;
  onInspect: (step: "map" | "preview", patch?: { documentText: string; mapperWarnings: MapperWarning[] }) => void;
  onCreate: () => void;
};

export function GenerateWizard({
  state,
  dispatch,
  busy,
  translators = [],
  folderControl,
  styleControl,
  onConvert,
  onInspect,
  onCreate,
}: GenerateWizardProps) {
  const fields = fieldsFor(state);
  const neighbor = isNeighborSource(state);
  const route = isRouteSource(state);
  const network = isNetworkSource(state);
  const translator = translators.find((item) => item.id === state.translatorId) ?? null;
  const [converting, setConverting] = useState(false);

  const continueFromData = () => {
    void (async () => {
      let patch: { documentText: string; mapperWarnings: MapperWarning[] } | undefined;
      if (translator && !state.documentText) {
        if (!onConvert) {
          dispatch({ type: "fatal", message: "Could not convert that export." });
          return;
        }
        setConverting(true);
        try {
          const converted = await onConvert(translator.id, state.text);
          dispatch({ type: "translatorResult", documentText: converted.documentText, mapperWarnings: converted.mapperWarnings });
          patch = converted;
        } catch (err) {
          dispatch({ type: "fatal", message: err instanceof Error ? err.message : "Could not convert that export." });
          return;
        } finally {
          setConverting(false);
        }
      } else if (translator && state.documentText) {
        patch = { documentText: state.documentText, mapperWarnings: state.mapperWarnings };
      }
      onInspect("map", patch);
    })();
  };
  return (
    <div className="generate-wizard">
      <ol className="generate-steps" aria-label="Steps">
        <li className={state.step === "input" ? "active" : ""}>Data</li>
        <li className={state.step === "map" ? "active" : ""}>{neighbor || route || network ? "Options" : "Columns"}</li>
        <li className={state.step === "preview" ? "active" : ""}>Preview</li>
      </ol>

      {state.fatal ? <div className="error-banner">{state.fatal}</div> : null}
      <IssueList title={issueListTitle(state.translatorId ? "network" : state.format, state.detectedFormat)} issues={state.errors} />
      {state.step !== "input" ? <IssueList title="Warnings" issues={state.warnings} /> : null}

      {state.step === "input" ? (
        <div className="generate-panel">
          <label htmlFor="generate-format">Source</label>
          <select
            id="generate-format"
            value={state.translatorId ? `translator:${state.translatorId}` : state.format}
            onChange={(event) => {
              const value = event.target.value;
              if (value.startsWith("translator:")) dispatch({ type: "translator", id: value.slice("translator:".length) });
              else dispatch({ type: "format", format: value as WizardState["format"] });
            }}
          >
            <option value="auto">Auto-detect</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="network">Network data (JSON)</option>
            <option value="cdp">Cisco CDP</option>
            <option value="lldp">LLDP neighbors</option>
            <option value="route">Routing table</option>
            {translators.map((item) => (
              <option key={item.id} value={`translator:${item.id}`}>
                {item.name}
              </option>
            ))}
          </select>
          {!translator && state.format === "auto" ? (
            <p className="generate-hint">CSV, JSON, network JSON, Cisco CDP, LLDP neighbors, or a Cisco routing table.</p>
          ) : null}
          {translator ? <DataNotice translator={translator} /> : null}
          {translator ? <p className="generate-hint">{translator.formatHint}</p> : null}
          <label htmlFor="generate-data">{translator ? translator.name : dataLabel(state.format)}</label>
          <textarea
            id="generate-data"
            value={state.text}
            onChange={(event) => dispatch({ type: "text", text: event.target.value })}
            spellCheck={false}
            rows={12}
            placeholder={translator ? translator.placeholder : dataPlaceholder(state.format)}
          />
          <label className="generate-file">
            Upload a file
            <input
              type="file"
              accept=".csv,.json,.network.json,.cdp,.lldp,.route,.txt,text/csv,application/json,text/plain"
              aria-label="Upload data file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void file.text().then((text) => dispatch({ type: "text", text, fileName: file.name }));
              }}
            />
          </label>
          {translator ? <NetworkOptions state={state} dispatch={dispatch} /> : null}
          {!translator && (state.format === "cdp" || state.format === "lldp" || state.format === "network" || state.format === "route") ? (
            <label htmlFor="generate-local-device">
              Local device name
              <input
                id="generate-local-device"
                value={state.localDevice}
                onChange={(event) => dispatch({ type: "localDevice", localDevice: event.target.value })}
                placeholder={
                  state.format === "network"
                    ? "Used when embedded CDP or LLDP has no hostname prompt"
                    : "Used when the output has no hostname prompt"
                }
              />
            </label>
          ) : null}
          {!translator && state.format === "network" ? <NetworkOptions state={state} dispatch={dispatch} /> : null}
          {state.format === "route" ? <RouteHostOptions state={state} dispatch={dispatch} /> : null}
          {translator || state.format === "cdp" || state.format === "lldp" || state.format === "network" || state.format === "route" ? null : (
            <>
              <label htmlFor="generate-edges">Edges file, if the first file is only nodes</label>
              <textarea
                id="generate-edges"
                value={state.edgesText}
                onChange={(event) => dispatch({ type: "edges", text: event.target.value })}
                spellCheck={false}
                rows={5}
                placeholder="source,target,label"
              />
            </>
          )}
          <div className="generate-actions">
            <button type="button" className="btn btn-primary" disabled={!canInspect(state) || busy || converting} onClick={continueFromData}>
              {busy || converting ? "Reading…" : "Continue"}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === "map" ? (
        <div className="generate-panel">
          {route ? (
            <>
              <label htmlFor="generate-route-device">
                Local device name
                <input
                  id="generate-route-device"
                  value={state.localDevice}
                  onChange={(event) => dispatch({ type: "localDevice", localDevice: event.target.value })}
                  placeholder="Used when the paste has no hostname prompt"
                />
              </label>
              <RouteHostOptions state={state} dispatch={dispatch} />
            </>
          ) : neighbor ? (
            <>
              <label htmlFor="generate-local-device">
                Local device name
                <input
                  id="generate-local-device"
                  value={state.localDevice}
                  onChange={(event) => dispatch({ type: "localDevice", localDevice: event.target.value })}
                  placeholder="Used when the output has no hostname prompt"
                />
              </label>
              <label htmlFor="generate-group-by">Group by</label>
              <select
                id="generate-group-by"
                value={state.groupBy}
                disabled={!state.grouping}
                onChange={(event) => dispatch({ type: "groupBy", groupBy: event.target.value as WizardGroupBy })}
              >
                <option value="platform">Platform</option>
                <option value="capability">Capability</option>
              </select>
            </>
          ) : network ? (
            <NetworkOptions state={state} dispatch={dispatch} />
          ) : (
            <>
          <label htmlFor="generate-shape">Data shape</label>
          <select
            id="generate-shape"
            value={state.shape}
            onChange={(event) => dispatch({ type: "shape", shape: event.target.value as WizardState["shape"] })}
          >
            <option value="auto">Detected ({state.detectedShape || "unknown"})</option>
            <option value="links">Links table</option>
            <option value="nodes">Nodes</option>
            <option value="graph">Nodes and edges</option>
            <option value="edges">Edges</option>
          </select>
          <div className="generate-map">
            {fields.map((field) => (
              <label key={field.field} htmlFor={`map-${field.field}`}>
                {field.label}
                {field.required ? " (required)" : ""}
                <select
                  id={`map-${field.field}`}
                  value={state.mapping[field.field] ?? ""}
                  onChange={(event) => dispatch({ type: "mapping", field: field.field, column: event.target.value })}
                >
                  <option value="">Ignore</option>
                  {state.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {!neighbor && showEdgeFields(state) ? (
            <div className="generate-map">
              {edgeFields().map((field) => (
                <label key={field.field} htmlFor={`edge-${field.field}`}>
                  Edge {field.label.toLowerCase()}
                  {field.required ? " (required)" : ""}
                  <select
                    id={`edge-${field.field}`}
                    value={state.edgesMapping[field.field] ?? ""}
                    onChange={(event) =>
                      dispatch({ type: "edgesMapping", field: field.field, column: event.target.value })
                    }
                  >
                    <option value="">Ignore</option>
                    {state.edgesHeaders.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
            </>
          )}
          <label htmlFor="generate-direction">Direction</label>
          <select
            id="generate-direction"
            value={state.direction === "TB" ? "TD" : state.direction}
            onChange={(event) => dispatch({ type: "direction", direction: event.target.value as FlowDirection })}
          >
            {DIRECTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <label className="generate-check" htmlFor="generate-grouping">
            <input
              id="generate-grouping"
              type="checkbox"
              checked={state.grouping}
              onChange={(event) => dispatch({ type: "grouping", grouping: event.target.checked })}
            />
            {neighbor || network ? "Group devices" : "Groups become subgraphs"}
          </label>
          <div className="generate-actions">
            <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: "back" })}>
              Back
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onInspect("preview")}>
              {busy ? "Building…" : "Preview"}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === "preview" ? (
        <div className="generate-panel">
          <div className="paste-fields">
            <div>
              <label htmlFor="generate-name">File name</label>
              <div className="file-name-row">
                <input
                  id="generate-name"
                  value={state.diagramName}
                  placeholder="Campus core"
                  aria-required="true"
                  onChange={(event) => dispatch({ type: "meta", diagramName: event.target.value })}
                />
                <span className="file-name-suffix" aria-hidden="true">.mmd</span>
              </div>
              {state.diagramName.trim() ? null : (
                <p className="file-name-hint">Enter a file name. A diagram is not created until this is filled in.</p>
              )}
            </div>
            <div>
              <label htmlFor="generate-title">Title</label>
              <input
                id="generate-title"
                value={state.title}
                onChange={(event) => dispatch({ type: "meta", title: event.target.value })}
              />
            </div>
            <div>
              <span className="paste-label" id="generate-folder-label">
                Folder
              </span>
              {folderControl ?? (
                <input
                  aria-labelledby="generate-folder-label"
                  value={state.folder}
                  onChange={(event) => dispatch({ type: "meta", folder: event.target.value })}
                />
              )}
            </div>
          </div>
          {styleControl}
          <p className="generate-counts">
            {state.counts.nodes} nodes, {state.counts.edges} edges
            {state.counts.groups > 0 ? `, ${state.counts.groups} groups` : ""}
          </p>
          <LargeImportChoice state={state} dispatch={dispatch} />
          <label htmlFor="generate-preview">Mermaid preview</label>
          <textarea id="generate-preview" readOnly value={state.mermaid} spellCheck={false} rows={16} />
          <div className="generate-actions">
            <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: "back" })}>
              Back
            </button>
            <button type="button" className="btn btn-primary" disabled={!canCreate(state) || busy} onClick={onCreate}>
              {busy ? "Creating…" : "Create diagram"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LargeImportChoice({ state, dispatch }: { state: WizardState; dispatch: Dispatch<WizardAction> }) {
  const advice = largeImportAdvice(state.mermaid, state.counts.nodes);
  if (!advice) return null;
  return (
    <fieldset className="generate-large">
      <legend>Large diagram</legend>
      <p>{advice.message}</p>
      <label className="generate-choice">
        <input
          type="radio"
          name="hub-layout"
          checked={state.hubLayout === ""}
          onChange={() => dispatch({ type: "hubLayout", hubLayout: "" })}
        />
        Default rank
      </label>
      <label className="generate-choice">
        <input
          type="radio"
          name="hub-layout"
          checked={state.hubLayout === "compact"}
          onChange={() => dispatch({ type: "hubLayout", hubLayout: "compact" })}
        />
        Compact hub layout
      </label>
      <label className="generate-choice">
        <input
          type="radio"
          name="hub-layout"
          checked={state.hubLayout === "radial"}
          onChange={() => dispatch({ type: "hubLayout", hubLayout: "radial" })}
        />
        Radial hub layout
      </label>
    </fieldset>
  );
}

function NetworkOptions({ state, dispatch }: { state: WizardState; dispatch: Dispatch<WizardAction> }) {
  const layer3 = state.view === "l3";
  return (
    <>
      <label htmlFor="generate-view">View</label>
      <select
        id="generate-view"
        value={state.view}
        onChange={(event) => dispatch({ type: "view", view: event.target.value as NetworkView })}
      >
        <option value="l3">Layer 3 (subnets)</option>
        <option value="l2">Layer 2 (VLANs and trunks)</option>
      </select>
      <label className="generate-check" htmlFor="generate-include-down">
        <input
          id="generate-include-down"
          type="checkbox"
          checked={state.includeDown}
          onChange={(event) => dispatch({ type: "includeDown", includeDown: event.target.checked })}
        />
        Include shutdown or down interfaces
      </label>
      <label htmlFor="generate-network-group">Group by</label>
      <select
        id="generate-network-group"
        value={state.groupBy}
        disabled={!state.grouping}
        onChange={(event) => dispatch({ type: "groupBy", groupBy: event.target.value as WizardGroupBy })}
      >
        <option value="">None</option>
        {layer3 ? <option value="vrf">VRF</option> : null}
        {layer3 ? null : <option value="site">Site</option>}
        {layer3 ? null : <option value="role">Role</option>}
        {layer3 ? null : <option value="platform">Platform</option>}
      </select>
      {layer3 ? null : (
        <label htmlFor="generate-vlan">
          VLAN filter
          <input
            id="generate-vlan"
            inputMode="numeric"
            value={state.vlan}
            placeholder="All VLANs"
            onChange={(event) => dispatch({ type: "vlan", vlan: event.target.value })}
          />
        </label>
      )}
    </>
  );
}

function readDismissed(id: string): boolean {
  try {
    return localStorage.getItem(noticeStorageKey(id)) === "1";
  } catch {
    return false;
  }
}

function DataNotice({ translator }: { translator: TranslatorChoice }) {
  const [dismissedId, setDismissedId] = useState("");
  if (readDismissed(translator.id) || dismissedId === translator.id) return null;
  const source = translator.name;
  return (
    <aside className="data-notice" role="note">
      <div className="data-notice-title">
        <svg className="data-notice-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 9.2v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="10" cy="6.2" r="0.9" fill="currentColor" />
        </svg>
        <strong>Your diagram reflects your data</strong>
      </div>
      <p>
        NerdGram draws exactly what this {source} export describes. Devices or links the source doesn't know about won't
        appear. For a fuller topology, enrich the data in {source} first, for example by adding LLDP or CDP links to a
        Batfish snapshot.
      </p>
      <div className="data-notice-actions">
        <a href={translatorDocsHref(source)} target="_blank" rel="noopener noreferrer">
          Translator tips
        </a>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            try {
              localStorage.setItem(noticeStorageKey(translator.id), "1");
            } catch {
              // Dismissal still applies for this view when storage is blocked.
            }
            setDismissedId(translator.id);
          }}
        >
          Don't show again
        </button>
      </div>
    </aside>
  );
}

function RouteHostOptions({ state, dispatch }: { state: WizardState; dispatch: Dispatch<WizardAction> }) {
  return (
    <label htmlFor="generate-hosts">
      Hosts
      <select
        id="generate-hosts"
        value={state.hosts}
        onChange={(event) => dispatch({ type: "hosts", hosts: event.target.value as WizardState["hosts"] })}
      >
        <option value="ports">On switchports</option>
        <option value="port-counts">Counts per port</option>
        <option value="vlan-counts">Counts per VLAN</option>
      </select>
      <span className="generate-hint">
        ARP and a MAC address table place hosts. ARP alone does not draw links. A port with many MACs stays an uplink. Counts keep a large access layer from becoming a starburst.
      </span>
    </label>
  );
}

function dataLabel(format: WizardState["format"]): string {
  if (format === "cdp") return "Cisco CDP output";
  if (format === "lldp") return "LLDP neighbor output";
  if (format === "route") return "Routing table";
  if (format === "network") return "Network data (JSON)";
  if (format === "json") return "JSON";
  if (format === "csv") return "CSV";
  return "Data";
}

function dataPlaceholder(format: WizardState["format"]): string {
  if (format === "cdp") {
    return "core-sw#show cdp neighbors detail\nDevice ID: dist-sw\nInterface: Gi1/0/1, Port ID (outgoing port): Gi1/0/48";
  }
  if (format === "lldp") {
    return "core-sw#show lldp neighbors detail\nLocal Intf: Gi1/0/1\nPort id: Gi1/0/48\nSystem Name: dist-sw";
  }
  if (format === "route") {
    return "core-rtr#show ip route\nC        10.1.0.0/30 is directly connected, GigabitEthernet0/0\nL        10.1.0.1/32 is directly connected, GigabitEthernet0/0";
  }
  if (format === "network") {
    return '{"schemaVersion":1,"devices":[{"name":"core-rtr"}],"interfaces":[{"device":"core-rtr","name":"Loopback0","ipv4":[{"address":"10.255.0.1","prefix":32}]}]}';
  }
  return "Local Device,Local Port,Remote Device,Remote Port\nCore,Gi0/0,Atlanta,Gi0/1";
}

function IssueList({ title, issues }: { title: string; issues: { row?: number; path?: string; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="error-banner" role="alert">
      <strong>{title}</strong>
      <ul>
        {issues.map((issue) => {
          const text = listedIssueText(issue);
          return <li key={`${issue.path ?? ""}-${issue.row ?? ""}-${text}`}>{text}</li>;
        })}
      </ul>
    </div>
  );
}
