import { describe, expect, it } from "vitest";
import { DATA_MAX_CHARS, importDiagramData } from "../src/diagramData.js";
import { hubLeafCount } from "../src/hubLayout.js";
import { buildRouteDiagram, looksLikeIpRoute } from "../src/routing/ipRoute.js";

const ios = `core-rtr#show ip route
Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP
       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area
Gateway of last resort is 192.0.2.1 to network 0.0.0.0

      10.0.0.0/8 is variably subnetted, 2 subnets, 2 masks
C        10.1.0.0/30 is directly connected, GigabitEthernet0/0
L        10.1.0.1/32 is directly connected, GigabitEthernet0/0
O        10.2.0.0/16 [110/2] via 10.1.0.2, 00:01:02, GigabitEthernet0/0
S*       0.0.0.0/0 [1/0] via 192.0.2.1

dist-sw#show ip route
Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP
       O - OSPF, IA - OSPF inter area
C        10.1.0.0/30 is directly connected, GigabitEthernet1/0/1
L        10.1.0.2/32 is directly connected, GigabitEthernet1/0/1
C        10.2.0.0/24 is directly connected, Vlan20
L        10.2.0.1/32 is directly connected, Vlan20
O        0.0.0.0/0 [110/1] via 10.1.0.1, 00:00:11, GigabitEthernet1/0/1

access-sw#show ip route
Codes: L - local, C - connected, S - static, O - OSPF
C        10.3.0.0/24 is directly connected, Vlan30
L        10.3.0.1/32 is directly connected, Vlan30
O        10.2.0.0/16 [110/2] via 10.2.0.1, 00:00:04, Vlan30
`;

const iosXe = `iosxe-rtr#show ip route
Codes: L - local, C - connected, S - static, O - OSPF
C        10.9.0.0/31 is directly connected, GigabitEthernet0/0/0
L        10.9.0.0/32 is directly connected, GigabitEthernet0/0/0
O        10.9.9.0/24 [110/2] via 10.9.0.1, 00:00:01, GigabitEthernet0/0/0
peer-rtr#show ip route
Codes: L - local, C - connected, S - static
C        10.9.0.0/31 is directly connected, GigabitEthernet0/0/1
L        10.9.0.1/32 is directly connected, GigabitEthernet0/0/1
`;

const nxos = `nx-core# show ip route
IP Route Table for VRF "default"
'*' denotes best ucast next-hop
'**' denotes best mcast next-hop
'[x/y]' denotes [preference/metric]

10.4.0.0/30, ubest/mbest: 1/0, attached
    *via 10.4.0.1, Eth1/1, [0/0], 1w2d, direct
10.4.0.1/32, ubest/mbest: 1/0, attached
    *via 10.4.0.1, Eth1/1, [0/0], 1w2d, local
10.8.0.0/16, ubest/mbest: 1/0
    *via 10.4.0.2, Eth1/1, [110/2], 00:01:02, ospf-1, intra
0.0.0.0/0, ubest/mbest: 1/0
    *via 198.51.100.1, Eth1/2, [1/0], 2w1d, static

nx-dist# show ip route
IP Route Table for VRF "default"
10.4.0.0/30, ubest/mbest: 1/0, attached
    *via 10.4.0.2, Eth1/1, [0/0], 1w2d, direct
10.4.0.2/32, ubest/mbest: 1/0, attached
    *via 10.4.0.2, Eth1/1, [0/0], 1w2d, local
`;

const arpMac = `${ios}
dist-sw#show ip arp
Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  10.2.0.10               4   0011.2233.4401  ARPA   Vlan20
Internet  10.2.0.11               4   0011.2233.4402  ARPA   Vlan20
Internet  10.2.0.1                -   0c00.1111.2222  ARPA   Vlan20
dist-sw#show mac address-table
Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
20      0011.2233.4401    DYNAMIC     Gi1/0/5
20      0011.2233.4402    DYNAMIC     Gi1/0/5
20      0011.2233.4411    DYNAMIC     Gi1/0/48
20      0011.2233.4412    DYNAMIC     Gi1/0/48
20      0011.2233.4413    DYNAMIC     Gi1/0/48
20      0011.2233.4414    DYNAMIC     Gi1/0/48
20      0011.2233.4415    DYNAMIC     Gi1/0/48
20      0011.2233.4416    DYNAMIC     Gi1/0/48
20      0011.2233.4417    DYNAMIC     Gi1/0/48
20      0011.2233.4418    DYNAMIC     Gi1/0/48
`;

function labels(text: string, hosts?: "ports" | "port-counts" | "vlan-counts"): string[] {
  return buildRouteDiagram(text, { hosts }).nodes.map((node) => node.label);
}

describe("show ip route diagrams", () => {
  it("splits IOS prompts and matches next hops", () => {
    const diagram = buildRouteDiagram(ios);
    expect(diagram.errors).toEqual([]);
    expect(labels(ios)).toEqual(expect.arrayContaining(["core-rtr", "dist-sw", "access-sw", "unknown next hop 192.0.2.1"]));
    expect(diagram.unknownNextHops).toBe(1);
    expect(diagram.warnings.map((warning) => warning.message)).toContain("1 next hop did not match any pasted device.");
    expect(diagram.warnings.map((warning) => warning.message).join(" ")).not.toMatch(/only this device/);
    const joined = diagram.edges.map((edge) => edge.label).join(" | ");
    expect(joined).toContain("10.1.0.0/30");
    expect(joined).toMatch(/OSPF/);
    expect(diagram.nodes.some((node) => node.label === "10.2.0.0/24")).toBe(false);
  });

  it("parses IOS-XE and draws a /31 as a direct link", () => {
    const diagram = buildRouteDiagram(iosXe);
    expect(diagram.errors).toEqual([]);
    expect(labels(iosXe)).toEqual(expect.arrayContaining(["iosxe-rtr", "peer-rtr"]));
    expect(diagram.unknownNextHops).toBe(0);
    expect(diagram.edges.some((edge) => edge.label === "10.9.0.0/31")).toBe(true);
    expect(diagram.edges.some((edge) => edge.label.includes("OSPF"))).toBe(true);
  });

  it("parses NX-OS attached routes and OSPF next hops", () => {
    const diagram = buildRouteDiagram(nxos);
    expect(diagram.errors).toEqual([]);
    expect(labels(nxos)).toEqual(expect.arrayContaining(["nx-core", "nx-dist", "unknown next hop 198.51.100.1"]));
    expect(diagram.edges.some((edge) => edge.label.includes("OSPF"))).toBe(true);
    expect(diagram.edges.some((edge) => edge.label === "10.4.0.0/30")).toBe(true);
  });

  it("notes a single device and an unnamed paste", () => {
    const one = ios.split("dist-sw#")[0] ?? "";
    const single = buildRouteDiagram(one);
    expect(single.warnings.map((warning) => warning.message)).toContain(
      "This shows only this device's view. Paste routing tables from neighboring devices to build the adjacency map.",
    );
    expect(labels(one)).toContain("core-rtr");
    const bare = one.replace(/^core-rtr#show ip route\n/, "show ip route\n");
    const unnamed = buildRouteDiagram(bare);
    expect(unnamed.warnings.map((warning) => warning.message)).toContain(
      "No CLI prompt was found, so this paste is one unnamed device.",
    );
    expect(labels(bare)).toContain("Unnamed device");
  });

  it("places ARP hosts on access ports and skips a trunk", () => {
    const diagram = buildRouteDiagram(arpMac);
    expect(diagram.errors).toEqual([]);
    expect(labels(arpMac)).toEqual(expect.arrayContaining(["10.2.0.10", "10.2.0.11"]));
    expect(labels(arpMac)).not.toContain("10.2.0.1");
    expect(diagram.edges.some((edge) => edge.label.includes("Gi1/0/48"))).toBe(false);
    expect(diagram.warnings.map((warning) => warning.message).join(" ")).toMatch(/uplinks/);
    const counts = buildRouteDiagram(arpMac, { hosts: "port-counts" });
    expect(counts.nodes.some((node) => /Gi1\/0\/5 · 2 hosts/.test(node.label))).toBe(true);
    const vlans = buildRouteDiagram(arpMac, { hosts: "vlan-counts" });
    expect(vlans.nodes.some((node) => /VLAN 20 · 2 hosts/.test(node.label))).toBe(true);
  });

  it("does not infer links from ARP alone", () => {
    const onlyArp = `dist-sw#show ip route
Codes: L - local, C - connected
C        10.2.0.0/24 is directly connected, Vlan20
L        10.2.0.1/32 is directly connected, Vlan20
dist-sw#show ip arp
Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  10.2.0.10               4   0011.2233.4401  ARPA   Vlan20
`;
    const diagram = buildRouteDiagram(onlyArp);
    expect(diagram.nodes.map((node) => node.label)).not.toContain("10.2.0.10");
    expect(diagram.warnings.map((warning) => warning.message)).toContain(
      "ARP was pasted without a MAC address table, so no hosts were placed on ports.",
    );
  });

  it("treats 50 placed hosts as a hub the large-diagram warning already understands", () => {
    const lines = [
      "access-sw#show ip route",
      "Codes: L - local, C - connected",
      "C        10.20.0.0/24 is directly connected, Vlan20",
      "L        10.20.0.1/32 is directly connected, Vlan20",
      "access-sw#show ip arp",
      "Protocol  Address          Age (min)  Hardware Addr   Type   Interface",
    ];
    const mac = ["access-sw#show mac address-table", "Vlan    Mac Address       Type        Ports"];
    for (let index = 1; index <= 50; index += 1) {
      const host = index + 10;
      const macWord = index.toString(16).padStart(4, "0");
      lines.push(`Internet  10.20.0.${host}               1   0011.2200.${macWord}  ARPA   Vlan20`);
      mac.push(`20      0011.2200.${macWord}    DYNAMIC     Gi1/0/${index}`);
    }
    const result = importDiagramData({ text: `${lines.join("\n")}\n${mac.join("\n")}\n`, format: "route" });
    expect(result.errors).toEqual([]);
    expect(result.counts.nodes).toBeGreaterThanOrEqual(51);
    expect(hubLeafCount(result.mermaid)).toBeGreaterThanOrEqual(50);
  });

  it("imports a multi-megabyte routing paste under 4 MiB and refuses one byte over", () => {
    const lines = [
      "core-rtr#show ip route",
      "Codes: L - local, C - connected, S - static, B - BGP",
      "C        10.1.0.0/30 is directly connected, GigabitEthernet0/0",
      "L        10.1.0.1/32 is directly connected, GigabitEthernet0/0",
    ];
    const budget = DATA_MAX_CHARS - 120_000;
    let size = lines.join("\n").length;
    for (let index = 0; size < budget; index += 1) {
      const a = (index >>> 16) & 255;
      const b = (index >>> 8) & 255;
      const c = index & 255;
      const line = `B        ${a}.${b}.${c}.0/24 [20/0] via 10.1.0.2, 00:00:01, GigabitEthernet0/0`;
      lines.push(line);
      size += line.length + 1;
    }
    lines.push(
      "dist-sw#show ip route",
      "Codes: L - local, C - connected",
      "C        10.1.0.0/30 is directly connected, GigabitEthernet1/0/1",
      "L        10.1.0.2/32 is directly connected, GigabitEthernet1/0/1",
      "dist-sw#show mac address-table",
      "Vlan    Mac Address       Type        Ports",
    );
    for (let index = 0; index < 2000; index += 1) {
      lines.push(`20      0011.3300.${index.toString(16).padStart(4, "0")}    DYNAMIC     Gi1/0/48`);
    }
    const text = `${lines.join("\n")}\n`;
    expect(text.length).toBeGreaterThan(3 * 1024 * 1024);
    expect(text.length).toBeLessThanOrEqual(DATA_MAX_CHARS);
    const started = Date.now();
    const result = importDiagramData({ text, format: "route", title: "Big" });
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(result.errors).toEqual([]);
    expect(result.counts.edges).toBeLessThan(20);
    expect(result.mermaid).toMatch(/\d+ prefixes BGP/);
    expect(result.mermaid).toContain("core-rtr");
    expect(result.mermaid).toContain("dist-sw");
    const over = `${text}${"x".repeat(DATA_MAX_CHARS - text.length + 1)}`;
    expect(over.length).toBe(DATA_MAX_CHARS + 1);
    expect(() => importDiagramData({ text: over, format: "route" })).toThrow(
      /Data is larger than 4 MiB \(about 3,000 CDP detail neighbors\)/,
    );
  }, 20_000);

  it("rejects junk and non-Cisco route output", () => {
    expect(looksLikeIpRoute("hello world")).toBe(false);
    expect(buildRouteDiagram("hello world").errors[0]?.message).toMatch(/not Cisco IOS, IOS-XE, or NX-OS/);
    const juniper = `router> show route\ninet.0: 2 destinations, 2 routes\n0.0.0.0/0 *[Static/5] 00:01:00\n                    > to 192.0.2.1 via ge-0/0/0.0\n`;
    expect(buildRouteDiagram(juniper).errors[0]?.message).toMatch(/not Cisco IOS, IOS-XE, or NX-OS/);
    expect(buildRouteDiagram("core#show cdp neighbors detail\nDevice ID: dist\n").errors[0]?.message).toMatch(/not Cisco/);
  });
});
