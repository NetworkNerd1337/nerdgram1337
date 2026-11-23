/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstanceSettings } from "../src/components/InstanceSettings";
import { StylePresetsSettings } from "../src/components/StylePresetsSettings";

const hostname = "h".repeat(50);

describe("settings name caps", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  async function render(node: ReturnType<typeof createElement>) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(node);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("does not put the hostname in the instance field and caps a typed name at 32", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              instanceId: "11111111-1111-4111-8111-111111111111",
              instanceName: hostname,
              hostname,
              configuredName: null,
              nameIsDefault: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await render(createElement(InstanceSettings));
    const input = document.querySelector("#instance-name");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).value).toBe("");
    expect((input as HTMLInputElement).maxLength).toBe(32);
    expect((input as HTMLInputElement).placeholder).toBe(hostname);
    expect(document.querySelector("#instance-name-help")?.textContent).toContain("0/32");
    const shown = [...(container?.querySelectorAll(".clipped-name") ?? [])];
    expect(shown.some((node) => node.getAttribute("title") === hostname)).toBe(true);
  });

  it("caps a preset rename at 40 and keeps a longer stored name in the list", async () => {
    const long = "P".repeat(50);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 1,
              defaultId: null,
              presets: [
                {
                  id: "sp0123456789abcdef",
                  name: long,
                  style: {
                    theme: "forest",
                    look: null,
                    handDrawnSeed: null,
                    layout: "dagre",
                    fontFamily: null,
                    themeVariables: {},
                    themeCSS: null,
                    flowchartCurve: null,
                    elk: { mergeEdges: null, nodePlacementStrategy: null },
                    displayMode: null,
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await render(createElement(StylePresetsSettings));
    const label = container?.querySelector(".clipped-name");
    expect(label?.textContent).toBe(long);
    expect(label?.getAttribute("title")).toBe(long);
    const rename = [...document.querySelectorAll("button")].find((button) => button.textContent === "Rename");
    await act(async () => {
      rename?.click();
    });
    const input = document.querySelector("input[aria-label^='Rename ']");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).value).toBe(long);
    expect((input as HTMLInputElement).maxLength).toBe(-1);
    expect(document.querySelector("#preset-rename-count")?.textContent).toContain("50/40");
  });
});
