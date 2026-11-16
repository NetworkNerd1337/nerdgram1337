/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
});

describe("appearance radio layout", () => {
  it("keeps each radio beside its label and leaves text fields full width", () => {
    document.body.innerHTML = `
      <section class="sync-card" style="width: 771px">
        <label for="host">Host</label>
        <input id="host" value="127.0.0.1" />
        <label class="sync-check">
          <input type="checkbox" />
          Private repository
        </label>
        <fieldset class="appearance-choices">
          <label class="sync-check">
            <input type="radio" name="appearance" value="light" />
            <span>Light. A light page and a light code pane.</span>
          </label>
        </fieldset>
      </section>
    `;
    const text = document.getElementById("host") as HTMLInputElement;
    const checkboxLabel = document.querySelector("label.sync-check") as HTMLElement;
    const radioLabel = document.querySelector(".appearance-choices label.sync-check") as HTMLElement;
    const radio = radioLabel.querySelector("input") as HTMLInputElement;
    const textStyle = getComputedStyle(text);
    const checkStyle = getComputedStyle(checkboxLabel);
    const radioLabelStyle = getComputedStyle(radioLabel);
    const radioStyle = getComputedStyle(radio);

    expect(textStyle.width).toBe("100%");
    expect(checkStyle.display).toBe("flex");
    expect(checkStyle.flexDirection).toBe("row");
    expect(radioLabelStyle.display).toBe("flex");
    expect(radioLabelStyle.flexDirection).toBe("row");
    expect(radioLabelStyle.alignItems).toBe("center");
    expect(radioLabelStyle.columnGap === "0.5rem" || radioLabelStyle.gap === "0.5rem").toBe(true);
    expect(radioStyle.width).not.toBe("100%");
    expect(radioStyle.width.endsWith("%")).toBe(false);
  });
});
