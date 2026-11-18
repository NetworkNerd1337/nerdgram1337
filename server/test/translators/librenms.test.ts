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

describe("LibreNMS translator", () => {
  it("converts devices, ports, and links, including a placeholder", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      throw new Error("translators must not call fetch");
    }) as typeof fetch;
    try {
      const result = await convertExport("librenms", translatorFixture("librenms", "campus.json"));
      expect(calls).toEqual([]);
      assertCanonical(result.document);
      const views = assertViews(result.document);
      expect(views.l3).toContain("core-rtr");
      expect(views.l3).toContain("10.1.0");
      expect(views.l2).toContain("access-a");
      expect(views.l2).toContain("Gi1/0/24");

      expect(device(result.document, "core-rtr")).toMatchObject({
        model: "ISR4451",
        platform: "iosxe",
        site: "HQ",
        managementIp: "192.0.2.1",
      });
      expect(device(result.document, "core-rtr.lab")).toBeUndefined();
      expect(device(result.document, "access-a")?.platform).toBe("C9200");
      expect(iface(result.document, "core-rtr", "Gi0/0/0")).toMatchObject({
        description: "to dist",
        speed: "10G",
        adminStatus: "up",
        operStatus: "up",
        ipv4: [{ address: "10.1.0.1", prefix: 30 }],
        ipv6: [{ address: "2001:db8:1::1", prefix: 64 }],
      });
      expect(iface(result.document, "core-rtr", "Gi0/0/0")?.vrf).toBeUndefined();
      expect(iface(result.document, "dist-sw", "Gi1/0/1")?.adminStatus).toBe("up");
      expect(iface(result.document, "dist-sw", "Gi1/0/24")).toMatchObject({
        speed: "1G",
        switchportMode: "trunk",
        nativeVlan: 99,
        trunkVlans: [10, 20],
      });
      expect(iface(result.document, "dist-sw", "Gi1/0/2")).toMatchObject({
        switchportMode: "access",
        accessVlan: 10,
      });
      expect(iface(result.document, "core-rtr", "Gi0/0/1")?.adminStatus).toBe("down");
      expect(iface(result.document, "access-a", "Gi1/0/1")?.name).toBe("Gi1/0/1");
      expect(result.document.links).toHaveLength(2);
      expect(result.document.links).toContainEqual({
        a: { device: "core-rtr", interface: "Gi0/0/0" },
        b: { device: "dist-sw", interface: "Gi1/0/1" },
      });
      expect(result.document.links).toContainEqual({
        a: { device: "dist-sw", interface: "Gi1/0/24" },
        b: { device: "access-a", interface: "Gi1/0/1" },
      });
      expect(JSON.stringify(result.document)).not.toContain("ghost");
      expect(result.warnings.some((warning) => warning.message.includes('"serial"'))).toBe(true);
      expect(result.warnings.some((warning) => /inactive link/.test(warning.message))).toBe(true);
      expect(result.warnings.some((warning) => /no remote device/.test(warning.message))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("converts a devices-only export without inventing links", async () => {
    const result = await convertExport("librenms", translatorFixture("librenms", "devices-only.json"));
    assertCanonical(result.document);
    expect(result.document.devices.map((item) => item.name)).toEqual(["core-rtr"]);
    expect(result.document.interfaces).toEqual([]);
    expect(result.document.links).toEqual([]);
    expect(result.warnings.some((warning) => warning.message.includes("No links"))).toBe(true);
  });

  it("leaves managementIp empty when ip is not an address", async () => {
    const result = await convertExport("librenms", {
      devices: [{ device_id: 1, hostname: "core-rtr", ip: "core-rtr.lab" }],
    });
    expect(result.document.devices).toEqual([{ name: "core-rtr" }]);
    expect(result.warnings.some((warning) => /not an IP address/.test(warning.message))).toBe(true);
    expect(result.document.links).toEqual([]);
  });
});
