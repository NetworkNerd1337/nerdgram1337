import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { relocatedCompanionPath } from "../src/diagramCompanions.js";
import {
  extractGenerated,
  importDiagramData,
  readDataSource,
  renderRefresh,
} from "../src/diagramData.js";
import { lintDiagram } from "../src/diagramLint.js";
import { ipv4Network, ipv6Network } from "../src/network/ip.js";
import { validateNetwork } from "../src/network/validate.js";
import { compressVlans } from "../src/network/vlans.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const samplePath = path.join(root, "docs/samples/network/campus.network.json");
const sampleText = fs.readFileSync(samplePath, "utf8");
const sample = JSON.parse(sampleText) as Record<string, unknown>;

function generated(text: string, extra: Record<string, unknown> = {}): string {
  const result = importDiagramData({ text, format: "network", view: "l3", sourceFile: "campus.network.json", ...extra });
  expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  return extractGenerated(result.mermaid) ?? "";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("network schema", () => {
  it("accepts the campus sample and rejects bad files at the field", () => {
    expect(validateNetwork(sample).issues).toEqual([]);
    const schema = JSON.parse(fs.readFileSync(path.join(root, "docs/schema/network.schema.json"), "utf8")) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(["schemaVersion", "devices", "interfaces"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["devices", "format", "interfaces", "links", "neighbors", "schemaVersion", "vlans"].sort(),
    );

    const missing = clone(sample);
    delete missing.schemaVersion;
    expect(validateNetwork(missing).issues).toEqual([
      { path: "/schemaVersion", message: "schemaVersion must be 1." },
    ]);

    const badPrefix = clone(sample) as { interfaces: { ipv4?: { prefix: number }[] }[] };
    badPrefix.interfaces[1]!.ipv4![0]!.prefix = 33;
    expect(validateNetwork(badPrefix).issues.map((issue) => issue.path)).toContain("/interfaces/1/ipv4/0/prefix");

    const badAddress = clone(sample) as { interfaces: { ipv4?: { address: string }[] }[] };
    badAddress.interfaces[1]!.ipv4![0]!.address = "10.1.0";
    const address = validateNetwork(badAddress).issues.find((issue) => issue.path === "/interfaces/1/ipv4/0/address");
    expect(address?.message).toBe("address must be an IPv4 address.");

    const extra = clone(sample) as { devices: Record<string, unknown>[] };
    extra.devices[0]!.serial = "ABC";
    expect(validateNetwork(extra).issues).toContainEqual({
      path: "/devices/0/serial",
      message: 'unexpected property "serial".',
    });

    const duplicate = clone(sample) as { devices: { name: string }[] };
    duplicate.devices.push({ name: "Core-Rtr" });
    expect(validateNetwork(duplicate).issues).toContainEqual({
      path: "/devices/5/name",
      message: 'duplicate device "core-rtr".',
    });

    const missingDevice = clone(sample) as { interfaces: { device: string }[] };
    missingDevice.interfaces[0]!.device = "missing";
    expect(validateNetwork(missingDevice).issues).toContainEqual({
      path: "/interfaces/0/device",
      message: 'no device named "missing".',
    });

    const mode = clone(sample) as { interfaces: { switchportMode?: string }[] };
    const trunk = mode.interfaces.find((item) => item.switchportMode === "trunk");
    expect(trunk).toBeTruthy();
    trunk!.switchportMode = "hybrid";
    expect(validateNetwork(mode).issues.some((issue) => issue.message.includes("access or trunk"))).toBe(true);

    const vlan = clone(sample) as { vlans: { id: number }[] };
    vlan.vlans[0]!.id = 0;
    expect(validateNetwork(vlan).issues[0]?.path).toBe("/vlans/0/id");

    expect(() => importDiagramData({ text: "{", format: "network", view: "l3" })).toThrow(/not valid JSON/);
    expect(() => importDiagramData({ text: sampleText, format: "network" })).toThrow(/view must be l3 or l2/);
    expect(() => importDiagramData({ text: sampleText, format: "network", view: "l3", vlan: 10 })).toThrow(/Layer 2/);
  });
});

describe("network subnet math", () => {
  it("computes IPv4 and IPv6 networks, including /31 and /127", () => {
    expect(ipv4Network("10.1.0.1", 30)).toBe("10.1.0.0/30");
    expect(ipv4Network("10.1.0.2", 30)).toBe("10.1.0.0/30");
    expect(ipv4Network("10.1.0.4", 31)).toBe("10.1.0.4/31");
    expect(ipv4Network("10.1.0.5", 31)).toBe("10.1.0.4/31");
    expect(ipv4Network("10.1.20.3", 24)).toBe("10.1.20.0/24");
    expect(ipv4Network("10.255.0.1", 32)).toBe("10.255.0.1/32");
    expect(ipv6Network("2001:db8:1::", 127)).toBe("2001:db8:1::/127");
    expect(ipv6Network("2001:0db8:1::1", 127)).toBe("2001:db8:1::/127");
    expect(ipv6Network("2001:db8::1", 128)).toBe("2001:db8::1/128");
    expect(ipv4Network("10.01.0.1", 30)).toBeNull();
  });

  it("draws point-to-point edges, segment nodes, separate VRFs, and skips loopbacks and down interfaces", () => {
    const block = generated(sampleText);
    expect(block).toContain("10.1.0.0/30");
    expect(block).toContain("Gi0/0/0 10.1.0.1 – Gi1/0/49 10.1.0.2");
    expect(block).toContain("10.1.0.4/31");
    expect(block).toContain("Gi0/0/1 10.1.0.4 – Gi0/0/0 10.1.0.5");
    expect(block).toContain("2001:db8:1::/127");
    expect(block).toContain("Gi0/0/2 2001:db8:1:: – Gi1/0/50 2001:db8:1::1");
    expect(block).toContain('["10.1.20.0/24"]');
    expect(block).toContain('["GUEST · 10.1.20.0/24"]');
    expect(block).toContain("Lo0 10.255.0.1/32");
    expect(block).toContain("Lo0 2001:db8::1/128");
    expect(block).not.toContain("10.9.9.0/30");
    expect(block).not.toContain("mgmt 10.255.0.1");
    expect(block).toContain("mgmt 10.255.0.2");
    expect(block).toContain("core-rtr<br/>Cisco IOS-XE<br/>Lo0 10.255.0.1/32");
    expect(block).toContain("dist-sw<br/>Cisco IOS-XE<br/>mgmt 10.255.0.2");
    expect(block).not.toContain("Gi0/1/0");
    expect(block).not.toContain("Gi0/1/1");
    expect(block).not.toContain("Gi1/0/51");
    const layer3 = importDiagramData({ text: sampleText, format: "network", view: "l3", sourceFile: "campus.network.json" });
    expect(lintDiagram(layer3.mermaid).filter((item) => item.ruleId === "unconnected-node")).toEqual([]);

    const included = generated(sampleText, { includeDown: true });
    expect(included).toContain("10.9.9.0/30");
    expect(included).toContain("Gi0/0/3 10.9.9.1 – Gi0/0/1 10.9.9.2");

    const grouped = generated(sampleText, { groupBy: "vrf" });
    expect(grouped).toContain('subgraph');
    expect(grouped).toContain('["default"]');
    expect(grouped).toContain('["GUEST"]');
    expect(grouped).toContain('["default, GUEST"]');

    const alone = {
      schemaVersion: 1,
      devices: [{ name: "solo" }],
      interfaces: [{ device: "solo", name: "Vlan10", ipv4: [{ address: "192.0.2.1", prefix: 24 }] }],
    };
    const aloneBlock = generated(JSON.stringify(alone));
    expect(aloneBlock).toContain('["solo<br/>Vl10 192.0.2.1/24"]');
    expect(aloneBlock).not.toContain("192.0.2.0/24");

    const blankPlatform = {
      schemaVersion: 1,
      devices: [{ name: "solo", platform: "   " }],
      interfaces: [{ device: "solo", name: "Vlan10", ipv4: [{ address: "192.0.2.1", prefix: 24 }] }],
    };
    expect(generated(JSON.stringify(blankPlatform))).toContain('["solo<br/>Vl10 192.0.2.1/24"]');

    const layer3Platform = importDiagramData({ text: sampleText, format: "network", view: "l3", groupBy: "platform" });
    expect(layer3Platform.errors).toEqual([]);
    const layer3Block = extractGenerated(layer3Platform.mermaid) ?? "";
    expect(layer3Block).toContain("Cisco IOS-XE");
    expect(layer3Block).not.toContain("subgraph");

    const pair = {
      schemaVersion: 1,
      devices: [{ name: "a" }, { name: "b" }],
      interfaces: [
        { device: "b", name: "Eth2", ipv4: [{ address: "192.0.2.2", prefix: 24 }] },
        { device: "a", name: "Eth1", ipv4: [{ address: "192.0.2.1", prefix: 24 }] },
      ],
    };
    expect(generated(JSON.stringify(pair))).toContain('["192.0.2.0/24"]');
  });
});

describe("network layer 2", () => {
  it("compresses VLAN ranges, labels a native VLAN other than 1, and collapses a LAG", () => {
    expect(compressVlans([40, 10, 20, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39])).toBe("10,20,30-40");
    expect(compressVlans([30, 31])).toBe("30-31");

    const result = importDiagramData({
      text: sampleText,
      format: "network",
      view: "l2",
      groupBy: "site",
      sourceFile: "campus.network.json",
    });
    expect(result.errors).toEqual([]);
    const block = extractGenerated(result.mermaid) ?? "";
    expect(block).toContain("Po1 ×2");
    expect(block).toContain("Gi1/0/49 – Gi1/0/1, Gi1/0/50 – Gi1/0/2");
    expect(block).toContain("10,20,30-40 native 99 native");
    expect(block).toContain("access 20 servers");
    expect(block).toContain("access 10 users");
    expect(block).toContain("core-rtr<br/>Cisco IOS-XE");
    expect(block).toContain("L2 uplink to dist-sw – L2 uplink to core-rtr");
    expect(block).toContain("to dist-sw – to access-a");
    expect(block).toContain("Gi1/0/24 – Gi1/0/1<br/>access 20 servers");
    expect(block).toContain("Gi1/0/47 – Gi1/0/47");
    expect(block).not.toContain("native 1");
    expect(block).toContain('["hq"]');
    expect(block).toContain('["branch"]');
    expect(block).toContain("Gi0/1/0 – Gi1/0/51");
    expect(block).toContain("10,20,30-40 native 99 native");
    expect(block).toContain("Gi0/1/1 – Gi0/1/0");
    expect(block).toContain("10,20,30 native 99 native");
    expect(lintDiagram(result.mermaid).filter((item) => item.ruleId === "unconnected-node")).toEqual([]);

    const filtered = importDiagramData({ text: sampleText, format: "network", view: "l2", vlan: 20 });
    expect(filtered.errors).toEqual([]);
    const filteredBlock = extractGenerated(filtered.mermaid) ?? "";
    expect(filteredBlock).toContain("Po1 ×2");
    expect(filteredBlock).toContain("access 20 servers");
    expect(filteredBlock).toContain("10,20");
    expect(filteredBlock).not.toContain("access 10 users");

    const users = importDiagramData({ text: sampleText, format: "network", view: "l2", vlan: 10 });
    const usersBlock = extractGenerated(users.mermaid) ?? "";
    expect(usersBlock).toContain("access 10 users");
    expect(usersBlock).not.toContain("access 20 servers");
    expect(lintDiagram(filtered.mermaid).filter((item) => item.ruleId === "unconnected-node")).toEqual([]);
    expect(lintDiagram(users.mermaid).filter((item) => item.ruleId === "unconnected-node")).toEqual([]);
  });

  it("uses the existing CDP parser when neighbors are supplied, and treats Gi and GigabitEthernet as one link", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      devices: [{ name: "core-sw" }, { name: "dist-sw" }],
      interfaces: [
        { device: "core-sw", name: "Gi1/0/1", switchportMode: "trunk", trunkVlans: [10, 20], nativeVlan: 99 },
        { device: "dist-sw", name: "GigabitEthernet1/0/48", switchportMode: "trunk", trunkVlans: [10, 20], nativeVlan: 99 },
      ],
      neighbors: {
        cdp: "core-sw#show cdp neighbors detail\n-------------------------\nDevice ID: dist-sw\nPlatform: cisco C9300, Capabilities: Switch\nInterface: GigabitEthernet1/0/1, Port ID (outgoing port): GigabitEthernet1/0/48\n",
      },
      links: [
        { a: { device: "core-sw", interface: "Gi1/0/1" }, b: { device: "dist-sw", interface: "GigabitEthernet1/0/48" } },
      ],
    });
    const result = importDiagramData({ text, format: "network", view: "l2" });
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((issue) => issue.message.includes("duplicate"))).toBe(true);
    const block = extractGenerated(result.mermaid) ?? "";
    expect(block.match(/Gi1\/0\/1 – Gi1\/0\/48/g)).toHaveLength(1);
    expect(block).toContain("Gi1/0/1 – Gi1/0/48<br/>10,20 native 99");
  });

  it("groups a Layer 2 view by platform and leaves a file without those fields unchanged", () => {
    const grouped = importDiagramData({
      text: sampleText,
      format: "network",
      view: "l2",
      groupBy: "platform",
      sourceFile: "campus.network.json",
    });
    expect(grouped.errors).toEqual([]);
    expect(grouped.source).toMatchObject({ view: "l2", groupBy: "platform" });
    expect(readDataSource(grouped.mermaid)?.groupBy).toBe("platform");
    const block = extractGenerated(grouped.mermaid) ?? "";
    expect(block).toContain('subgraph');
    expect(block).toContain('["Cisco IOS-XE"]');

    const mixed = JSON.stringify({
      schemaVersion: 1,
      devices: [
        { name: "core", platform: "Cisco IOS-XE" },
        { name: "edge", platform: "Junos" },
        { name: "plain" },
      ],
      interfaces: [
        { device: "core", name: "Gi0/1", description: "to edge", switchportMode: "trunk", trunkVlans: [10] },
        { device: "edge", name: "ge-0/0/0", description: "to core", switchportMode: "trunk", trunkVlans: [10] },
        { device: "plain", name: "Gi0/1", switchportMode: "access", accessVlan: 10 },
        { device: "core", name: "Gi0/2", switchportMode: "access", accessVlan: 10 },
      ],
      links: [
        { a: { device: "core", interface: "Gi0/1" }, b: { device: "edge", interface: "ge-0/0/0" } },
        { a: { device: "core", interface: "Gi0/2" }, b: { device: "plain", interface: "Gi0/1" } },
      ],
    });
    const result = importDiagramData({ text: mixed, format: "network", view: "l2", groupBy: "platform" });
    expect(result.errors).toEqual([]);
    const mixedBlock = extractGenerated(result.mermaid) ?? "";
    expect(mixedBlock).toContain('["Cisco IOS-XE"]');
    expect(mixedBlock).toContain('["Junos"]');
    expect(mixedBlock).toContain("core<br/>Cisco IOS-XE");
    expect(mixedBlock).toContain("edge<br/>Junos");
    expect(mixedBlock).toContain('["plain"]');
    expect(mixedBlock).not.toContain("plain<br/>");
    expect(mixedBlock).toContain("to edge – to core");
    expect(mixedBlock).toContain("Gi0/2 – Gi0/1<br/>access 10");

    expect(() => importDiagramData({ text: mixed, format: "network", view: "l2", groupBy: "rack" })).toThrow(
      /vrf, site, role, or platform/,
    );
  });
});

describe("network refresh", () => {
  it("is byte-identical for the same input, ignores input order, and keeps text outside the markers", () => {
    const first = importDiagramData({ text: sampleText, format: "network", view: "l3", sourceFile: "Campus.network.json" });
    const second = importDiagramData({ text: sampleText, format: "network", view: "l3", sourceFile: "Campus.network.json" });
    expect(extractGenerated(first.mermaid)).toBe(extractGenerated(second.mermaid));
    expect(first.mermaid).toContain("format: network");
    expect(first.mermaid).toContain("view: l3");
    expect(readDataSource(first.mermaid)?.view).toBe("l3");
    expect(readDataSource(first.mermaid)?.file).toBe("Campus.network.json");

    const shuffled = clone(sample) as {
      devices: unknown[];
      interfaces: unknown[];
      links: unknown[];
      vlans: unknown[];
    };
    shuffled.devices.reverse();
    shuffled.interfaces.reverse();
    shuffled.links.reverse();
    shuffled.vlans.reverse();
    const again = importDiagramData({
      text: JSON.stringify(shuffled),
      format: "network",
      view: "l3",
      sourceFile: "Campus.network.json",
    });
    expect(extractGenerated(again.mermaid)).toBe(extractGenerated(first.mermaid));

    const noted = `${first.mermaid}%% keep this note\n`;
    const changed = clone(sample) as { devices: { name: string }[] };
    changed.devices = changed.devices.filter((device) => device.name !== "wan-rtr");
    changed.devices.push({ name: "wan-rtr" });
    const interfaces = (changed as { interfaces: { device: string }[] }).interfaces.filter(
      (item) => item.device !== "wan-rtr",
    );
    (changed as { interfaces: unknown[] }).interfaces = interfaces;
    const next = importDiagramData({
      text: JSON.stringify(changed),
      format: "network",
      view: "l3",
      sourceFile: "Campus.network.json",
    });
    const refreshed = renderRefresh(noted, next.model, { ...next.source, file: "Campus.network.json" });
    expect(refreshed).toContain("%% keep this note");
    expect(extractGenerated(refreshed)).toBe(extractGenerated(next.mermaid));
    expect(extractGenerated(refreshed)).not.toContain("10.1.0.5");
    expect(refreshed.indexOf("%% nerdgram:generated end")).toBeLessThan(refreshed.indexOf("%% keep this note"));
    expect(relocatedCompanionPath("Sites/Campus.mmd", "Regions/Core.mmd", "Sites/Campus.network.json")).toBe(
      "Regions/Core.network.json",
    );
  });
});

describe("duplicate addresses", () => {
  it("warns when two devices use the same address and does not draw that pair as a link", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      devices: [{ name: "a" }, { name: "b" }],
      interfaces: [
        { device: "a", name: "Gi0/0", ipv4: [{ address: "10.0.0.1", prefix: 31 }] },
        { device: "b", name: "Gi0/1", ipv4: [{ address: "10.0.0.1", prefix: 31 }] },
      ],
    });
    const result = importDiagramData({ text, format: "network", view: "l3" });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.message).join("\n")).toMatch(/10\.0\.0\.1\/31 is configured on more than one device \(a, b\)/);
    const block = extractGenerated(result.mermaid) ?? "";
    expect(block).not.toContain("Gi0/0 10.0.0.1 – Gi0/1 10.0.0.1");
    expect(block).toContain("Gi0/0 10.0.0.1/31");
    expect(block).toContain("Gi0/1 10.0.0.1/31");
  });
});
