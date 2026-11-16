/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/index.css");
const css = readFileSync(cssPath, "utf8");

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
});

function mountPane() {
  document.body.innerHTML = `
    <div class="editor-layout">
      <div><header class="editor-top">Top</header></div>
      <div class="editor-panels">
        <section class="panel code-panel">
          <div class="panel-header"><h2>Code</h2></div>
          <div class="code-editor-wrap">
            <div class="mermaid-code-editor">
              <div class="mermaid-cm cm-theme-dark">
                <div class="cm-editor">
                  <div class="cm-scroller">
                    <div class="cm-content" style="height: 4800px; width: 2400px">long line</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
  const layout = document.querySelector(".editor-layout") as HTMLElement;
  layout.style.height = "800px";
  layout.style.width = "1200px";
}

describe("code pane scroll containment", () => {
  it("bounds .cm-editor and makes .cm-scroller the scroll container", () => {
    mountPane();
    const pane = document.querySelector(".mermaid-code-editor") as HTMLElement;
    const mount = document.querySelector(".mermaid-cm") as HTMLElement;
    const editor = document.querySelector(".cm-editor") as HTMLElement;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const paneStyle = getComputedStyle(pane);
    const mountStyle = getComputedStyle(mount);
    const editorStyle = getComputedStyle(editor);
    const scrollerStyle = getComputedStyle(scroller);

    const zero = (value: string) => value === "0px" || value === "0";
    expect(paneStyle.overflow).toBe("hidden");
    expect(zero(paneStyle.minHeight)).toBe(true);
    expect(mountStyle.display).toBe("flex");
    expect(mountStyle.overflow).toBe("hidden");
    expect(zero(mountStyle.minHeight)).toBe(true);
    expect(editorStyle.overflow).toBe("hidden");
    expect(zero(editorStyle.minHeight)).toBe(true);
    expect(editorStyle.maxHeight).toBe("100%");
    const scrollable = [scrollerStyle.overflow, scrollerStyle.overflowX, scrollerStyle.overflowY].join(" ");
    expect(scrollable).toMatch(/auto|scroll/);
    expect(scrollerStyle.overflow).not.toBe("hidden");
    expect(scrollerStyle.overflow).not.toBe("visible");
    expect(zero(scrollerStyle.minHeight)).toBe(true);
    expect(zero(scrollerStyle.minWidth)).toBe(true);

    if (scroller.clientHeight > 0) {
      expect(editor.clientHeight).toBeLessThan(4000);
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
      scroller.scrollTop = 240;
      expect(scroller.scrollTop).toBeGreaterThan(0);
      scroller.scrollLeft = 180;
      expect(scroller.scrollLeft).toBeGreaterThan(0);
    }
  });

  it("keeps the theme on one variable set instead of a media query", () => {
    expect(css).not.toMatch(/@media\s*\(\s*prefers-color-scheme/);
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain("--bg:");
  });
});
