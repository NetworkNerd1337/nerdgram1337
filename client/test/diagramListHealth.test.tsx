/**
 * @vitest-environment happy-dom
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramCard, ListRow } from "../src/pages/DashboardPage";
import { clearThumbnailMemory } from "../src/lib/thumbnailCache";
import type { DiagramMeta } from "../src/types";

const thumbnail = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const saveThumbnail = vi.hoisted(() => vi.fn());
const renderMermaid = vi.hoisted(() => vi.fn());

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      thumbnail,
      readFile,
      saveThumbnail,
    },
  };
});

vi.mock("../src/lib/mermaidRender", () => ({
  renderMermaid,
}));

function meta(over: Partial<DiagramMeta> = {}): DiagramMeta {
  return {
    path: "WAN.mmd",
    title: "WAN",
    description: "",
    notes: "",
    tags: [],
    theme: null,
    look: null,
    layout: null,
    malformed: false,
    error: null,
    errorLine: null,
    cacheKey: "k",
    ...over,
  };
}

function renderRow(props: {
  problems?: { errors: number; warnings: number; parse?: boolean; muted?: boolean };
  diagram?: Partial<DiagramMeta>;
}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const noop = () => undefined;
  act(() => {
    root.render(
      <MemoryRouter>
        <ListRow
          path="WAN.mmd"
          meta={meta(props.diagram)}
          onTag={noop}
          mtimeMs={1_700_000_000_000}
          problems={props.problems}
          favorited={false}
          dragging={false}
          onDragStart={noop}
          onDragEnd={noop}
          onDragOver={noop}
          onDrop={noop}
          onFavorite={noop}
          onPresent={noop}
          onRename={noop}
          onMove={noop}
          onDuplicate={noop}
          onDelete={noop}
        />
      </MemoryRouter>,
    );
  });
  return { host, root };
}

describe("diagram list health", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", undefined);
    clearThumbnailMemory();
    thumbnail.mockReset();
    readFile.mockReset();
    saveThumbnail.mockReset();
    renderMermaid.mockReset();
    thumbnail.mockResolvedValue({ hit: false, path: "WAN.mmd", cacheKey: "k", mtimeMs: 1 });
    readFile.mockResolvedValue({
      path: "WAN.mmd",
      name: "WAN.mmd",
      content: "flowchart LR\n  A --> B\n",
      mtimeMs: 1,
      size: 20,
      hash: "abc",
    });
    saveThumbnail.mockResolvedValue({});
    renderMermaid.mockResolvedValue({ svg: "<svg></svg>", id: "ok" });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    clearThumbnailMemory();
  });

  function row(props: { problems?: { errors: number; warnings: number; parse?: boolean; muted?: boolean }; diagram?: Partial<DiagramMeta> }) {
    const rendered = renderRow(props);
    root = rendered.root;
    return rendered.host.querySelector(".list-row") as HTMLElement;
  }

  it("shows Parse error, with the red row, for a Mermaid syntax error", () => {
    const list = row({ problems: { errors: 1, warnings: 2, parse: true } });
    expect(list.className).toBe("list-row is-health-error");
    const pill = list.querySelector(".diagram-card-health") as HTMLElement;
    expect(pill.textContent).toBe("Parse error");
    expect(pill.getAttribute("title")).toBe("Parse error");
    expect(pill.className).toContain("thumb-badge");
    expect(pill.className).not.toContain("is-warning");
    expect(list.textContent).not.toContain("1 error");
    expect(list.textContent).not.toContain("Settings error");
  });

  it("shows Settings error and a tooltip that names front matter and the line", () => {
    const list = row({
      problems: { errors: 1, warnings: 3, parse: false },
      diagram: { malformed: true, errorLine: 3, error: "bad yaml" },
    });
    expect(list.className).toContain("is-health-error");
    expect(list.className).not.toContain("is-health-warning");
    const pill = list.querySelector(".diagram-card-health") as HTMLElement;
    expect(pill.textContent).toBe("Settings error");
    expect(pill.getAttribute("title")).toBe(
      "The settings block at the top of the file (front matter) has an error on line 3.",
    );
    expect(pill.getAttribute("title")).toContain("front matter");
    expect(pill.className).toContain("thumb-badge");
    expect(pill.className).not.toContain("is-warning");
    expect(list.textContent).not.toContain("Parse error");
    expect(list.textContent).not.toContain("Front matter error");
    expect(list.textContent).toContain("Settings need a fix");
    expect(list.textContent).not.toContain("Front matter needs a fix");

    const cardHost = document.createElement("div");
    document.body.appendChild(cardHost);
    const cardRoot = createRoot(cardHost);
    const noop = () => undefined;
    act(() => {
      cardRoot.render(
        <MemoryRouter>
          <DiagramCard
            path="WAN.mmd"
            meta={meta({ malformed: true, errorLine: 3, error: "bad yaml" })}
            onTag={noop}
            mtimeMs={1_700_000_000_000}
            problems={{ errors: 1, warnings: 3, parse: false }}
            favorited={false}
            dragging={false}
            onDragStart={noop}
            onDragEnd={noop}
            onDragOver={noop}
            onDrop={noop}
            onFavorite={noop}
            onPresent={noop}
            onRename={noop}
            onMove={noop}
            onDuplicate={noop}
            onDelete={noop}
          />
        </MemoryRouter>,
      );
    });
    const card = cardHost.querySelector("article") as HTMLElement;
    expect(card.textContent).toContain("Settings error");
    expect(card.textContent).toContain("Settings need a fix");
    expect(card.textContent).not.toContain("Front matter needs a fix");
    expect(card.textContent).not.toContain("Front matter error");
    const cardPill = card.querySelector(".diagram-card-health") as HTMLElement;
    expect(cardPill.getAttribute("title")).toBe(
      "The settings block at the top of the file (front matter) has an error on line 3.",
    );
    act(() => cardRoot.unmount());
  });

  it("shows a yellow warnings pill when warnings are unmuted", () => {
    const list = row({ problems: { errors: 0, warnings: 3, muted: false } });
    expect(list.className).toBe("list-row is-health-warning");
    const pill = list.querySelector(".diagram-card-health") as HTMLElement;
    expect(pill.textContent).toBe("3 warnings");
    expect(pill.className).toContain("is-warning");
    expect(pill.getAttribute("title")).toBe("3 warnings");
  });

  it("shows nothing when warnings are muted", () => {
    const list = row({ problems: { errors: 0, warnings: 4, muted: true } });
    expect(list.className).toBe("list-row");
    expect(list.querySelector(".thumb-badge")).toBeNull();
    expect(list.textContent).not.toContain("warning");
  });

  it("shows nothing for a clean diagram", () => {
    const list = row({ problems: { errors: 0, warnings: 0 } });
    expect(list.className).toBe("list-row");
    expect(list.querySelector(".thumb-badge")).toBeNull();
    expect(list.textContent).not.toContain("error");
  });

  it("does not keep the old front matter error label in the client", () => {
    const root = path.join(import.meta.dirname, "../src");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|css)$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes("Front matter error") || text.includes("Front matter needs a fix")) {
            hits.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });

  it("keeps the list error pill on the same red as the card, in both themes", () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, "../src/index.css"), "utf8");
    expect(css).toMatch(/\.card\.is-health-error,\s*\.list-row\.is-health-error\s*\{[^}]*#6b3030/);
    expect(css).toMatch(/\.list-row \.diagram-card-health\s*\{[^}]*position:\s*static/);
    expect(css).toMatch(/\.thumb-badge\s*\{[^}]*background:\s*#6b3030/);
    expect(css).toMatch(/\.thumb-badge\s*\{[^}]*color:\s*#ffd7d7/);
    expect(css).toMatch(/\.thumb-badge\.is-warning\s*\{[^}]*color:\s*var\(--card-warn-ink\)/);
  });
});
