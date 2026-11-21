import { describe, expect, it } from "vitest";
import { flowchartNodes, matchNodes, nodeFindKey, nodeFindShortcut, stepMatch } from "../src/lib/nodeFind";
import { centerViewOn, nodePointInDiagram } from "../src/lib/nodeFind";
import { metaFromSidecar } from "../src/lib/nodeMeta";
import { screenToContent } from "../src/lib/viewTransform";

const SOURCE = [
  "flowchart LR",
  'core["Core"]',
  'sw1["Switch 10.1.1.1"]',
  'sw2["Access"]',
  "core --> sw1",
  "core --> sw2",
].join("\n");

describe("node find", () => {
  it("matches a name, an id, or an IP", () => {
    const nodes = flowchartNodes(SOURCE);
    expect(matchNodes(nodes, "access").map((node) => node.id)).toEqual(["sw2"]);
    expect(matchNodes(nodes, "sw1").map((node) => node.id)).toEqual(["sw1"]);
    expect(matchNodes(nodes, "10.1.1.1").map((node) => node.id)).toEqual(["sw1"]);
  });

  it("steps to the next and previous match", () => {
    expect(stepMatch(0, 1, 3)).toBe(1);
    expect(stepMatch(2, 1, 3)).toBe(0);
    expect(stepMatch(0, -1, 3)).toBe(2);
  });

  it("centers a node and zooms in", () => {
    const content = { width: 800, height: 400 };
    const point = nodePointInDiagram({ x: 600, y: 80 }, content);
    const view = centerViewOn(point, 1.5);
    expect(view.scale).toBe(1.5);
    expect(screenToContent(view, { x: 0, y: 0 })).toEqual(point);
  });

  it("closes on Escape and leaves the code editor's own find alone", () => {
    expect(nodeFindShortcut({ key: "Escape", metaKey: false, ctrlKey: false, altKey: false }, false)).toBe("ignore");
    expect(nodeFindShortcut({ key: "f", metaKey: true, ctrlKey: false, altKey: false }, true)).toBe("ignore");
    expect(nodeFindShortcut({ key: "f", metaKey: false, ctrlKey: true, altKey: false }, false)).toBe("open");
  });

  it("matches an IP, platform, or interface from the sidecar, not the picture", () => {
    const source = ["flowchart LR", 'core["core-sw"]', 'dist["dist-sw"]', "core --> dist"].join("\n");
    const nodes = flowchartNodes(source);
    const sidecar = [
      "core-sw#show cdp neighbors detail",
      "Device ID: dist-sw",
      "  IP address: 10.1.1.2",
      "Platform: cisco WS-C3750X-48,  Capabilities: Switch",
      "Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): GigabitEthernet1/0/48",
    ].join("\n");
    const meta = metaFromSidecar(sidecar);
    expect(matchNodes(nodes, "10.1.1.2").map((node) => node.id)).toEqual([]);
    expect(matchNodes(nodes, "10.1.1.2", meta).map((node) => node.id)).toEqual(["dist"]);
    expect(matchNodes(nodes, "WS-C3750", meta).map((node) => node.id)).toEqual(["dist"]);
    expect(matchNodes(nodes, "GigabitEthernet1/0/1", meta).map((node) => node.id).sort()).toEqual(["core", "dist"]);
  });

  it("finds spoke-0042 from the address in the data file", () => {
    const source = ["flowchart LR", 'spoke0042["spoke-0042"]'].join("\n");
    const sidecar = [
      "hub#show cdp neighbors detail",
      "Device ID: spoke-0042",
      "  IP address: 10.200.1.42",
      "Platform: cisco ISR, Capabilities: Router",
      "Interface: Tunnel0, Port ID (outgoing port): Tunnel0",
    ].join("\n");
    const nodes = flowchartNodes(source);
    expect(matchNodes(nodes, "10.200.1.42").map((node) => node.label)).toEqual([]);
    expect(matchNodes(nodes, "10.200.1.42", metaFromSidecar(sidecar)).map((node) => node.label)).toEqual(["spoke-0042"]);
  });

  it("steps and closes from the keyboard while search is open", () => {
    expect(nodeFindKey({ key: "Escape" }, false)).toBe("ignore");
    expect(nodeFindKey({ key: "Escape" }, true)).toBe("close");
    expect(nodeFindKey({ key: "ArrowDown" }, true)).toBe("next");
    expect(nodeFindKey({ key: "ArrowUp" }, true)).toBe("prev");
    expect(nodeFindKey({ key: "Enter" }, true)).toBe("next");
  });
});
