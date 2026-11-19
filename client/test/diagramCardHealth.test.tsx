/**
 * @vitest-environment happy-dom
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DiagramHealthBadge } from "../src/components/DiagramHealthBadge";
import { diagramCardHealth, diagramHealthClass, diagramSurfaceHealth, type DiagramCardHealthInput } from "../src/lib/diagramCardHealth";

function Frame({ input, parsePill = false }: { input: DiagramCardHealthInput; parsePill?: boolean }) {
  const health = diagramCardHealth(input);
  return (
    <article className={`card${diagramHealthClass(health)}`}>
      {parsePill ? (
        <span className="thumb-badge is-parse" title="Parse error" aria-label="Parse error">
          Parse error
        </span>
      ) : null}
      <DiagramHealthBadge health={health} thumbnailShowsParseError={input.parseError === true} />
    </article>
  );
}

describe("diagram card health", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  function render(input: DiagramCardHealthInput, parsePill = false) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<Frame input={input} parsePill={parsePill} />);
    });
    return document.querySelector("article") as HTMLElement;
  }

  it("shows a red error pill and a red border, and errors win over warnings", () => {
    const card = render({ errors: 2, warnings: 4 });
    expect(card.className).toContain("is-health-error");
    expect(card.className).not.toContain("is-health-warning");
    const pill = card.querySelector(".diagram-card-health") as HTMLElement;
    expect(pill.textContent).toBe("2 errors");
    expect(pill.getAttribute("title")).toBe("2 errors");
    expect(pill.className).not.toContain("is-warning");
  });

  it("keeps the parse-error pill and a red border", () => {
    const card = render({ parseError: true, warnings: 3 }, true);
    expect(card.className).toContain("is-health-error");
    expect(card.className).not.toContain("is-health-warning");
    expect(card.querySelector(".diagram-card-health")).toBeNull();
    const pill = card.querySelector(".thumb-badge.is-parse") as HTMLElement;
    expect(pill.textContent).toBe("Parse error");
    expect(pill.getAttribute("aria-label")).toBe("Parse error");
  });

  it("names a front-matter-only error Settings error and keeps the red border", () => {
    const card = render({ frontMatterError: true, errors: 1, warnings: 3, frontMatterLine: 3 });
    expect(card.className).toContain("is-health-error");
    expect(card.className).not.toContain("is-health-warning");
    const pill = card.querySelector(".diagram-card-health") as HTMLElement;
    expect(pill.textContent).toBe("Settings error");
    expect(pill.getAttribute("title")).toBe(
      "The settings block at the top of the file (front matter) has an error on line 3.",
    );
    expect(pill.getAttribute("aria-label")).toBe(pill.getAttribute("title"));
    expect(card.textContent).not.toContain("Parse error");
    expect(card.textContent).not.toContain("Front matter error");
  });

  it("keeps Parse error when a front-matter problem and a Mermaid failure are both present", () => {
    const card = render({ frontMatterError: true, parseError: true, errors: 2 }, true);
    expect(card.className).toContain("is-health-error");
    expect(card.querySelector(".diagram-card-health")).toBeNull();
    expect(card.querySelector(".thumb-badge.is-parse")?.textContent).toBe("Parse error");
  });

  it("uses the same settings and parse words on the grid and in the list", () => {
    const list = diagramSurfaceHealth({ malformed: true, errors: 1, warnings: 2, frontMatterLine: 4 });
    const grid = diagramSurfaceHealth({
      malformed: true,
      errors: 1,
      warnings: 2,
      thumbnailFailed: false,
      frontMatterLine: 4,
    });
    expect(list).toEqual(grid);
    expect(list).toMatchObject({
      tone: "error",
      label: "Settings error",
      title: "The settings block at the top of the file (front matter) has an error on line 4.",
    });
    expect(diagramSurfaceHealth({ malformed: true, frontMatterLine: null }).title).toBe(
      "The settings block at the top of the file (front matter) has an error.",
    );
    const syntax = diagramSurfaceHealth({ syntaxError: true, errors: 1, warnings: 2 });
    expect(syntax.label).toBe("Parse error");
    expect(diagramSurfaceHealth({ thumbnailFailed: true, errors: 1 }).label).toBe(syntax.label);
    expect(diagramSurfaceHealth({ malformed: true, syntaxError: true, errors: 2, frontMatterLine: 3 }).label).toBe(
      "Parse error",
    );
    expect(diagramSurfaceHealth({ malformed: true, thumbnailFailed: true }).label).toBe("Parse error");
    expect(diagramHealthClass(list)).toBe(" is-health-error");
    expect(diagramHealthClass(syntax)).toBe(" is-health-error");
  });

  it("shows a yellow warning pill and a yellow border for unmuted warnings", () => {
    const card = render({ errors: 0, warnings: 3, muted: false });
    expect(card.className).toContain("is-health-warning");
    expect(card.className).not.toContain("is-health-error");
    const pill = card.querySelector(".diagram-card-health") as HTMLElement;
    expect(pill.textContent).toBe("3 warnings");
    expect(pill.getAttribute("title")).toBe("3 warnings");
    expect(pill.getAttribute("aria-label")).toBe("3 warnings");
    expect(pill.className).toContain("is-warning");
  });

  it("shows nothing when warnings are muted, including when errors are absent", () => {
    const card = render({ errors: 0, warnings: 5, muted: true });
    expect(card.className).toBe("card");
    expect(card.querySelector(".thumb-badge")).toBeNull();
  });

  it("shows nothing for a clean diagram", () => {
    const card = render({ errors: 0, warnings: 0 });
    expect(card.className).toBe("card");
    expect(card.querySelector(".thumb-badge")).toBeNull();
  });

  it("still shows an error when warnings on that diagram are muted", () => {
    const card = render({ errors: 1, warnings: 5, muted: true });
    expect(card.className).toContain("is-health-error");
    expect(card.querySelector(".diagram-card-health")?.textContent).toBe("1 error");
    expect(card.querySelector(".is-warning")).toBeNull();
  });

  it("uses the warning yellow with dark text, and the error border matches the error pill", () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, "../src/index.css"), "utf8");
    expect(css).toMatch(/--card-warn-bg:\s*var\(--banner-warn-line\)/);
    expect(css).toMatch(/--card-warn-bg:\s*var\(--checks-warn\)/);
    expect(css).toMatch(/--card-warn-ink:\s*#1c1404/);
    expect(css).toMatch(/\.thumb-badge\.is-warning\s*\{[^}]*background:\s*var\(--card-warn-bg\)/);
    expect(css).toMatch(/\.thumb-badge\.is-warning\s*\{[^}]*color:\s*var\(--card-warn-ink\)/);
    expect(css).toMatch(/\.card\.is-health-error[\s\S]*?#6b3030/);
    expect(css).toMatch(/\.thumb-badge\s*\{[^}]*background:\s*#6b3030/);
    expect(css).toMatch(/\.sidebar-block-body\.is-dragging \.bookmark-folder[\s\S]*?min-height:\s*4\.5rem/);
  });
});
