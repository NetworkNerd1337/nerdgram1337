/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LabExportGroup } from "../src/components/LabExportGroup";

const exporters = [
  { id: "pyats", name: "pyATS testbed", description: "Testbed YAML" },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderMenu(hasNetwork: boolean): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(
        "select",
        { "aria-label": "Export as" },
        createElement("option", { value: "svg" }, "SVG"),
        hasNetwork ? createElement(LabExportGroup, { exporters }) : null,
      ),
    );
  });
}

describe("editor Lab and automation heading", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  it("shows the heading when the diagram has network JSON", () => {
    renderMenu(true);
    expect(host?.querySelector("optgroup")?.getAttribute("label")).toBe("Lab and automation");
    expect(host?.textContent).toContain("pyATS testbed");
  });

  it("hides the heading when the diagram has no network JSON", () => {
    renderMenu(false);
    expect(host?.querySelector("optgroup")).toBeNull();
    expect(host?.textContent).not.toContain("Lab and automation");
  });
});
