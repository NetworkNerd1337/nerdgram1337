/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DataFolderNotes, DataHealthNotice } from "../src/components/DataHealthNotice";
import type { DataDoctorReport, DataHealthIssue } from "../src/types";
import { CLOUD_SYNC_DOCS_URL, syncFolderMessage } from "../../server/src/syncFolderHint.ts";

const report: DataDoctorReport = {
  ok: true,
  dataDir: "/data",
  status: "warn",
  issues: [
    { code: "quarantine", severity: "warn", message: "updates.json could not be read (empty).", file: "updates.json" },
    { code: "sync-folder", severity: "warn", message: "This data folder looks synced or shared (Dropbox)." },
  ],
  syncFolder: true,
  instanceConflict: null,
  freeBytes: 1000,
  quarantined: 1,
  writable: true,
  tempsRemoved: 0,
  quarantineSets: [],
  clashes: [],
  caseInsensitive: false,
  blockers: [],
};

describe("data folder banner", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("shows the problem count and the details", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<DataHealthNotice report={report} />);
    });
    expect(document.body.textContent).toContain("NerdGram checked the data folder and found 2 problems. You need to do something.");
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Details");
    act(() => {
      button?.click();
    });
    const dialog = document.querySelector("[role=dialog]");
    expect(dialog?.textContent).toContain("updates.json");
    expect(dialog?.textContent).toContain("NerdGram's own settings/history files (not your diagrams)");
    expect(dialog?.textContent).not.toContain("app state");
    expect(dialog?.textContent).toContain("Dropbox");
    expect(dialog?.textContent).not.toContain("ghp_");
  });

  it("hides the banner for an info-only case-fold note", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const note: DataHealthIssue = {
      code: "case-fold",
      severity: "info",
      message:
        "Your disk treats uppercase and lowercase file names as the same. No action needed. NerdGram won't let a rename change only capitalization, so a diagram can't be overwritten.",
    };
    act(() => {
      root?.render(<DataHealthNotice report={{ ...report, status: "ok", issues: [note] }} />);
    });
    expect(document.querySelector(".data-health-banner")).toBeNull();
    act(() => {
      root?.render(<DataFolderNotes notes={[note]} />);
    });
    expect(document.body.textContent).toContain("No action needed");
  });

  it("does not name settings files when no problem names a file", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <DataHealthNotice
          report={{
            ...report,
            issues: [{ code: "sync-folder", severity: "warn", message: "This data folder looks synced or shared (Dropbox)." }],
          }}
        />,
      );
    });
    const details = [...document.querySelectorAll("button")].find((item) => item.textContent === "Details");
    act(() => {
      details?.click();
    });
    const dialog = document.querySelector("[role=dialog]")?.textContent ?? "";
    expect(dialog).toContain("NerdGram checked the data folder");
    expect(dialog).toContain("It found 1 problem in the data folder");
    expect(dialog).toContain("You need to do something for each item below");
    expect(dialog).not.toContain("settings/history files");
    expect(dialog).not.toContain("app state");
  });

  it("links the synced-folder item to the unsupported-folder docs", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <DataHealthNotice
          report={{
            ...report,
            issues: [{ code: "sync-folder", severity: "warn", message: syncFolderMessage("OneDrive") }],
          }}
        />,
      );
    });
    const details = [...document.querySelectorAll("button")].find((item) => item.textContent === "Details");
    act(() => {
      details?.click();
    });
    const dialog = document.querySelector("[role=dialog]");
    expect(dialog?.textContent).toContain("looks synced or shared (OneDrive)");
    expect(dialog?.textContent).toContain(
      "NerdGram does not support cloud-synced folders such as OneDrive, iCloud Drive, Dropbox, or Google Drive for diagram libraries.",
    );
    expect(dialog?.textContent).toContain("SMB (Samba or Windows file share) or NFS share");
    expect(dialog?.textContent).toContain("use GitHub sync to share diagrams");
    const link = dialog?.querySelector("a");
    expect(link?.textContent).toBe("Why cloud-synced folders are unsupported");
    expect(link?.getAttribute("href")).toBe(CLOUD_SYNC_DOCS_URL);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("remembers a dismiss until the problem set changes, then clears when the problems are gone", () => {
    localStorage.clear();
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const render = (next: DataDoctorReport) => {
      act(() => {
        root?.render(<DataHealthNotice report={next} />);
      });
    };
    render(report);
    expect(document.body.textContent).toContain("found 2 problems");
    const dismiss = document.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement | null;
    act(() => {
      dismiss?.click();
    });
    expect(document.querySelector(".data-health-banner")).toBeNull();
    act(() => root?.unmount());
    root = createRoot(host);
    render(report);
    expect(document.querySelector(".data-health-banner")).toBeNull();
    render({
      ...report,
      issues: [{ code: "low-space", severity: "warn", message: "Less than 200 MB is free. Free disk space before the folder fills up." }],
    });
    expect(document.body.textContent).toContain("found 1 problem");
    render({ ...report, status: "ok", issues: [] });
    expect(document.querySelector(".data-health-banner")).toBeNull();
  });

  it("keeps the title and Close outside a long findings list", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const issues: DataHealthIssue[] = Array.from({ length: 40 }, (_, index) => ({
      code: "quarantine",
      severity: "warn",
      message: `Problem ${index} needs a look.`,
      file: `file-${index}.json`,
    }));
    act(() => {
      root?.render(<DataHealthNotice report={{ ...report, issues, quarantined: 40 }} />);
    });
    const details = [...document.querySelectorAll("button")].find((item) => item.textContent === "Details");
    act(() => {
      details?.click();
    });
    const dialog = document.querySelector("[role=dialog]");
    const scroll = dialog?.querySelector(".modal-scroll");
    const title = dialog?.querySelector("#data-health-title");
    const close = [...(dialog?.querySelectorAll("button") ?? [])].find((item) => item.textContent === "Close");
    expect(scroll?.querySelectorAll("li")).toHaveLength(40);
    expect(title).toBeTruthy();
    expect(scroll?.contains(title ?? null)).toBe(false);
    expect(close).toBeTruthy();
    expect(scroll?.contains(close ?? null)).toBe(false);
    expect(dialog?.querySelector(".modal-actions")?.contains(close ?? null)).toBe(true);
  });
});

describe("dialog viewport cap", () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");

  it("caps every modal to the viewport and scrolls the findings", () => {
    const start = css.indexOf(".modal {");
    const modal = css.slice(start, css.indexOf("}", start));
    expect(modal).toContain("max-height: calc(100vh - 2rem)");
    expect(modal).toContain("max-height: calc(100dvh - 2rem)");
    const scrollStart = css.indexOf(".modal-scroll {");
    const scroll = css.slice(scrollStart, css.indexOf("}", scrollStart));
    expect(scroll).toContain("overflow-y: auto");
  });
});
