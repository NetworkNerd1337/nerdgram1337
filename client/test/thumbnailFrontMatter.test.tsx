/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramHealthBadge } from "../src/components/DiagramHealthBadge";
import { MermaidThumbnail, type ThumbnailStatus } from "../src/components/MermaidThumbnail";
import { diagramHealthClass, diagramSurfaceHealth } from "../src/lib/diagramCardHealth";
import { clearThumbnailMemory } from "../src/lib/thumbnailCache";

const thumbnail = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const saveThumbnail = vi.hoisted(() => vi.fn());
const renderMermaid = vi.hoisted(() => vi.fn());

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: {
      thumbnail,
      readFile,
      saveThumbnail,
    },
  };
});

vi.mock("../src/lib/mermaidRender", () => ({
  renderMermaid,
}));

const brokenHeader = "---\ntitle: [\n---\nflowchart LR\n  A[Core] --> B[Edge]\n";
const syntaxError = "flowchart LR\n  A -->\n";

function GridCard({ path, malformed, errors }: { path: string; malformed: boolean; errors: number }) {
  const [status, setStatus] = useState<ThumbnailStatus | null>(null);
  const failed = status === "failed";
  const health = diagramSurfaceHealth({
    errors,
    malformed,
    thumbnailFailed: failed,
  });
  return (
    <article className={`card${diagramHealthClass(health)}`}>
      <MermaidThumbnail path={path} mtimeMs={1} frontMatter={malformed} onStatus={setStatus} />
      <DiagramHealthBadge health={health} thumbnailShowsParseError={failed} />
    </article>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("diagram grid cards", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", undefined);
    clearThumbnailMemory();
    thumbnail.mockReset();
    readFile.mockReset();
    saveThumbnail.mockReset();
    renderMermaid.mockReset();
    saveThumbnail.mockResolvedValue({});
    thumbnail.mockResolvedValue({ hit: false, path: "WAN.mmd" });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    clearThumbnailMemory();
  });

  function render(content: string, malformed: boolean, errors: number) {
    readFile.mockResolvedValue({
      path: "WAN.mmd",
      name: "WAN.mmd",
      content,
      mtimeMs: 1,
      size: content.length,
      hash: "abc",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<GridCard path="WAN.mmd" malformed={malformed} errors={errors} />);
    });
    return host;
  }

  it("shows Settings error, not Parse error, and still draws the diagram", async () => {
    renderMermaid.mockImplementation(async (code: string) => {
      if (code.includes("title:")) throw new Error("YAML front matter");
      return { svg: "<svg id=\"ok\"></svg>", id: "ok" };
    });
    const host = render(brokenHeader, true, 1);
    await settle();
    await settle();

    const card = host.querySelector("article") as HTMLElement;
    expect(card.className).toContain("is-health-error");
    expect(card.textContent).toContain("Settings error");
    expect(card.textContent).not.toContain("Parse error");
    expect(card.textContent).not.toContain("Front matter error");
    const pill = card.querySelector(".diagram-card-health") as HTMLElement;
    expect(pill.getAttribute("title")).toContain("front matter");
    expect(card.textContent).not.toContain("Preview unavailable");
    expect(host.querySelector("img")).toBeTruthy();
    expect(renderMermaid).toHaveBeenCalled();
    const drawn = renderMermaid.mock.calls.map((call) => String(call[0])).join("\n");
    expect(drawn).toContain("flowchart LR");
    expect(drawn).not.toContain("title:");
  });

  it("keeps Parse error and the red border when Mermaid cannot draw the diagram", async () => {
    renderMermaid.mockRejectedValue(new Error("Parse error on line 2"));
    const host = render(syntaxError, false, 1);
    await settle();
    await settle();

    const card = host.querySelector("article") as HTMLElement;
    expect(card.className).toContain("is-health-error");
    expect(card.textContent).toContain("Parse error");
    expect(card.textContent).toContain("Preview unavailable");
    expect(card.textContent).not.toContain("Front matter error");
    expect(card.textContent).not.toContain("Settings error");
    expect(host.querySelector("img")).toBeNull();
  });
});
