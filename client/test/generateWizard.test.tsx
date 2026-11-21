/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GenerateWizard } from "../src/components/GenerateWizard";
import { applyAppearance } from "../src/lib/appearance";
import {
  canCreate,
  diagramFilePath,
  initialWizardState,
  issueListTitle,
  listedIssueText,
  mermaidPreviewScrollLines,
  previewRequest,
  wizardReducer,
  type WizardInspection,
  type WizardState,
} from "../src/lib/generateWizard";
import { importDiagramData } from "../../server/src/diagramData.ts";
import { renderMermaid } from "../src/lib/mermaidRender";

const csv = `Local Device,Local Port,Remote Device,Remote Port,Local Group,Remote Diagram
Core,Gi0/0,Atlanta,Gi0/1,HQ,Sites/Atlanta.mmd
Core,Gi0/1,Remote,Gi0/0,HQ,
`;

function inspection(state: WizardState, _step: "map" | "preview"): WizardInspection {
  const request = previewRequest(state);
  const result = importDiagramData(request);
  return {
    format: result.format,
    shape: result.shape,
    headers: result.headers,
    edgesHeaders: result.edgesHeaders,
    mapping: result.mapping,
    edgesMapping: result.edgesMapping,
    errors: result.errors,
    warnings: result.warnings,
    mermaid: result.mermaid,
    counts: result.counts,
    direction: result.direction,
    grouping: result.grouping,
  };
}

describe("generate wizard flow", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("walks paste, column mapping, direction, preview, and create", () => {
    let state = initialWizardState("Sites");
    const seen: string[] = [];
    const dispatch = (action: Parameters<typeof wizardReducer>[1]) => {
      state = wizardReducer(state, action);
    };

    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <GenerateWizard
            state={state}
            dispatch={dispatch}
            busy={false}
            onInspect={(step) => {
              seen.push(step);
              dispatch({ type: "result", result: inspection(state, step), step });
            }}
            onCreate={() => {
              seen.push(`create:${diagramFilePath(state)}`);
            }}
          />,
        );
      });
    }

    render();
    const data = document.querySelector<HTMLTextAreaElement>("#generate-data");
    expect(data).toBeTruthy();
    setValue(data!, csv);
    render();
    expect(state.text).toContain("Atlanta");
    (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    render();
    expect(seen).toEqual(["map"]);
    expect(state.step).toBe("map");
    expect(document.querySelector("#map-localDevice")).toBeTruthy();
    expect((document.querySelector("#map-localDevice") as HTMLSelectElement).value).toBe("Local Device");
    expect((document.querySelector("#map-remoteDiagram") as HTMLSelectElement).value).toBe("Remote Diagram");

    const direction = document.querySelector<HTMLSelectElement>("#generate-direction");
    setValue(direction!, "TD");
    render();
    expect(state.direction).toBe("TD");
    const previewButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview");
    previewButton?.click();
    render();
    expect(state.step).toBe("preview");
    expect(state.errors).toEqual([]);
    expect(state.mermaid).toContain("flowchart TD");
    expect(state.mermaid).toContain("subgraph");
    expect(state.mermaid).toContain('click Atlanta "nerdgram:Sites/Atlanta.mmd"');
    expect(canCreate(state)).toBe(false);

    const name = document.querySelector<HTMLInputElement>("#generate-name");
    setValue(name!, "Campus");
    render();
    expect(canCreate(state)).toBe(true);
    expect(diagramFilePath(state)).toBe("Sites/Campus.mmd");
    (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    expect(seen.at(-1)).toBe("create:Sites/Campus.mmd");
    expect(previewRequest(state).direction).toBe("TD");
    expect(previewRequest(state).grouping).toBe(true);
  });

  it.each([
    ["cdp", "Cisco CDP", "core-sw#show cdp neighbors detail\n-------------------------\nDevice ID: dist-sw\nPlatform: cisco C9300-48P, Capabilities: Switch\nInterface: Gi1/0/1, Port ID (outgoing port): Gi1/0/48\n"],
    ["lldp", "LLDP neighbors", "core-sw#show lldp neighbors detail\nLocal Intf: Gi1/0/1\nPort id: Gi1/0/48\nSystem Name: dist-sw\nSystem Description: Cisco IOS Software\nEnabled Capabilities: B\n"],
  ] as const)("chooses %s in the wizard and previews a diagram", (format, label, sample) => {
    let state = initialWizardState("Sites");
    const dispatch = (action: Parameters<typeof wizardReducer>[1]) => {
      state = wizardReducer(state, action);
    };
    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <GenerateWizard
            state={state}
            dispatch={dispatch}
            busy={false}
            onInspect={(step) => dispatch({ type: "result", result: inspection(state, step), step })}
            onCreate={() => undefined}
          />,
        );
      });
    }

    render();
    setValue(document.querySelector<HTMLSelectElement>("#generate-format")!, format);
    render();
    expect(document.querySelector("label[for='generate-data']")?.textContent).toContain(label === "Cisco CDP" ? "Cisco CDP" : "LLDP");
    expect(document.querySelector("#generate-edges")).toBeNull();
    expect(document.querySelector("#generate-local-device")).toBeTruthy();
    setValue(document.querySelector<HTMLTextAreaElement>("#generate-data")!, sample);
    render();
    (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    render();
    expect(state.step).toBe("map");
    expect(document.querySelector("#map-localDevice")).toBeNull();
    expect(document.querySelector("#generate-group-by")).toBeTruthy();
    setValue(document.querySelector<HTMLSelectElement>("#generate-group-by")!, "capability");
    render();
    const previewButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview");
    previewButton?.click();
    render();
    expect(state.step).toBe("preview");
    expect(state.errors).toEqual([]);
    expect(state.mermaid).toContain("flowchart LR");
    expect(state.mermaid).toContain('["dist-sw"]');
    expect(state.mermaid).toContain('["Switch"]');
    expect(canCreate(state)).toBe(false);
    setValue(document.querySelector<HTMLInputElement>("#generate-name")!, "Campus");
    render();
    expect(canCreate(state)).toBe(true);
    expect(previewRequest(state).format).toBe(format);
    expect(previewRequest(state).groupBy).toBe("capability");
    expect(previewRequest(state).sourceFile).toBe(format === "cdp" ? "Sites/Campus.cdp" : "Sites/Campus.lldp");
  });

  it("previews a Layer 3 diagram from network JSON", () => {
    let state = initialWizardState("Sites");
    const dispatch = (action: Parameters<typeof wizardReducer>[1]) => {
      state = wizardReducer(state, action);
    };
    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <GenerateWizard
            state={state}
            dispatch={dispatch}
            busy={false}
            onInspect={(step) => dispatch({ type: "result", result: inspection(state, step), step })}
            onCreate={() => undefined}
          />,
        );
      });
    }

    const network = JSON.stringify({
      schemaVersion: 1,
      devices: [{ name: "core-rtr", role: "core" }, { name: "dist-sw" }],
      interfaces: [
        { device: "core-rtr", name: "Loopback0", ipv4: [{ address: "10.255.0.1", prefix: 32 }] },
        { device: "core-rtr", name: "Gi0/0", ipv4: [{ address: "10.1.0.1", prefix: 30 }] },
        { device: "dist-sw", name: "Gi0/1", ipv4: [{ address: "10.1.0.2", prefix: 30 }] },
      ],
    });
    render();
    setValue(document.querySelector<HTMLSelectElement>("#generate-format")!, "network");
    render();
    expect(document.querySelector("label[for='generate-data']")?.textContent).toContain("Network data (JSON)");
    expect(document.querySelector("#generate-view")).toBeTruthy();
    expect(document.querySelector("#generate-include-down")).toBeTruthy();
    expect(document.querySelector("#generate-edges")).toBeNull();
    setValue(document.querySelector<HTMLTextAreaElement>("#generate-data")!, network);
    render();
    (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    render();
    expect(state.step).toBe("map");
    expect(document.querySelector("#map-localDevice")).toBeNull();
    expect(document.querySelector("#generate-view")).toBeTruthy();
    setValue(document.querySelector<HTMLSelectElement>("#generate-network-group")!, "vrf");
    render();
    const previewButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview");
    previewButton?.click();
    render();
    expect(state.step).toBe("preview");
    expect(state.errors).toEqual([]);
    expect(state.mermaid).toContain("flowchart LR");
    expect(state.mermaid).toContain("10.1.0.0/30");
    expect(state.mermaid).toContain("10.255.0.1/32");
    expect(canCreate(state)).toBe(false);
    setValue(document.querySelector<HTMLInputElement>("#generate-name")!, "Campus");
    render();
    expect(canCreate(state)).toBe(true);
    expect(previewRequest(state).format).toBe("network");
    expect(previewRequest(state).view).toBe("l3");
    expect(previewRequest(state).groupBy).toBe("vrf");
    expect(previewRequest(state).sourceFile).toBe("Sites/Campus.network.json");

    const back = [...document.querySelectorAll("button")].find((button) => button.textContent === "Back");
    back?.click();
    render();
    expect(state.step).toBe("map");
    setValue(document.querySelector<HTMLSelectElement>("#generate-view")!, "l2");
    render();
    expect(state.view).toBe("l2");
    expect(document.querySelector("#generate-vlan")).toBeTruthy();
    const group = document.querySelector<HTMLSelectElement>("#generate-network-group");
    expect([...group!.options].map((option) => option.value)).toEqual(["", "site", "role", "platform"]);
    setValue(group!, "platform");
    render();
    expect(previewRequest(state).groupBy).toBe("platform");
    expect(previewRequest(state).view).toBe("l2");
  });

  it("keeps create disabled when a row is invalid", () => {
    let state = wizardReducer(initialWizardState(), { type: "text", text: "Local Device,Remote Device\nCore,\n" });
    const result = inspection(state, "preview");
    state = wizardReducer(state, { type: "result", result, step: "preview" });
    expect(state.errors.some((issue) => issue.message.includes("Row 2"))).toBe(true);
    expect(issueListTitle(state.format, state.detectedFormat)).toBe("Rows to fix");
    expect(canCreate(state)).toBe(false);
  });

  it("shows a network JSON path instead of a row number", () => {
    let state = wizardReducer(initialWizardState(), { type: "format", format: "network" });
    state = wizardReducer(state, {
      type: "text",
      text: JSON.stringify({ schemaVersion: 1, devices: [{ name: "core", serial: "ABC" }], interfaces: [] }),
    });
    const result = inspection(state, "preview");
    state = wizardReducer(state, { type: "result", result, step: "preview" });
    expect(state.errors[0]?.path).toBe("/devices/0/serial");
    expect(state.errors[0]?.row).toBeUndefined();
    expect(listedIssueText(state.errors[0]!)).toContain("/devices/0/serial");
    expect(listedIssueText(state.errors[0]!)).not.toMatch(/row 0/i);
    expect(issueListTitle(state.format, state.detectedFormat)).toBe("Fields to fix");

    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <GenerateWizard state={state} dispatch={() => undefined} busy={false} onInspect={() => undefined} onCreate={() => undefined} />,
        );
      });
    }
    render();
    expect(document.body.textContent).toContain("Fields to fix");
    expect(document.body.textContent).toContain("/devices/0/serial");
    expect(document.body.textContent).not.toContain("Rows to fix");
    expect(document.body.textContent).not.toContain("Row 0");
  });

  it(
    "renders a generated diagram, including a label that tries to inject a directive",
    async () => {
      installTextBox();
      const clean = importDiagramData({ text: csv, direction: "LR", sourceFile: "campus.csv" });
      const drawn = await renderMermaid(clean.mermaid);
      expect(drawn.svg).toContain("<svg");
      expect(drawn.svg.toLowerCase()).not.toContain("syntax error");

      const nasty = '"]\nclick pwn "javascript:alert(1)"\n';
      const attacked = importDiagramData({
        text: `id,label\ncore,"${nasty.replaceAll('"', '""')}"\nedge,Edge\n`,
        edgesText: "source,target\ncore,edge\n",
        shape: "graph",
      });
      expect(attacked.errors).toEqual([]);
      const attackedSvg = await renderMermaid(attacked.mermaid);
      expect(attackedSvg.svg.toLowerCase()).not.toContain("syntax error");
      expect(attackedSvg.svg.toLowerCase()).not.toContain("javascript:");
    },
    30_000,
  );
});

describe("translator picker", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
    document.documentElement.dataset.theme = "";
    document.documentElement.dataset.appearance = "";
  });

  const installed = [
    { id: "nautobot", name: "Nautobot", formatHint: "Saved Nautobot REST export", placeholder: "{\n  \"devices\": []\n}" },
    { id: "orion", name: "SolarWinds Orion", formatHint: "Saved SWIS Query JSON", placeholder: "{\n  \"nodes\": []\n}" },
  ];

  function harness(translators = installed) {
    let state = initialWizardState("");
    const converted: string[] = [];
    const created: string[] = [];
    const dispatch = (action: Parameters<typeof wizardReducer>[1]) => {
      state = wizardReducer(state, action);
    };
    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <GenerateWizard
            state={state}
            dispatch={dispatch}
            busy={false}
            translators={translators}
            onConvert={async (id, text) => {
              converted.push(`${id}:${text}`);
              return {
                documentText: JSON.stringify({
                  schemaVersion: 1,
                  format: "network",
                  devices: [{ name: "core-rtr" }],
                  interfaces: [],
                  links: [],
                  vlans: [],
                }),
                mapperWarnings: [{ path: "/cables", message: "No cables in this export." }],
              };
            }}
            onInspect={(step, patch) => {
              const warnings = (patch?.mapperWarnings ?? []).map((warning) => ({ ...warning, row: 0 }));
              dispatch({
                type: "result",
                step,
                result: {
                  ...inspection({ ...state, text: patch?.documentText ?? state.text, format: "network" }, step),
                  warnings,
                },
              });
            }}
            onCreate={() => created.push("create")}
          />,
        );
      });
    }
    return { get state() { return state; }, render, converted, created };
  }

  it("lists installed modules and drops one when it is removed, with no client list of ids", () => {
    const page = harness();
    page.render();
    const options = [...document.querySelectorAll<HTMLOptionElement>("#generate-format option")].map((item) => item.textContent);
    expect(options).toContain("Nautobot");
    expect(options).toContain("SolarWinds Orion");
    expect(options[0]).toBe("Auto-detect");
    expect(document.querySelector(".generate-hint")?.textContent).toMatch(/Cisco CDP/);
    expect(options).toContain("CSV");
    expect(options).not.toContain("CSV or JSON");
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    const smaller = harness(installed.slice(0, 1));
    smaller.render();
    const next = [...document.querySelectorAll<HTMLOptionElement>("#generate-format option")].map((item) => item.textContent);
    expect(next).toContain("Nautobot");
    expect(next).not.toContain("SolarWinds Orion");
    expect(next).toContain("Network data (JSON)");
  });

  it("puts each large-diagram radio on the same row as its label", () => {
    const state: WizardState = {
      ...initialWizardState("Sites"),
      step: "preview",
      mermaid: "flowchart LR\nhub --> a",
      counts: { nodes: 200, edges: 1, groups: 0 },
      diagramName: "Big",
    };
    act(() => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      root.render(<GenerateWizard state={state} dispatch={() => undefined} busy={false} onInspect={() => undefined} onCreate={() => undefined} />);
    });
    const fieldset = document.querySelector("fieldset.generate-large");
    expect(fieldset?.querySelector("legend")?.textContent).toBe("Large diagram");
    const labels = [...(fieldset?.querySelectorAll("label") ?? [])];
    expect(labels.map((label) => label.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Default rank",
      "Compact hub layout",
      "Radial hub layout",
    ]);
    for (const label of labels) {
      const input = label.querySelector("input");
      expect(input?.getAttribute("type")).toBe("radio");
      expect(label.firstElementChild).toBe(input);
      expect(label.classList.contains("generate-choice")).toBe(true);
    }
  });

  it("converts paste and upload, and shows mapper warnings before save", async () => {
    const page = harness();
    page.render();
    setValue(document.querySelector<HTMLSelectElement>("#generate-format")!, "translator:nautobot");
    page.render();
    expect(document.body.textContent).toContain("Your diagram reflects your data");
    expect(document.body.textContent).toContain("this Nautobot export");
    expect(document.querySelector("a")?.textContent).toContain("Translator tips");
    setValue(document.querySelector<HTMLTextAreaElement>("#generate-data")!, "{\"devices\":[]}");
    page.render();
    await act(async () => {
      (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    });
    page.render();
    expect(page.converted).toEqual(["nautobot:{\"devices\":[]}"]);
    expect(document.body.textContent).toContain("No cables in this export.");
    expect(page.created).toEqual([]);
  });

  it("converts an uploaded file through the same convert callback", async () => {
    const page = harness();
    page.render();
    setValue(document.querySelector<HTMLSelectElement>("#generate-format")!, "translator:orion");
    page.render();
    const upload = new File(["{\"nodes\":[]}"], "edge.json", { type: "application/json" });
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { configurable: true, value: [upload] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    page.render();
    await act(async () => {
      (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    });
    page.render();
    expect(page.converted[0]).toContain("orion:");
    expect(page.converted[0]).toContain("nodes");
    expect(page.created).toEqual([]);
    expect(document.body.textContent).toContain("No cables in this export.");
  });

  it("dismisses the callout per translator in light, dark, and system appearance", () => {
    const page = harness();
    for (const theme of ["light", "dark", "system"] as const) {
      applyAppearance(theme, theme === "system" ? true : theme === "dark");
      page.render();
      setValue(document.querySelector<HTMLSelectElement>("#generate-format")!, "translator:nautobot");
      page.render();
      const notice = document.querySelector(".data-notice");
      expect(notice?.textContent).toContain("Your diagram reflects your data");
      expect(notice?.textContent).toContain("Nautobot");
      expect(document.documentElement.dataset.theme).toBe(theme === "system" ? "dark" : theme);
    }
    (document.querySelector(".data-notice button") as HTMLButtonElement).click();
    page.render();
    expect(document.querySelector(".data-notice")).toBeNull();
    expect(localStorage.getItem("nerdgram.generate.notice.nautobot")).toBe("1");
    setValue(document.querySelector<HTMLSelectElement>("#generate-format")!, "translator:orion");
    page.render();
    expect(document.querySelector(".data-notice")?.textContent).toContain("SolarWinds Orion");
    expect(localStorage.getItem("nerdgram.generate.notice.orion")).toBeNull();
    setValue(document.querySelector<HTMLSelectElement>("#generate-format")!, "translator:nautobot");
    page.render();
    expect(document.querySelector(".data-notice")).toBeNull();
  });

  it("opens the Mermaid preview at the first line", () => {
    const mermaid = `flowchart LR\n${"  a --> b\n".repeat(40)}`;
    let state = { ...initialWizardState("Sites"), step: "preview" as const, mermaid, diagramName: "Campus", counts: { nodes: 2, edges: 1, groups: 0 } };
    const dispatch = (action: Parameters<typeof wizardReducer>[1]) => {
      state = wizardReducer(state, action);
    };
    const render = () => {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(<GenerateWizard state={state} dispatch={dispatch} busy={false} onInspect={() => undefined} onCreate={() => undefined} />);
      });
    };
    render();
    const box = document.querySelector<HTMLElement>("#generate-preview");
    expect(box?.textContent?.startsWith("flowchart LR")).toBe(true);
    if (box) box.scrollTop = 120;
    state = { ...state, mermaid: `flowchart TD\n${"  a --> b\n".repeat(40)}` };
    render();
    expect(document.querySelector<HTMLElement>("#generate-preview")?.scrollTop).toBe(0);
    const headed = `---\ntitle: Campus\n---\nflowchart LR\n  a --> b\n`;
    expect(mermaidPreviewScrollLines(headed)).toBe(3);
    expect(mermaidPreviewScrollLines("flowchart LR\n  a --> b\n")).toBe(0);
  });
});

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function installTextBox(): void {
  const box = function (this: Element) {
    const text = this.textContent ?? "";
    return new DOMRect(0, 0, Math.max(8, text.trim().length * 7), text.trim() ? 18 : 8);
  };
  for (const ctor of [globalThis.SVGElement, globalThis.SVGGraphicsElement]) {
    Object.defineProperty(ctor.prototype, "getBBox", { configurable: true, value: box });
  }
}
