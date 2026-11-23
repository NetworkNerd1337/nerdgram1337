/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsCard, SettingsCardsProvider, chooseSpySection, defaultCardOpen, useSettingsCards } from "../src/components/SettingsCard";

const ids = ["appearance", "style-presets", "host", "bookmarks"];

function Marks() {
  const cards = useSettingsCards();
  return (
    <nav className="settings-nav">
      {ids.map((id) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={cards?.spyId === id ? "true" : undefined}
          onClick={(event) => {
            event.preventDefault();
            cards?.focus(id);
          }}
        >
          {id}
        </a>
      ))}
    </nav>
  );
}

function render(hash = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <SettingsCardsProvider ids={ids} initialHash={hash}>
        <Marks />
        <SettingsCard id="appearance" title="Appearance" summary="Theme: Dark">
          <p>Appearance body</p>
        </SettingsCard>
        <SettingsCard id="style-presets" title="Style presets" summary="Named copies">
          <p>Style body</p>
        </SettingsCard>
        <SettingsCard id="host" title="Host" summary="Host: 127.0.0.1">
          <p>Host body</p>
        </SettingsCard>
        <SettingsCard id="bookmarks" title="Bookmarks" summary="Saved in this browser">
          <p>Bookmark body</p>
        </SettingsCard>
      </SettingsCardsProvider>,
    );
  });
  return root;
}

function marked(): string | null {
  return document.querySelector(".settings-nav a[aria-current='true']")?.getAttribute("href")?.slice(1) ?? null;
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

  it("marks Appearance at the top, then each collapsed card in order as the page scrolls", () => {
    const tops = [
      { id: "appearance", top: 40 },
      { id: "style-presets", top: 110 },
      { id: "host", top: 180 },
      { id: "bookmarks", top: 250 },
    ];
    expect(chooseSpySection(tops, 64, { top: 0, max: 800 })).toBe("appearance");
    expect(chooseSpySection(tops.map((card) => ({ ...card, top: card.top - 80 })), 64, { top: 80, max: 800 })).toBe("style-presets");
    expect(chooseSpySection(tops.map((card) => ({ ...card, top: card.top - 150 })), 64, { top: 150, max: 800 })).toBe("host");
    expect(chooseSpySection(tops.map((card) => ({ ...card, top: card.top - 220 })), 64, { top: 220, max: 800 })).toBe("bookmarks");
    expect(chooseSpySection(tops, 64, { top: 800, max: 800 })).toBe("bookmarks");
    const rightColumn = [
      { id: "appearance", top: 48 },
      { id: "style-presets", top: 420 },
      { id: "host", top: 52 },
      { id: "bookmarks", top: 430 },
    ];
    expect(chooseSpySection(rightColumn, 64, { top: 0, max: 900 })).toBe("appearance");
    expect(chooseSpySection(rightColumn, 64, { top: 40, max: 900 })).toBe("host");
  });

  it("marks a collapsed card when its anchor is clicked", () => {
    root = render();
    expect(marked()).toBe("appearance");
    const link = document.querySelector<HTMLAnchorElement>("a[href='#host']");
    act(() => {
      link?.click();
    });
    expect(marked()).toBe("host");
    expect(document.getElementById("host-panel")?.hidden).toBe(false);
    expect(document.getElementById("host")?.className).toContain("is-active");
  });

  it("marks the card from a deep link", () => {
    root = render("#bookmarks");
    expect(marked()).toBe("bookmarks");
    expect(document.getElementById("bookmarks-panel")?.hidden).toBe(false);
    expect(document.getElementById("bookmarks")?.className).toContain("is-active");
  });

  it("marks a card when its body is clicked", () => {
    root = render();
    const body = document.querySelector<HTMLElement>("#appearance-panel p");
    act(() => {
      body?.click();
    });
    expect(document.getElementById("appearance")?.className).toContain("is-active");
    expect(marked()).toBe("appearance");
  });
});
