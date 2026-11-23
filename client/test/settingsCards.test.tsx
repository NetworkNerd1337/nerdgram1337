/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsCard, SettingsCardsProvider, defaultCardOpen } from "../src/components/SettingsCard";

const ids = ["appearance", "host", "github-sync"];

function render(hash = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <SettingsCardsProvider ids={ids} initialHash={hash}>
        <nav className="settings-nav">
          <a
            href="#host"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("host")?.querySelector("button")?.click();
            }}
          >
            Host
          </a>
        </nav>
        <SettingsCard id="appearance" title="Appearance" summary="Theme: Dark">
          <p>Appearance body</p>
        </SettingsCard>
        <SettingsCard id="host" title="Host" summary="Host: 127.0.0.1" badge="Not loopback">
          <p>Host body</p>
        </SettingsCard>
        <SettingsCard id="github-sync" title="GitHub sync" summary="Off">
          <p>Sync body</p>
        </SettingsCard>
      </SettingsCardsProvider>,
    );
  });
  return root;
}

describe("settings cards", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("starts with Appearance open and the other cards collapsed", () => {
    expect(defaultCardOpen("appearance", {})).toBe(true);
    expect(defaultCardOpen("host", {})).toBe(false);
    root = render();
    expect(document.getElementById("appearance-panel")?.hidden).toBe(false);
    expect(document.getElementById("host-panel")?.hidden).toBe(true);
    expect(document.querySelector("#host .settings-card-chevron")?.getAttribute("data-open")).toBe("false");
    const hostButton = document.querySelector<HTMLButtonElement>("#host button");
    act(() => {
      hostButton?.click();
    });
    expect(document.getElementById("host-panel")?.hidden).toBe(false);
    expect(document.getElementById("host")?.className).toContain("is-active");
    expect(document.getElementById("appearance")?.className).not.toContain("is-active");
    expect(localStorage.getItem("nerdgram.settingsCards")).toContain('"host":true');
  });

  it("expands and highlights a collapsed card from its anchor and from a deep link", () => {
    root = render("#host");
    expect(document.getElementById("host-panel")?.hidden).toBe(false);
    expect(document.getElementById("host")?.className).toContain("is-active");
    expect(document.getElementById("github-sync")?.className).not.toContain("is-active");
  });
});
