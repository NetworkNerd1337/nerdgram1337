import { describe, expect, it } from "vitest";
import { convertExport } from "../../src/translators/run.js";
import type { CanonicalDocument } from "../../src/translators/types.js";
import { assertCanonical, assertViews, translatorFixture } from "../translatorHarness.js";

function device(document: CanonicalDocument, name: string) {
  return document.devices.find((item) => item.name === name);
}

function iface(document: CanonicalDocument, deviceName: string, name: string) {
  return document.interfaces.find((item) => item.device === deviceName && item.name === name);
}

describe("NetBox translator", () => {
  it("converts the campus export and both views", async () => {
    const result = await convertExport("netbox", translatorFixture("netbox", "campus.json"));
    assertCanonical(result.document);
    const views = assertViews(result.document);
    expect(views.l3).toContain("core-rtr");
    expect(views.l3).toContain("10.1.0");
    expect(views.l2).toContain("core-rtr");
    expect(views.l2).toContain("dist-sw");
    expect(views.l2).toContain("access-a");

    expect(device(result.document, "core-rtr")).toMatchObject({
      model: "ISR4451",
      platform: "IOS-XE",
      role: "core",
      site: "hq",
      managementIp: "192.0.2.1",
    });
    expect(device(result.document, "dist-sw")?.role).toBe("distribution");
    expect(iface(result.document, "core-rtr", "Gi0/0/0")).toMatchObject({
      speed: "10G",
      adminStatus: "up",
      description: "to dist",
      ipv4: [{ address: "10.1.0.1", prefix: 30 }],
      ipv6: [{ address: "2001:db8:1::1", prefix: 64 }],
    });
    expect(iface(result.document, "dist-sw", "Gi1/0/24")).toMatchObject({
      speed: "1G",
      switchportMode: "trunk",
      nativeVlan: 99,
      trunkVlans: [10, 20],
    });
    expect(iface(result.document, "access-a", "Gi1/0/2")).toMatchObject({
      speed: "100M",
      switchportMode: "access",
      accessVlan: 10,
    });
    expect(iface(result.document, "access-a", "Gi1/0/3")?.lag).toBe("Po1");
    expect(iface(result.document, "core-rtr", "Gi0/0/1")?.adminStatus).toBe("down");
    expect(result.document.links).toEqual([
      { a: { device: "core-rtr", interface: "Gi0/0/0" }, b: { device: "dist-sw", interface: "Gi1/0/1" }, label: "core-dist" },
      { a: { device: "dist-sw", interface: "Gi1/0/24" }, b: { device: "access-a", interface: "Gi1/0/1" }, label: "dist-access" },
    ]);
    expect(result.document.links.some((link) => link.a.interface === "Gi1/0/2" || link.b.interface === "Gi1/0/2")).toBe(false);
    expect(result.document.vlans).toEqual([
      { id: 10, name: "users" },
      { id: 20, name: "servers" },
      { id: 99, name: "native" },
    ]);
    expect(result.warnings.some((warning) => warning.message.includes('"serial"'))).toBe(true);
  });

  it("converts a devices-only export without inventing links", async () => {
    const result = await convertExport("netbox", translatorFixture("netbox", "devices-only.json"));
    assertCanonical(result.document);
    expect(result.document.devices.map((item) => item.name)).toEqual(["core-rtr"]);
    expect(result.document.interfaces).toEqual([]);
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("No interfaces"))).toBe(true);
  });

  it("warns on an unmapped field and does not turn it into a link", async () => {
    const result = await convertExport("netbox", {
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 1, name: "core-rtr", serial: "ABC", comments: "uplink to dist Gi0/1" }],
    });
    expect(result.document.links).toEqual([]);
    expect(result.document.devices).toEqual([{ name: "core-rtr" }]);
    expect(result.warnings.some((warning) => warning.message.includes('"serial"'))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes('"comments"'))).toBe(true);
  });

  it("does not fetch a next page and keeps the rows in the file", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      throw new Error("translators must not call fetch");
    }) as typeof fetch;
    try {
      const result = await convertExport("netbox", {
        count: 1,
        next: "https://netbox.example/api/dcim/devices/?offset=50",
        previous: null,
        results: [{ id: 1, name: "core-rtr", device_type: { model: "ISR4451" } }],
      });
      expect(calls).toEqual([]);
      expect(result.document.devices.map((item) => item.name)).toEqual(["core-rtr"]);
      expect(result.warnings.some((warning) => /does not fetch/i.test(warning.message))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reads an older cable and ignores a console cable", async () => {
    const result = await convertExport("netbox", {
      devices: [{ id: 1, name: "core-rtr" }, { id: 2, name: "dist-sw" }],
      interfaces: [
        { id: 10, device: { name: "core-rtr" }, name: "Gi0/0/0", enabled: true },
        { id: 11, device: { name: "dist-sw" }, name: "Gi1/0/1", enabled: true },
      ],
      cables: [
        {
          label: "old",
          termination_a_type: "dcim.interface",
          termination_a_id: 10,
          termination_a: { device: { name: "core-rtr" }, name: "Gi0/0/0" },
          termination_b_type: "dcim.interface",
          termination_b_id: 11,
          termination_b: { device: { name: "dist-sw" }, name: "Gi1/0/1" },
        },
        {
          termination_a_type: "dcim.consoleport",
          termination_a_id: 3,
          termination_b_type: "dcim.consoleport",
          termination_b_id: 4,
        },
      ],
    });
    expect(result.document.links).toEqual([
      { a: { device: "core-rtr", interface: "Gi0/0/0" }, b: { device: "dist-sw", interface: "Gi1/0/1" }, label: "old" },
    ]);
    expect(result.warnings.some((warning) => /Ignored 1 cable/.test(warning.message))).toBe(true);
    assertCanonical(result.document);
  });
});
