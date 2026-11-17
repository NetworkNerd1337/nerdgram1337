import type { Dispatch, ReactNode } from "react";
import type { FlowDirection, NetworkView } from "../../../server/src/diagramData.ts";
import {
  canCreate,
  canInspect,
  edgeFields,
  fieldsFor,
  isNeighborSource,
  isNetworkSource,
  showEdgeFields,
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
  folderControl?: ReactNode;
  onInspect: (step: "map" | "preview") => void;
  onCreate: () => void;
};

export function GenerateWizard({ state, dispatch, busy, folderControl, onInspect, onCreate }: GenerateWizardProps) {
  const fields = fieldsFor(state);
  const neighbor = isNeighborSource(state);
  const network = isNetworkSource(state);
  return (
    <div className="generate-wizard">
      <ol className="generate-steps" aria-label="Steps">
        <li className={state.step === "input" ? "active" : ""}>Data</li>
        <li className={state.step === "map" ? "active" : ""}>{neighbor || network ? "Options" : "Columns"}</li>
        <li className={state.step === "preview" ? "active" : ""}>Preview</li>
      </ol>

      {state.fatal ? <div className="error-banner">{state.fatal}</div> : null}
      <IssueList title="Rows to fix" issues={state.errors} />
      {state.step !== "input" ? <IssueList title="Warnings" issues={state.warnings} /> : null}

      {state.step === "input" ? (
        <div className="generate-panel">
          <label htmlFor="generate-format">Source</label>
          <select
            id="generate-format"
            value={state.format}
            onChange={(event) => dispatch({ type: "format", format: event.target.value as WizardState["format"] })}
          >
            <option value="auto">CSV or JSON</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="network">Network data (JSON)</option>
            <option value="cdp">Cisco CDP</option>
            <option value="lldp">LLDP neighbors</option>
          </select>
          <label htmlFor="generate-data">{dataLabel(state.format)}</label>
          <textarea
            id="generate-data"
            value={state.text}
            onChange={(event) => dispatch({ type: "text", text: event.target.value })}
            spellCheck={false}
            rows={12}
            placeholder={dataPlaceholder(state.format)}
          />
          <label className="generate-file">
            Upload a file
            <input
              type="file"
              accept=".csv,.json,.network.json,.cdp,.lldp,.txt,text/csv,application/json,text/plain"
              aria-label="Upload data file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void file.text().then((text) => dispatch({ type: "text", text, fileName: file.name }));
              }}
            />
          </label>
          {state.format === "cdp" || state.format === "lldp" || state.format === "network" ? (
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
          {state.format === "network" ? <NetworkOptions state={state} dispatch={dispatch} /> : null}
          {state.format === "cdp" || state.format === "lldp" || state.format === "network" ? null : (
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
            <button type="button" className="btn btn-primary" disabled={!canInspect(state) || busy} onClick={() => onInspect("map")}>
              {busy ? "Reading…" : "Continue"}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === "map" ? (
        <div className="generate-panel">
          {neighbor ? (
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
          <p className="generate-counts">
            {state.counts.nodes} nodes, {state.counts.edges} edges
            {state.counts.groups > 0 ? `, ${state.counts.groups} groups` : ""}
          </p>
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

function dataLabel(format: WizardState["format"]): string {
  if (format === "cdp") return "Cisco CDP output";
  if (format === "lldp") return "LLDP neighbor output";
  if (format === "network") return "Network data (JSON)";
  if (format === "json") return "JSON";
  if (format === "csv") return "CSV";
  return "CSV or JSON";
}

function dataPlaceholder(format: WizardState["format"]): string {
  if (format === "cdp") {
    return "core-sw#show cdp neighbors detail\nDevice ID: dist-sw\nInterface: Gi1/0/1, Port ID (outgoing port): Gi1/0/48";
  }
  if (format === "lldp") {
    return "core-sw#show lldp neighbors detail\nLocal Intf: Gi1/0/1\nPort id: Gi1/0/48\nSystem Name: dist-sw";
  }
  if (format === "network") {
    return '{"schemaVersion":1,"devices":[{"name":"core-rtr"}],"interfaces":[{"device":"core-rtr","name":"Loopback0","ipv4":[{"address":"10.255.0.1","prefix":32}]}]}';
  }
  return "Local Device,Local Port,Remote Device,Remote Port\nCore,Gi0/0,Atlanta,Gi0/1";
}

function IssueList({ title, issues }: { title: string; issues: { row: number; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="error-banner" role="alert">
      <strong>{title}</strong>
      <ul>
        {issues.map((issue) => (
          <li key={`${issue.row}-${issue.message}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}
