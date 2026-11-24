/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DataFolderNotes, DataHealthNotice } from "../src/components/DataHealthNotice";
import type { DataDoctorReport, DataHealthIssue } from "../src/types";

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
});
