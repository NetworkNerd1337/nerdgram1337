import { describe, expect, it } from "vitest";
import { importDiagramData } from "../src/diagramData.js";
import { validateNetwork } from "../src/network/validate.js";

const base = {
  schemaVersion: 1,
  devices: [{ name: "core" }, { name: "dist" }],
  interfaces: [
    { device: "core", name: "Gi0/0", ipv4: [{ address: "10.0.0.1", prefix: 30 }] },
    { device: "dist", name: "Gi0/1", ipv4: [{ address: "10.0.0.2", prefix: 30 }] },
  ],
};

describe("inferred links", () => {
  it("draws a dashed edge when inferred is true and a solid edge when it is omitted", () => {
    const inferred = importDiagramData({
      text: JSON.stringify({
        ...base,
        links: [{ a: { device: "core", interface: "Gi0/0" }, b: { device: "dist", interface: "Gi0/1" }, inferred: true }],
      }),
      format: "network",
      view: "l2",
      sourceFile: "inferred.network.json",
    });
    expect(inferred.errors).toEqual([]);
    expect(inferred.mermaid).toContain("-.->");
    expect(inferred.mermaid).not.toMatch(/[^.]-->/);

    const layer3 = importDiagramData({
      text: JSON.stringify({
        ...base,
        links: [{ a: { device: "core", interface: "Gi0/0" }, b: { device: "dist", interface: "Gi0/1" }, inferred: true }],
      }),
      format: "network",
      view: "l3",
      sourceFile: "inferred.network.json",
    });
    expect(layer3.errors).toEqual([]);
    expect(layer3.mermaid).toContain("-.->");

    const solid = importDiagramData({
      text: JSON.stringify({
        ...base,
        links: [{ a: { device: "core", interface: "Gi0/0" }, b: { device: "dist", interface: "Gi0/1" }, label: "uplink" }],
      }),
      format: "network",
      view: "l2",
      sourceFile: "solid.network.json",
    });
    expect(solid.mermaid).toContain("-->");
    expect(solid.mermaid).not.toContain("-.->");
    expect(validateNetwork(JSON.parse(solid.mermaid ? JSON.stringify({ ...base, links: [{ a: { device: "core", interface: "Gi0/0" }, b: { device: "dist", interface: "Gi0/1" } }] }) : "{}")).issues).toEqual([]);
  });

  it("rejects a non-boolean inferred flag and still accepts an older link", () => {
    const bad = validateNetwork({
      schemaVersion: 1,
      devices: [{ name: "core" }, { name: "dist" }],
      interfaces: [],
      links: [{ a: { device: "core", interface: "Gi0/0" }, b: { device: "dist", interface: "Gi0/1" }, inferred: "yes" }],
    });
    expect(bad.issues.some((issue) => issue.path.endsWith("/inferred"))).toBe(true);
    const older = validateNetwork({
      schemaVersion: 1,
      devices: [{ name: "core" }],
      interfaces: [{ device: "core", name: "Gi0/0" }],
      links: [{ a: { device: "core", interface: "Gi0/0" }, b: { device: "core", interface: "Gi0/1" } }],
    });
    expect(older.issues.filter((issue) => issue.message.includes("inferred"))).toEqual([]);
  });
});
