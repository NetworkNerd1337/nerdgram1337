import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutSummary } from "../src/components/UpdateHost";
import { SupportLink } from "../src/components/SupportLink";
import { KOFI_URL } from "../src/lib/support";
import type { UpdateStatus } from "../src/types";

const clientSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function source(relativePath: string): string {
  return readFileSync(path.join(clientSrc, relativePath), "utf8");
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function anchors(html: string): { href: string; target: string | null; rel: string | null }[] {
  const found = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/g)) {
    const attrs = match[1] ?? "";
    found.push({
      href: /href="([^"]*)"/.exec(attrs)?.[1] ?? "",
      target: /target="([^"]*)"/.exec(attrs)?.[1] ?? null,
      rel: /rel="([^"]*)"/.exec(attrs)?.[1] ?? null,
    });
  }
  return found;
}

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    enabled: true,
    automatic: true,
    includePrerelease: false,
    installKind: "git",
    currentVersion: "1.4.4",
    codename: "Atlas",
    commit: "abc1234def5678901234567890abcdef12345678",
    phase: "current",
    updateAvailable: false,
    skipped: false,
    dismissed: false,
    skippedVersions: [],
    latest: null,
    checkedAt: null,
    error: null,
    canApply: false,
    matchesLatest: true,
    docker: null,
    ...overrides,
  };
}

function renderAbout(
  overrides: Partial<UpdateStatus> = {},
  actionError: string | null = null,
  onShowUpgrade?: () => void,
): string {
  return renderToStaticMarkup(
    createElement(AboutSummary, { status: status(overrides), actionError, onShowUpgrade }),
  );
}

describe("Support button", () => {
  it("opens Ko-fi in a new tab with an accessible name", () => {
    const html = renderToStaticMarkup(createElement(SupportLink));
    const link = anchors(html)[0];
    expect(link?.href).toBe(KOFI_URL);
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
    expect(html).toContain('aria-label="Support NerdGram1337 on Ko-fi"');
    expect(html).toContain('title="Support NerdGram1337 on Ko-fi"');
    expect(visibleText(html)).toContain("Support");
    expect(html).toContain('aria-hidden="true"');
  });

  it("keeps a longer label in the About dialog", () => {
    const html = renderToStaticMarkup(
      createElement(SupportLink, { label: "Support on Ko-fi", keepLabel: true }),
    );
    expect(html).toContain("support-link-text");
    expect(visibleText(html)).toContain("Support on Ko-fi");
    expect(anchors(html)[0]?.href).toBe(KOFI_URL);
  });

  it("is in the dashboard, paste, and editor headers, and hidden while presenting", () => {
    expect(source("pages/DashboardPage.tsx")).toContain("<SupportLink />");
    expect(source("pages/NewDiagramPage.tsx")).toContain("<SupportLink />");
    expect(source("pages/EditorPage.tsx")).toContain("presenting ? null : <SupportLink />");
    expect(source("pages/GeneratePage.tsx")).toContain("<SupportLink />");
    expect(source("pages/SettingsPage.tsx")).toContain("<SupportLink />");
    expect(source("pages/TemplatesPage.tsx")).toContain("<SupportLink />");
    expect(source("pages/ReferencePage.tsx")).toContain("<SupportLink />");
    expect(source("pages/PresentPage.tsx")).not.toContain("SupportLink");
    expect(source("pages/TemplatePresentPage.tsx")).not.toContain("SupportLink");
    expect(source("components/PresentationView.tsx")).not.toContain("SupportLink");

    const css = readFileSync(path.join(clientSrc, "index.css"), "utf8");
    expect(css).toContain('body[data-presenting="true"] .support-link');
    expect(css).toContain(".support-link:not(.support-link-text) .support-link-label");
  });
});

describe("About dialog content", () => {
  it("shows the version, code name, install, commit, author, help, license, and Ko-fi", () => {
    const html = renderAbout();
    const text = visibleText(html);
    expect(text).toContain("NerdGram1337");
    expect(text).toContain("A local app for writing Mermaid diagrams as Markdown.");
    expect(text).toContain('v1.4.4 "Atlas"');
    expect(text).toContain("Code name");
    expect(text).toContain("Atlas");
    expect(text).toContain("git clone");
    expect(text).toContain("abc1234def5678901234567890abcdef12345678");
    expect(text).toContain("You're up to date.");
    expect(text).toContain("Ryan Thomas Huff");
    expect(text).toContain("NetworkNerd1337");
    expect(text).toContain("Report a bug or request a feature");
    expect(text).toContain("Documentation");
    expect(text).toContain("MIT License");
    expect(text).toContain("© Ryan Thomas Huff");
    expect(text).toContain(
      "NerdGram1337 is free and open source, built by one developer. If it's useful to you, you can support continued development.",
    );
    expect(text).toContain("Support on Ko-fi");

    const links = anchors(html);
    const hrefs = links.map((link) => link.href);
    expect(hrefs).toContain("https://ryanthomashuff.com");
    expect(hrefs).toContain("https://github.com/NetworkNerd1337");
    expect(hrefs).toContain("https://github.com/NetworkNerd1337/NerdGram1337");
    expect(hrefs).toContain("https://github.com/NetworkNerd1337/NerdGram1337/issues");
    expect(hrefs).toContain("https://github.com/NetworkNerd1337/NerdGram1337#readme");
    expect(hrefs).toContain("https://github.com/NetworkNerd1337/NerdGram1337/blob/main/LICENSE");
    expect(hrefs).toContain(KOFI_URL);
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    }
  });

  it("omits the commit and code name when they are unknown", () => {
    const text = visibleText(renderAbout({ commit: null, codename: null, matchesLatest: false, phase: "unknown" }));
    expect(text).toContain("v1.4.4");
    expect(text).not.toContain("Code name");
    expect(text).not.toContain("Atlas");
    expect(text).not.toContain("Commit");
    expect(text).not.toContain("You're up to date.");
  });

  it("names Docker, ZIP, and an available update", () => {
    const docker = visibleText(
      renderAbout({
        installKind: "docker",
        phase: "available",
        matchesLatest: false,
        updateAvailable: true,
        latest: {
          tag: "v1.2.0",
          version: "1.2.0",
          codename: "Atlas",
          name: 'v1.2.0 "Atlas"',
          body: "",
          htmlUrl: "https://github.com/NetworkNerd1337/NerdGram1337/releases/tag/v1.2.0",
          publishedAt: null,
          prerelease: false,
        },
        docker: {
          image: "ghcr.io/networknerd1337/nerdgram1337",
          tag: "v1.2.0",
          steps: [],
          compose: [],
          composeNote: "",
          persistNote: "",
        },
      },
      null,
      () => undefined,
    ),
    );
    expect(docker).toContain("Docker");
    expect(docker).toContain('Update available: v1.2.0 "Atlas".');
    expect(docker).toContain("Show upgrade steps");

    expect(visibleText(renderAbout({ installKind: "zip" }))).toContain("ZIP download");
    expect(visibleText(renderAbout({ installKind: "unknown", matchesLatest: false, phase: "unknown" }))).toContain(
      "unknown",
    );
  });
});
