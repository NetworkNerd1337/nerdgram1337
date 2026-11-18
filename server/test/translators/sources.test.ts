import { describe, expect, it } from "vitest";
import { parseExport, convertExport } from "../../src/translators/run.js";
import type { CanonicalDocument } from "../../src/translators/types.js";
import { assertCanonical, assertViews, translatorFixture } from "../translatorHarness.js";

function device(document: CanonicalDocument, name: string) {
  return document.devices.find((item) => item.name === name);
}

function iface(document: CanonicalDocument, deviceName: string, name: string) {
  return document.interfaces.find((item) => item.device === deviceName && item.name === name);
}

function linked(document: CanonicalDocument, left: string, right: string) {
  return document.links.some((link) => {
    const names = [link.a.device, link.b.device].sort();
    return names[0] === left && names[1] === right;
  });
}

describe("Nautobot translator", () => {
  it("maps location onto site and converts cables", async () => {
    const result = await convertExport("nautobot", translatorFixture("nautobot", "campus.json"));
    assertCanonical(result.document);
    const views = assertViews(result.document);
    expect(views.l3).toContain("core-rtr");
    expect(views.l2).toContain("dist-sw");
    expect(device(result.document, "core-rtr")).toMatchObject({
      site: "hq",
      model: "ISR4451",
      platform: "IOS-XE",
      role: "core",
      managementIp: "192.0.2.1",
    });
    expect(device(result.document, "dist-sw")?.site).toBe("hq");
    expect(iface(result.document, "core-rtr", "Gi0/0/0")).toMatchObject({
      speed: "10G",
      adminStatus: "up",
      ipv4: [{ address: "10.1.0.1", prefix: 30 }],
    });
    expect(result.document.links).toEqual([
      {
        a: { device: "core-rtr", interface: "Gi0/0/0" },
        b: { device: "dist-sw", interface: "Gi1/0/1" },
        label: "core-dist",
      },
    ]);
    expect(result.document.vlans).toEqual([
      { id: 10, name: "users" },
      { id: 99, name: "native" },
    ]);
    expect(result.warnings.some((warning) => warning.message.includes('"serial"'))).toBe(true);
    expect(JSON.stringify(result.document)).not.toContain("console");
  });

  it("accepts an older site field when location is missing", async () => {
    const result = await convertExport("nautobot", {
      devices: [{ name: "edge", site: { name: "branch" }, device_type: { model: "C8200" } }],
    });
    expect(device(result.document, "edge")?.site).toBe("branch");
    expect(result.warnings.some((warning) => warning.message.includes("site"))).toBe(true);
  });

  it("warns and invents no links when cables are missing", async () => {
    const result = await convertExport("nautobot", translatorFixture("nautobot", "devices-only.json"));
    assertCanonical(result.document);
    expect(device(result.document, "core-rtr")?.site).toBe("hq");
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
  });
});

describe("SolarWinds Orion translator", () => {
  it("maps nodes, interfaces, and topology connections", async () => {
    const result = await convertExport("orion", translatorFixture("orion", "campus.json"));
    assertCanonical(result.document);
    assertViews(result.document);
    expect(device(result.document, "core-rtr")).toMatchObject({
      managementIp: "192.0.2.1",
      model: "ISR4451",
      platform: "Cisco",
      site: "hq",
    });
    expect(device(result.document, "dist-sw")?.name).toBe("dist-sw");
    expect(iface(result.document, "core-rtr", "Gi0/0/0")).toMatchObject({ speed: "10G", adminStatus: "up", operStatus: "up" });
    expect(iface(result.document, "dist-sw", "Gi1/0/1")?.adminStatus).toBe("down");
    expect(result.document.links).toEqual([
      { a: { device: "core-rtr", interface: "Gi0/0/0" }, b: { device: "dist-sw", interface: "Gi1/0/1" } },
    ]);
    expect(linked(result.document, "core-rtr", "shadow-core")).toBe(false);
    expect(result.warnings.some((warning) => warning.message.includes("ShadowNodes"))).toBe(true);
  });

  it("warns when topology is missing", async () => {
    const result = await convertExport("orion", translatorFixture("orion", "devices-only.json"));
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
  });
});

describe("Observium translator", () => {
  it("converts devices, ports, addresses, and neighbours", async () => {
    const result = await convertExport("observium", translatorFixture("observium", "campus.json"));
    assertCanonical(result.document);
    assertViews(result.document);
    expect(device(result.document, "core-rtr")).toMatchObject({
      model: "ISR4451",
      platform: "iosxe",
      site: "hq",
      managementIp: "192.0.2.1",
    });
    expect(device(result.document, "dist-sw")?.site).toBe("hq");
    expect(iface(result.document, "core-rtr", "Gi0/0/0")).toMatchObject({
      speed: "10G",
      description: "to dist",
      ipv4: [{ address: "10.1.0.1", prefix: 30 }],
    });
    expect(iface(result.document, "dist-sw", "Gi1/0/1")?.accessVlan).toBe(10);
    expect(linked(result.document, "core-rtr", "dist-sw")).toBe(true);
    expect(device(result.document, "unknown-ap")?.name).toBe("unknown-ap");
    expect(result.document.links).toHaveLength(2);
  });

  it("warns when neighbours are missing", async () => {
    const result = await convertExport("observium", translatorFixture("observium", "devices-only.json"));
    expect(result.document.devices.map((item) => item.name)).toEqual(["core-rtr"]);
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
  });
});

describe("Netdisco translator", () => {
  it("maps neighbor rows and a remote-only placeholder", async () => {
    const result = await convertExport("netdisco", translatorFixture("netdisco", "campus.json"));
    assertCanonical(result.document);
    assertViews(result.document);
    expect(device(result.document, "core-rtr")).toMatchObject({
      managementIp: "192.0.2.1",
      model: "ISR4451",
      platform: "cisco",
      site: "hq",
    });
    expect(linked(result.document, "core-rtr", "dist-sw")).toBe(true);
    expect(device(result.document, "unknown-ap")).toBeTruthy();
    expect(result.warnings.some((warning) => warning.message.includes("MAC or ARP"))).toBe(true);
    expect(result.document.links.some((link) => link.a.interface === "GigabitEthernet1/0/3")).toBe(false);
  });

  it("invents no neighbors when the export has none", async () => {
    const result = await convertExport("netdisco", translatorFixture("netdisco", "devices-only.json"));
    expect(result.document.links).toEqual([]);
    expect(result.document.interfaces).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
  });
});

describe("Zabbix translator", () => {
  it("maps inventory and only the host edges from a map", async () => {
    const result = await convertExport("zabbix", translatorFixture("zabbix", "campus.json"));
    assertCanonical(result.document);
    assertViews(result.document);
    expect(device(result.document, "core-rtr")).toMatchObject({
      managementIp: "192.0.2.1",
      platform: "iosxe",
      model: "ISR4451",
      role: "router",
      site: "hq",
    });
    expect(result.document.devices.some((item) => item.name === "core-rtr.lab")).toBe(false);
    expect(result.document.links).toEqual([
      {
        a: { device: "core-rtr", interface: "snmp 192.0.2.1:161" },
        b: { device: "dist-sw", interface: "snmp 192.0.2.2:161" },
        label: "uplink",
      },
    ]);
  });

  it("warns when the export has no topology", async () => {
    const result = await convertExport("zabbix", translatorFixture("zabbix", "devices-only.json"));
    expect(device(result.document, "core-rtr")?.platform).toBe("linux");
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("not a topology"))).toBe(true);
  });
});

describe("Catalyst Center translator", () => {
  it("maps physical topology and bundled inventory", async () => {
    const result = await convertExport("catalyst-center", translatorFixture("catalyst-center", "campus.json"));
    assertCanonical(result.document);
    assertViews(result.document);
    expect(device(result.document, "core-rtr")).toMatchObject({
      managementIp: "192.0.2.1",
      model: "ISR4451",
      platform: "IOS-XE",
      role: "CORE",
      site: "hq",
    });
    expect(result.document.links).toEqual([
      {
        a: { device: "core-rtr", interface: "GigabitEthernet0/0/0" },
        b: { device: "dist-sw", interface: "GigabitEthernet1/0/1" },
        label: "up",
      },
    ]);
  });

  it("warns on a nodes-only export", async () => {
    const result = await convertExport("catalyst-center", translatorFixture("catalyst-center", "nodes-only.json"));
    expect(result.document.devices).toHaveLength(2);
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
  });
});

describe("Meraki translator", () => {
  it("maps lldpCdp once per port and keeps a remote placeholder", async () => {
    const result = await convertExport("meraki", translatorFixture("meraki", "campus.json"));
    assertCanonical(result.document);
    assertViews(result.document);
    expect(device(result.document, "core-sw")).toMatchObject({ model: "MS250-24", managementIp: "192.0.2.1", site: "HQ" });
    expect(result.document.links).toEqual([
      { a: { device: "core-sw", interface: "10" }, b: { device: "dist-sw", interface: "24" } },
      { a: { device: "core-sw", interface: "11" }, b: { device: "unknown-ap", interface: "eth0" } },
    ]);
  });

  it("warns when lldpCdp is missing", async () => {
    const result = await convertExport("meraki", translatorFixture("meraki", "devices-only.json"));
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
  });
});

describe("pyATS translator", () => {
  it("reads a testbed and drops credentials", async () => {
    const result = await convertExport("pyats", translatorFixture("pyats", "testbed.json"));
    assertCanonical(result.document);
    expect(device(result.document, "core-rtr")).toMatchObject({ platform: "iosxe", managementIp: "192.0.2.1" });
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("credentials"))).toBe(true);
    const dumped = JSON.stringify(result);
    expect(dumped).not.toContain("s3cret-testbed");
    expect(dumped).not.toContain("s3cret-device");
  });

  it("reads YAML testbed text", async () => {
    const parsed = parseExport("devices:\n  edge:\n    os: iosxe\n    connections:\n      cli:\n        ip: 192.0.2.8\n");
    const result = await convertExport("pyats", parsed);
    expect(device(result.document, "edge")?.managementIp).toBe("192.0.2.8");
  });

  it("maps interface learn data and LLDP neighbors", async () => {
    const result = await convertExport("pyats", translatorFixture("pyats", "learn.json"));
    assertCanonical(result.document);
    assertViews(result.document);
    expect(iface(result.document, "core-rtr", "GigabitEthernet0/0/0")).toMatchObject({
      adminStatus: "up",
      operStatus: "up",
      speed: "10G",
      description: "to dist",
      ipv4: [{ address: "10.1.0.1", prefix: 30 }],
    });
    expect(iface(result.document, "dist-sw", "Gi1/0/1")?.adminStatus).toBe("down");
    expect(result.document.links).toEqual([
      { a: { device: "core-rtr", interface: "GigabitEthernet0/0/0" }, b: { device: "dist-sw", interface: "Gi1/0/1" } },
    ]);
  });
});

describe("PRTG translator", () => {
  it("maps the devices table and only an interface column", async () => {
    const result = await convertExport("prtg", translatorFixture("prtg", "campus.json"));
    assertCanonical(result.document);
    expect(device(result.document, "core-rtr")).toMatchObject({ managementIp: "192.0.2.1", site: "HQ" });
    expect(result.document.interfaces.map((item) => item.name)).toEqual(["Gi0/0/0"]);
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("interface or port"))).toBe(true);
  });

  it("does not invent ports from a devices-only table", async () => {
    const result = await convertExport("prtg", translatorFixture("prtg", "devices-only.json"));
    expect(result.document.interfaces).toEqual([]);
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("inventory only"))).toBe(true);
  });
});

describe("Terraform translator", () => {
  it("walks a state, a child module, and skips secrets and unknown types", async () => {
    const result = await convertExport("terraform", translatorFixture("terraform", "state.json"));
    assertCanonical(result.document);
    assertViews(result.document);
    expect(device(result.document, "core-rtr")).toMatchObject({
      managementIp: "192.0.2.1",
      model: "ISR4451",
      platform: "iosxe",
      role: "core",
      site: "hq",
    });
    expect(device(result.document, "dist-sw")?.site).toBe("hq");
    expect(iface(result.document, "core-rtr", "Gi0/0/0")?.ipv4).toEqual([{ address: "10.1.0.1", prefix: 30 }]);
    expect(result.document.links).toEqual([
      {
        a: { device: "core-rtr", interface: "Gi0/0/0" },
        b: { device: "dist-sw", interface: "Gi1/0/1" },
        label: "uplink",
      },
    ]);
    expect(result.document.vlans).toEqual([{ id: 10, name: "users" }]);
    expect(result.document.devices.some((item) => item.name === "should-not-appear")).toBe(false);
    expect(result.warnings.some((warning) => warning.message.includes("aws_instance"))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("sensitive"))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("depends_on"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("s3cret-state");
  });

  it("prefers planned_values over prior_state", async () => {
    const result = await convertExport("terraform", translatorFixture("terraform", "plan.json"));
    expect(result.document.devices.map((item) => item.name)).toEqual(["planned-rtr"]);
    expect(result.document.devices.some((item) => item.name === "prior-rtr")).toBe(false);
  });

  it("invents nothing from unrelated resources", async () => {
    const result = await convertExport("terraform", translatorFixture("terraform", "empty.json"));
    expect(result.document.devices).toEqual([]);
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("aws_instance"))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("No network devices"))).toBe(true);
  });
});

describe("Batfish translator", () => {
  it("draws the layer 3 view and marks config-only edges inferred", async () => {
    const result = await convertExport("batfish", translatorFixture("batfish", "config-only.json"));
    assertCanonical(result.document);
    const views = assertViews(result.document);
    expect(views.l3).toContain("core-rtr");
    expect(views.l3).toContain("10.1.0");
    expect(views.l3).toContain("-.->");
    expect(views.l2).toContain("-.->");
    expect(result.document.links).toEqual([
      {
        a: { device: "core-rtr", interface: "GigabitEthernet0/0/0" },
        b: { device: "dist-sw", interface: "GigabitEthernet1/0/1" },
        inferred: true,
      },
    ]);
    expect(iface(result.document, "core-rtr", "GigabitEthernet0/0/0")?.speed).toBe("10G");
  });

  it("keeps layer 1 edges solid, inferred edges inferred, and unresolved neighbors as placeholders", async () => {
    const result = await convertExport("batfish", translatorFixture("batfish", "layer1.json"));
    assertCanonical(result.document);
    const views = assertViews(result.document);
    expect(views.l2).toContain("-->");
    expect(views.l2).toContain("-.->");
    expect(result.document.links).toEqual([
      { a: { device: "core-rtr", interface: "GigabitEthernet0/0/0" }, b: { device: "dist-sw", interface: "GigabitEthernet1/0/1" } },
      {
        a: { device: "core-rtr", interface: "GigabitEthernet0/0/1" },
        b: { device: "wan-rtr", interface: "GigabitEthernet0/0" },
        inferred: true,
      },
    ]);
    expect(device(result.document, "wan-rtr")).toBeTruthy();
    expect(result.document.vlans).toEqual([{ id: 10, name: "users" }]);
    expect(iface(result.document, "dist-sw", "GigabitEthernet1/0/1")?.trunkVlans).toEqual([10, 20, 21]);
    expect(result.document.links).toHaveLength(2);
  });
});
