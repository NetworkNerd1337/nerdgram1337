/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagramChecks } from "../src/components/DiagramChecks";
import {
  DIAGRAM_CHECKS_OPEN_KEY,
  diagramCheckSummary,
  findingsFromLint,
  groupDiagramChecks,
  readDiagramChecksOpen,
  writeDiagramChecksOpen,
  type DiagramCheckFinding,
} from "../src/lib/diagramChecks";

const diagramLint = vi.hoisted(() => vi.fn());
const previewLinkRepairs = vi.hoisted(() => vi.fn());
const applyLinkRepairs = vi.hoisted(() => vi.fn());

vi.mock("../src/api", () => ({
  api: {
    diagramLint,
    previewLinkRepairs,
    applyLinkRepairs,
  },
}));

const clean = {
  checked: 2,
  diagrams: [
    { path: "WAN.mmd", diagnostics: [] },
    { path: "NetworkMap.mmd", diagnostics: [] },
  ],
};

const warnings = {
  checked: 2,
  diagrams: [
    {
      path: "WAN.mmd",
      diagnostics: [
        diagnostic({
          ruleId: "unconnected",
          line: 4,
          message: 'Node "Remote" is defined but never connected to another node.',
        }),
        diagnostic({
          ruleId: "broken-click",
          line: 8,
          message: 'The click link "nerdgram:Missing.mmd" does not match a diagram in this workspace.',
        }),
      ],
    },
    { path: "Welcome.mmd", diagnostics: [] },
    {
      path: "Sites/Atlanta.mmd",
      diagnostics: [
        diagnostic({
          ruleId: "empty-node",
          line: 3,
          message: "This mindmap node has no text.",
        }),
      ],
    },
  ],
};

const errors = {
  checked: 2,
  diagrams: [
    {
      path: "WAN.mmd",
      diagnostics: [
        diagnostic({
          ruleId: "parse",
          severity: "error",
          line: 2,
          message: "Parse error on line 2.",
        }),
        diagnostic({
          ruleId: "broken-click",
          line: 6,
          message: 'The click link "nerdgram:Old.mmd" does not match a diagram in this workspace.',
        }),
      ],
    },
    {
      path: "Sites/Atlanta.mmd",
      diagnostics: [
        diagnostic({
          ruleId: "unlabeled",
          line: 5,
          message: 'This connection uses "Atlnta", which has no label. That is often a typo.',
        }),
      ],
    },
  ],
};

function diagnostic(overrides: Partial<DiagramCheckFinding> & Pick<DiagramCheckFinding, "line" | "message" | "ruleId">) {
  return {
    severity: "warning" as const,
    from: 0,
    to: 1,
    column: 1,
    fixes: [],
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function details(): HTMLDetailsElement {
  const node = document.querySelector("details.diagram-checks");
  if (!(node instanceof HTMLDetailsElement)) throw new Error("Diagram checks is not on the page");
  return node;
}

async function toggleOpen(): Promise<void> {
  const node = details();
  const summary = node.querySelector("summary");
  await act(async () => {
    summary?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  if (node.open === false) {
    await act(async () => {
      node.open = true;
      node.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
  }
}

async function toggleClosed(): Promise<void> {
  const node = details();
  await act(async () => {
    node.open = false;
    node.dispatchEvent(new Event("toggle", { bubbles: true }));
  });
}

describe("diagram check summary", () => {
  it("names each state in plain language", () => {
    expect(diagramCheckSummary("loading", null)).toBe("Checking diagrams…");
    expect(diagramCheckSummary("failed", null)).toBe("Diagram checks: could not check the diagrams");
    expect(diagramCheckSummary("clear", [])).toBe("Diagram checks: all diagrams look good");

    const one = findingsFromLint({
      diagrams: [{ path: "WAN.mmd", diagnostics: [diagnostic({ ruleId: "empty-node", line: 2, message: "Empty" })] }],
    });
    expect(diagramCheckSummary("warning", one)).toBe("Diagram checks: 1 warning in 1 diagram");

    const many = findingsFromLint(warnings);
    expect(diagramCheckSummary("warning", many)).toBe("Diagram checks: 3 warnings in 2 diagrams");
    expect(groupDiagramChecks(many).map((group) => group.path)).toEqual(["WAN.mmd", "Sites/Atlanta.mmd"]);

    const mixed = findingsFromLint(errors);
    expect(diagramCheckSummary("error", mixed)).toBe("Diagram checks: 1 error, 2 warnings");
    expect(diagramCheckSummary("error", mixed.filter((item) => item.severity === "error"))).toBe(
      "Diagram checks: 1 error",
    );
  });

  it("treats a missing saved state as closed", () => {
    const storage = memoryStorage();
    expect(readDiagramChecksOpen(storage)).toBe(false);
    storage.setItem(DIAGRAM_CHECKS_OPEN_KEY, "true");
    expect(readDiagramChecksOpen(storage)).toBe(false);
    writeDiagramChecksOpen(true, storage);
    expect(storage.getItem(DIAGRAM_CHECKS_OPEN_KEY)).toBe("1");
    expect(readDiagramChecksOpen(storage)).toBe(true);
    writeDiagramChecksOpen(false, storage);
    expect(readDiagramChecksOpen(storage)).toBe(false);
    expect(readDiagramChecksOpen({ getItem: () => { throw new Error("blocked"); }, setItem() {} })).toBe(false);
  });
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

describe("diagram checks panel", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    document.body.innerHTML = "";
    localStorage.clear();
    diagramLint.mockReset();
    previewLinkRepairs.mockReset();
    applyLinkRepairs.mockReset();
  });

  it("starts closed, checks once, and shows a green all-clear summary", async () => {
    let resolveLint: (value: typeof clean) => void = () => undefined;
    diagramLint.mockReturnValue(
      new Promise((resolve) => {
        resolveLint = resolve;
      }),
    );
    renderPanel();
    expect(details().open).toBe(false);
    expect(details().dataset.status).toBe("loading");
    expect(summaryText()).toBe("Checking diagrams…");
    expect(chevronPath()).toBe("M6 3.5 10.5 8 6 12.5");
    expect(details().querySelector(".diagram-checks-mark")).toBeNull();

    await act(async () => {
      resolveLint(clean);
    });
    await settle();
    expect(diagramLint).toHaveBeenCalledTimes(1);
    expect(details().dataset.status).toBe("clear");
    expect(summaryText()).toBe("Diagram checks: all diagrams look good");
    expect(details().querySelector(".diagram-checks-mark")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Workspace problems");
    expect(document.body.textContent).not.toContain("Mermaid cannot parse");
    expect(document.body.textContent).toContain("a node with no text");

    await toggleOpen();
    expect(details().open).toBe(true);
    expect(chevronPath()).toBe("M3.5 6 8 10.5 12.5 6");
    expect(diagramLint).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Repair links");
  });

  it("groups warnings by diagram and keeps Repair links", async () => {
    diagramLint.mockResolvedValue(warnings);
    renderPanel();
    await settle();

    expect(details().dataset.status).toBe("warning");
    expect(summaryText()).toBe("Diagram checks: 3 warnings in 2 diagrams");
    expect(details().open).toBe(false);

    await toggleOpen();
    const headings = [...details().querySelectorAll(".diagram-checks-path")].map((node) => node.textContent);
    expect(headings).toEqual(["WAN.mmd", "Sites/Atlanta.mmd"]);
    const lines = [...details().querySelectorAll(".diagram-checks-line")].map((node) => node.textContent);
    expect(lines).toEqual(["Line 4", "Line 8", "Line 3"]);
    const severities = [...details().querySelectorAll(".diagram-checks-severity")].map((node) =>
      node.textContent?.trim(),
    );
    expect(severities).toEqual(["Warning", "Warning", "Warning"]);

    const jump = details().querySelector<HTMLAnchorElement>('a[href="/edit/Sites/Atlanta.mmd?line=3"]');
    expect(jump?.textContent).toContain("This mindmap node has no text.");
    expect(jump?.textContent).toContain("Warning");

    const repair = [...details().querySelectorAll("button")].find((button) => button.textContent === "Repair links");
    expect(repair).toBeTruthy();
  });

  it("uses a red error summary when any diagram has an error", async () => {
    diagramLint.mockResolvedValue(errors);
    renderPanel();
    await settle();
    expect(details().dataset.status).toBe("error");
    expect(summaryText()).toBe("Diagram checks: 1 error, 2 warnings");
    await toggleOpen();
    const first = details().querySelector(".diagram-checks-severity");
    expect(first?.className).toContain("error");
    expect(first?.textContent).toContain("Error");
    expect(details().querySelector('a[href="/edit/WAN.mmd?line=2"]')).toBeTruthy();
  });

  it("remembers open and closed across a new visit", async () => {
    diagramLint.mockResolvedValue(clean);
    renderPanel();
    await settle();
    expect(details().open).toBe(false);

    await toggleOpen();
    expect(localStorage.getItem(DIAGRAM_CHECKS_OPEN_KEY)).toBe("1");
    rerenderPanel();
    expect(details().open).toBe(true);

    expect(localStorage.getItem(DIAGRAM_CHECKS_OPEN_KEY)).toBe("1");
    await act(async () => {
      root?.unmount();
    });
    expect(localStorage.getItem(DIAGRAM_CHECKS_OPEN_KEY)).toBe("1");
    root = null;
    host?.remove();
    renderPanel();
    await settle();
    expect(details().open).toBe(true);
    expect(diagramLint).toHaveBeenCalledTimes(2);

    await toggleClosed();
    expect(localStorage.getItem(DIAGRAM_CHECKS_OPEN_KEY)).toBe("0");
    act(() => root?.unmount());
    root = null;
    host?.remove();
    renderPanel();
    await settle();
    expect(details().open).toBe(false);
  });

  it("says when the check cannot finish, without calling it again", async () => {
    diagramLint.mockRejectedValue(new Error("The workspace is offline"));
    renderPanel();
    await settle();
    expect(details().dataset.status).toBe("failed");
    expect(summaryText()).toBe("Diagram checks: could not check the diagrams");
    await toggleOpen();
    expect(document.body.textContent).toContain("The workspace is offline");
    expect(diagramLint).toHaveBeenCalledTimes(1);
  });

  it("reloads the list after Repair links is confirmed", async () => {
    diagramLint.mockResolvedValueOnce(warnings).mockResolvedValueOnce(clean);
    previewLinkRepairs.mockResolvedValue({
      suggestions: [{ from: "Missing.mmd", to: "Sites/Atlanta.mmd", match: "content", candidates: ["Sites/Atlanta.mmd"] }],
      changes: [],
      applied: false,
      saved: [],
    });
    applyLinkRepairs.mockResolvedValue({
      suggestions: [],
      changes: [],
      applied: true,
      saved: ["WAN.mmd"],
    });
    renderPanel();
    await settle();
    await toggleOpen();
    const openRepair = [...details().querySelectorAll("button")].find((button) => button.textContent === "Repair links");
    await act(async () => {
      openRepair?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    const submit = document.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(submit?.textContent).toBe("Repair links");
    await act(async () => {
      document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(applyLinkRepairs).toHaveBeenCalledOnce();
    expect(diagramLint).toHaveBeenCalledTimes(2);
    expect(summaryText()).toBe("Diagram checks: all diagrams look good");
  });
});

function renderPanel(): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  rerenderPanel();
}

function rerenderPanel(): void {
  act(() => {
    root?.render(
      <MemoryRouter>
        <DiagramChecks />
      </MemoryRouter>,
    );
  });
}

function summaryText(): string {
  return details().querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function chevronPath(): string {
  return details().querySelector(".diagram-checks-chevron path")?.getAttribute("d") ?? "";
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
