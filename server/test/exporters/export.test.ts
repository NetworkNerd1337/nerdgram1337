import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { campusDocument, exportCampus, yamlDoc } from "../exporterHarness.js";
import { runExport } from "../../src/exporters/run.js";

async function run(args: string[], stdin?: string) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
    env: {},
    stdin,
  });
  return { code, stdout, stderr };
}

describe("design exporters", () => {
  it("exports the campus sample to a pyATS testbed without secrets", async () => {
    const result = await exportCampus("pyats");
    const text = result.text;
    expect(text).toContain("os: iosxe");
    expect(text).toContain("CHANGE_ME");
    expect(text).toContain("10.255.0.1");
    expect(text).toContain("10.255.0.5");
    expect(text).toContain("10.1.0.1/30");
    expect(text).toContain("protocol: ssh");
    for (const name of ["core-rtr", "dist-sw", "access-a", "access-b", "wan-rtr"]) expect(text).toContain(name);
    const doc = yamlDoc(text) as { devices: Record<string, { connections: { cli: { ip: string } } }>; topology: Record<string, unknown> };
    expect(Object.keys(doc.devices)).toEqual(["core-rtr", "dist-sw", "access-a", "access-b", "wan-rtr"]);
    expect(doc.devices["core-rtr"]?.connections.cli.ip).toBe("10.255.0.1");
    expect(doc.topology["core-rtr"]).toBeTruthy();
    expect(text).not.toMatch(/password: (?!CHANGE_ME)/);
  });

  it("warns when a device has no management IP and marks an inferred link", async () => {
    const document = campusDocument();
    document.devices[0] = { ...document.devices[0]!, managementIp: "" };
    document.links = [{ ...document.links[0]!, inferred: true }];
    const result = await runExport("pyats", document, { label: "thin", mapping: null });
    expect(result.warnings.some((item) => item.message.includes("managementIp"))).toBe(true);
    expect(result.warnings.some((item) => item.message.includes("inferred"))).toBe(true);
    expect(result.text).toContain("Inferred links");
  });

  it("exports containerlab with schema kinds and endpoint pairs", async () => {
    const result = await exportCampus("containerlab");
    const doc = yamlDoc(result.text) as {
      name: string;
      topology: { nodes: Record<string, { kind: string; "mgmt-ipv4"?: string }>; links: { endpoints: string[] }[] };
    };
    expect(doc.name).toBe("campus");
    expect(Object.keys(doc.topology.nodes)).toHaveLength(5);
    expect(doc.topology.nodes["core-rtr"]?.kind).toBe("cisco_csr1000v");
    expect(doc.topology.nodes["access-a"]?.kind).toBe("cisco_iol");
    expect(doc.topology.nodes["core-rtr"]?.["mgmt-ipv4"]).toBe("10.255.0.1");
    expect(doc.topology.links).toHaveLength(7);
    expect(doc.topology.links[0]?.endpoints).toHaveLength(2);
    expect(result.text).toContain("CHANGE_ME");
  });

  it("writes CHANGE_ME for an unmapped containerlab platform", async () => {
    const document = campusDocument();
    document.devices = [{ ...document.devices[0]!, platform: "Unknown NOS", role: "" }];
    document.interfaces = [];
    document.links = [];
    const result = await runExport("containerlab", document, { label: "odd", mapping: null });
    expect(result.text).toContain("kind: CHANGE_ME");
    expect(result.warnings.some((item) => item.message.includes("CHANGE_ME"))).toBe(true);
  });

  it("exports a CML lab with nodes and links and placeholder definitions", async () => {
    const result = await exportCampus("cml");
    const doc = yamlDoc(result.text) as {
      lab: { title: string; version: string };
      nodes: { id: string; label: string; node_definition: string; interfaces: { id: string; type: string; slot?: number }[] }[];
      links: { id: string; n1: string; n2: string; i1: string; i2: string }[];
    };
    expect(doc.lab.title).toBe("campus");
    expect(doc.lab.version).toBe("0.1.0");
    expect(doc.nodes).toHaveLength(5);
    expect(doc.nodes.every((node) => node.node_definition === "CHANGE_ME")).toBe(true);
    expect(doc.links).toHaveLength(7);
    expect(doc.links[0]).toMatchObject({ id: "l0", n1: expect.any(String), i1: expect.any(String) });
    const loopback = doc.nodes[0]?.interfaces.find((item) => item.type === "loopback");
    expect(loopback?.slot).toBeUndefined();
    expect(result.text).toContain("CHANGE_ME");
    expect(result.text).not.toMatch(/password:\s*\S+/);
  });

  it("exports an Ansible inventory grouped by site and role", async () => {
    const result = await exportCampus("ansible");
    const doc = yamlDoc(result.text) as {
      all: { hosts: Record<string, { ansible_host?: string; ansible_network_os?: string }>; children: Record<string, { hosts: Record<string, unknown> }> };
    };
    expect(Object.keys(doc.all.hosts)).toEqual(["core-rtr", "dist-sw", "access-a", "access-b", "wan-rtr"]);
    expect(doc.all.hosts["core-rtr"]?.ansible_host).toBe("10.255.0.1");
    expect(doc.all.hosts["wan-rtr"]?.ansible_host).toBe("10.255.0.5");
    expect(doc.all.hosts["core-rtr"]?.ansible_network_os).toBe("cisco.ios.ios");
    expect(doc.all.children.hq.hosts["core-rtr"]).toBeTruthy();
    expect(doc.all.children.branch.hosts["access-b"]).toBeTruthy();
    expect(doc.all.children.access.hosts["access-a"]).toBeTruthy();
    expect(result.text).toContain("CHANGE_ME");
  });

  it("sanitizes an Ansible group name", async () => {
    const document = campusDocument();
    document.devices = [{ ...document.devices[0]!, site: "19th floor", role: "core router" }];
    document.interfaces = [];
    document.links = [];
    const result = await runExport("ansible", document, { label: "names", mapping: null });
    expect(result.text).toContain("g_19th_floor:");
    expect(result.text).toContain("core_router:");
    expect(result.warnings.some((item) => item.message.includes("sanitized"))).toBe(true);
  });

  it("exports a Nornir inventory directory of files", async () => {
    const result = await exportCampus("nornir");
    expect(result.files.map((file) => file.name)).toEqual(["hosts.yaml", "groups.yaml", "defaults.yaml", "config.yaml"]);
    const hosts = yamlDoc(result.files[0]!.text) as Record<string, { hostname?: string; groups?: string[] }>;
    expect(hosts["core-rtr"]?.hostname).toBe("10.255.0.1");
    expect(hosts["core-rtr"]?.groups).toEqual(expect.arrayContaining(["hq", "core"]));
    const groups = yamlDoc(result.files[1]!.text) as Record<string, unknown>;
    for (const name of hosts["core-rtr"]?.groups ?? []) expect(groups[name]).toBeTruthy();
    expect(result.files[2]!.text).toContain("CHANGE_ME");
    expect(result.archive?.mimeType).toBe("application/zip");
  });

  it("exports a GNS3 project with the required keys", async () => {
    const result = await exportCampus("gns3");
    const doc = JSON.parse(result.text) as {
      project_id: string;
      type: string;
      revision: number;
      version: string;
      name: string;
      topology: { nodes: { name: string; compute_id: string; node_type: string }[]; links: { nodes: { adapter_number: number; port_number: number }[] }[]; drawings: unknown[]; computes: unknown[] };
    };
    expect(doc.type).toBe("topology");
    expect(doc.revision).toBe(9);
    expect(doc.version).toBe("2.2.0");
    expect(doc.project_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(doc.topology.nodes).toHaveLength(5);
    expect(doc.topology.nodes.every((node) => node.compute_id === "local" && node.node_type === "qemu")).toBe(true);
    expect(doc.topology.links).toHaveLength(7);
    expect(doc.topology.links[0]?.nodes[0]).toMatchObject({ adapter_number: 0, port_number: expect.any(Number) });
    expect(doc.topology.drawings).toEqual([]);
    expect(doc.topology.computes).toEqual([]);
    expect(result.warnings.some((item) => item.message.includes("appliance"))).toBe(true);
  });

  it("exports an EVE-NG lab with bridge networks", async () => {
    const result = await exportCampus("eve-ng");
    expect(result.text).toContain('<?xml version="1.0"');
    expect(result.text.match(/<node /g)).toHaveLength(5);
    expect(result.text.match(/<network /g)).toHaveLength(7);
    expect(result.text).toContain('type="bridge"');
    expect(result.text).toContain("network_id=");
    expect(result.text).toContain("CHANGE_ME");
    const empty = campusDocument();
    empty.links = [];
    const quiet = await runExport("eve-ng", empty, { label: "quiet", mapping: null });
    expect(quiet.text).toContain('network_id="0"');
    expect(quiet.text).not.toContain("<network ");
  });

  it("runs offline from the CLI and keeps folder export usage", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ng-export-"));
    const source = path.join(dir, "campus.network.json");
    await fs.writeFile(source, `${JSON.stringify(campusDocument())}\n`);
    const output = path.join(dir, "campus.yml");
    const exported = await run(["export", "pyats", source, "-o", output]);
    expect(exported.code).toBe(0);
    expect(await fs.readFile(output, "utf8")).toContain("iosxe");
    const listed = await run(["export"]);
    expect(listed.code).toBe(1);
    expect(listed.stderr).toContain("export <target>");
    expect(listed.stderr).toContain("export <folder>");
    expect(listed.stderr).toContain("pyats");
    const missing = await run(["export", "not-a-target", source]);
    expect(missing.code).toBe(1);
  });
});
