/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePageTitle } from "../src/hooks/usePageTitle";
import { pageTitle, presentTitle } from "../src/lib/pageTitle";

function TitleProbe({ title }: { title: string | null }) {
  usePageTitle(title);
  return null;
}

describe("page titles", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    document.title = "NerdGram1337";
  });

  it("names each page, and the editor and Present include the diagram", () => {
    expect(pageTitle("Dashboard")).toBe("Dashboard · NerdGram1337");
    expect(pageTitle("Diagram health")).toBe("Diagram health · NerdGram1337");
    expect(pageTitle("Settings")).toBe("Settings · NerdGram1337");
    expect(pageTitle("Campus")).toBe("Campus · NerdGram1337");
    expect(presentTitle("Campus")).toBe("Present · Campus · NerdGram1337");
  });

  it("updates the browser tab when the name changes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<TitleProbe title={pageTitle("Campus")} />);
    });
    expect(document.title).toBe("Campus · NerdGram1337");
    act(() => {
      root?.render(<TitleProbe title={pageTitle("Core")} />);
    });
    expect(document.title).toBe("Core · NerdGram1337");
    act(() => {
      root?.render(<TitleProbe title={null} />);
    });
    expect(document.title).toBe("Core · NerdGram1337");
  });
});
