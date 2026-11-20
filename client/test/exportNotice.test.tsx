/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ExportWarnings } from "../src/components/ExportWarnings";
import { labExportNotice } from "../src/lib/exportNotice";

describe("lab export warnings", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("names the export and lists every warning, and stays quiet when there are none", () => {
    const warnings = [
      { path: "/nodes/core/image", message: "image is CHANGE_ME" },
      { path: "", message: "confirm the Netmiko platform" },
    ];
    const notice = labExportNotice("containerlab topology", warnings);
    expect(notice?.title).toBe("Exported containerlab topology, 2 things to review");
    expect(notice?.items).toEqual([
      "/nodes/core/image: image is CHANGE_ME",
      "confirm the Netmiko platform",
    ]);
    expect(labExportNotice("pyATS testbed", [{ message: "image is CHANGE_ME" }])?.title).toBe(
      "Exported pyATS testbed, 1 thing to review",
    );
    expect(labExportNotice("CML lab", [])).toBeNull();
    expect(labExportNotice("Nornir inventory", null)).toBeNull();
  });

  it("shows a dismissible note and nothing when the notice is empty", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let dismissed = 0;
    const notice = labExportNotice("GNS3 project", [{ path: "image", message: "image is CHANGE_ME" }]);
    act(() => {
      root?.render(<ExportWarnings notice={notice} onDismiss={() => (dismissed += 1)} />);
    });
    expect(document.body.textContent).toContain("Exported GNS3 project, 1 thing to review");
    expect(document.body.textContent).toContain("image: image is CHANGE_ME");
    act(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent === "Dismiss")?.click();
    });
    expect(dismissed).toBe(1);

    act(() => {
      root?.render(<ExportWarnings notice={null} onDismiss={() => undefined} />);
    });
    expect(document.querySelector("[role='status']")).toBeNull();
    expect(document.body.textContent).not.toContain("thing to review");
  });
});
