/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DataHealthNotice } from "../src/components/DataHealthNotice";
import type { DataDoctorReport } from "../src/types";

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
  });

  it("shows the problem count and the details", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<DataHealthNotice report={report} />);
    });
    expect(document.body.textContent).toContain("NerdGram found 2 problems with its data folder.");
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Details");
    act(() => {
      button?.click();
    });
    const dialog = document.querySelector("[role=dialog]");
    expect(dialog?.textContent).toContain("updates.json");
    expect(dialog?.textContent).toContain("Dropbox");
    expect(dialog?.textContent).not.toContain("ghp_");
  });
});
