/**
 * @vitest-environment happy-dom
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { UpgradeBlockers } from "../src/components/DataFolderExtras";
import type { DataDoctorReport } from "../src/types";

const report: DataDoctorReport = {
  ok: true,
  dataDir: "/data",
  status: "warn",
  issues: [{ code: "newer-schema", severity: "warn", message: "favorites.json is newer." }],
  syncFolder: false,
  instanceConflict: {
    instanceId: "22222222-2222-4222-8222-222222222222",
    hostname: "other-host",
    pid: 4,
    startedAt: "2026-01-01T00:00:00.000Z",
    heartbeatAt: "2026-01-01T00:00:00.000Z",
  },
  freeBytes: 1024,
  quarantined: 0,
  writable: false,
  tempsRemoved: 0,
  quarantineSets: [],
  clashes: [],
  caseInsensitive: false,
  blockers: [
    { code: "not-writable", message: "The data folder is not writable." },
    { code: "instance-conflict", message: "Two instances share this data folder." },
    { code: "newer-schema", message: "A state file was written by a newer NerdGram." },
  ],
};

describe("upgrade blockers", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("lists the blockers the update and Docker panels show", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<UpgradeBlockers report={report} />);
    });
    expect(document.body.textContent).toContain("Fix these before you upgrade");
    expect(document.body.textContent).toContain("not writable");
    expect(document.body.textContent).toContain("Two instances");
    expect(document.body.textContent).toContain("newer NerdGram");
  });
});
