/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LAB_EXPORT_HINT_ID, ExportFormatMenu } from "../src/components/LabExportGroup";

const exporters = [
  { id: "pyats", name: "pyATS testbed", description: "Testbed YAML" },
  { id: "containerlab", name: "containerlab topology", description: "Lab file" },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderMenu(
  enabled: boolean,
  onLab: (id: string) => void = () => undefined,
  onImage: (format: string, transparent?: boolean) => void = () => undefined,
  list: typeof exporters | [] = exporters,
  onOpenGenerate?: (event: ReactMouseEvent<HTMLAnchorElement>) => void,
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <MemoryRouter>
        <ExportFormatMenu
          exporters={list}
          enabled={enabled}
          onImage={onImage}
          onLab={onLab}
          onOpenGenerate={onOpenGenerate}
        />
      </MemoryRouter>,
    );
  });
}

function choose(value: string) {
  const select = host?.querySelector("select");
  if (!select) throw new Error("missing export menu");
  select.value = value;
  act(() => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("editor Lab and automation heading", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  it("enables the installed exporters when the diagram has network JSON", () => {
    const labs: string[] = [];
    const images: string[] = [];
    renderMenu(true, (id) => labs.push(id), (format) => images.push(format));
    const select = host?.querySelector("select");
    expect(select?.getAttribute("aria-describedby")).toBeNull();
    expect(host?.querySelector("optgroup")?.getAttribute("label")).toBe("Lab and automation");
    expect(host?.querySelector(`#${LAB_EXPORT_HINT_ID}`)).toBeNull();
    expect(host?.textContent).not.toContain("Needs network data");
    const pyats = host?.querySelector("option[value='lab:pyats']") as HTMLOptionElement;
    const containerlab = host?.querySelector("option[value='lab:containerlab']") as HTMLOptionElement;
    expect(pyats.disabled).toBe(false);
    expect(pyats.textContent).toBe("pyATS testbed");
    expect(containerlab.disabled).toBe(false);
    choose("lab:containerlab");
    expect(labs).toEqual(["containerlab"]);
    expect(select?.value).toBe("");
    choose("svg");
    expect(images).toEqual(["svg"]);
  });

  it("shows the group disabled, with a hint, when the diagram has no network JSON", () => {
    const labs: string[] = [];
    const images: string[] = [];
    renderMenu(false, (id) => labs.push(id), (format, transparent) => images.push(transparent ? `${format}-transparent` : format));
    const select = host?.querySelector("select");
    expect(select?.getAttribute("aria-describedby")).toBe(LAB_EXPORT_HINT_ID);
    expect(host?.querySelector("optgroup")?.getAttribute("label")).toBe("Lab and automation");
    const hint = host?.querySelector(`#${LAB_EXPORT_HINT_ID}`);
    expect(hint?.textContent).toContain("Needs network data.");
    expect(hint?.textContent).toContain("Generate the diagram from data");
    expect(hint?.textContent).toContain("to enable.");
    const link = hint?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/generate");
    const pyats = host?.querySelector("option[value='unavailable:pyats']") as HTMLOptionElement;
    const containerlab = host?.querySelector("option[value='unavailable:containerlab']") as HTMLOptionElement;
    const note = host?.querySelector("option[value='unavailable']") as HTMLOptionElement;
    expect(pyats.disabled).toBe(true);
    expect(containerlab.disabled).toBe(true);
    expect(note.disabled).toBe(true);
    expect(note.textContent).toContain("Needs network data");
    choose("unavailable:pyats");
    choose("unavailable");
    expect(labs).toEqual([]);
    expect(select?.value).toBe("");
    choose("png-transparent");
    expect(images).toEqual(["png-transparent"]);
  });

  it("leaves the group out when no exporters are installed", () => {
    renderMenu(false, () => undefined, () => undefined, []);
    expect(host?.querySelector("optgroup")).toBeNull();
    expect(host?.querySelector(`#${LAB_EXPORT_HINT_ID}`)).toBeNull();
  });

  it("points From data at /generate and lets the editor save before leaving", () => {
    const clicks: number[] = [];
    renderMenu(false, () => undefined, () => undefined, exporters, (event) => {
      clicks.push(event.button);
      event.preventDefault();
    });
    const link = host?.querySelector(`#${LAB_EXPORT_HINT_ID} a`) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/generate");
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(clicks).toEqual([0]);
    expect(host?.querySelector(`#${LAB_EXPORT_HINT_ID}`)).toBeTruthy();
  });
});
