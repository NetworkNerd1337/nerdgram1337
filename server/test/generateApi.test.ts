import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";
const json = { Host: HOST, "Content-Type": "application/json" };

const links = `Local Device,Local Port,Remote Device,Remote Port,Local Group,Remote Diagram
Core,Gi0/1,Atlanta,Gi0/2,HQ,Sites/Atlanta.mmd
Core,Gi0/3,Remote,Gi0/4,HQ,
`;

describe("generate API", () => {
  let dir = "";
  let cleanup = async () => {};

  beforeEach(async () => {
    const temp = await makeTempDataDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  function app() {
    return createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
  }

  it("previews, stores the data file, and refuses a path outside the workspace", async () => {
    const server = app();
    const preview = await request(server).post("/api/generate/preview").set(json).send({ text: links, title: "Campus" });
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.mermaid).toContain('click Atlanta "nerdgram:Sites/Atlanta.mmd"');
    expect(preview.body.mermaid).not.toContain("javascript:");

    const created = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text: links, path: "Network/Campus.mmd", title: "Campus" });
    expect(created.status).toBe(201);
    expect(created.body.path).toBe("Network/Campus.mmd");
    expect(created.body.dataPath).toBe("Network/Campus.csv");
    const diagram = await fs.readFile(path.join(dir, "Network", "Campus.mmd"), "utf8");
    const data = await fs.readFile(path.join(dir, "Network", "Campus.csv"), "utf8");
    expect(diagram).toContain("%% nerdgram:generated");
    expect(diagram).toContain("file: Network/Campus.csv");
    expect(data).toContain("Atlanta");
    expect(path.resolve(path.join(dir, "Network", "Campus.csv")).startsWith(path.resolve(dir))).toBe(true);

    const escaped = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text: links, path: "../Campus.mmd" });
    expect(escaped.status).toBe(400);

    const hidden = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text: links, path: "Campus.mmd", dataName: ".meta/secret.csv" });
    expect(hidden.status).toBe(400);
    await expect(fs.access(path.join(dir, ".meta", "secret.csv"))).rejects.toThrow();

    const again = await request(server).post("/api/generate").set(json).send({ text: links, path: "Network/Campus.mmd" });
    expect(again.status).toBe(409);
  });

  it("shows a refresh diff and keeps text outside the generated markers", async () => {
    const server = app();
    const created = await request(server).post("/api/generate").set(json).send({ text: links, path: "Campus.mmd" });
    expect(created.status).toBe(201);
    const original = await fs.readFile(path.join(dir, "Campus.mmd"), "utf8");
    const edited = `${original}\n%% operator note\n  spare["Spare"]\n`;
    const updated = links.replace("Remote,Gi0/4,HQ,", "Remote,Gi0/4,HQ,\nEdge,Gi0/9,Remote,Gi0/8,HQ,");
    const preview = await request(server)
      .post("/api/generate/refresh")
      .set(json)
      .send({ path: "Campus.mmd", diagramText: edited, text: updated });
    expect(preview.status).toBe(200);
    expect(preview.body.diff.nodes.added.map((node: { id: string }) => node.id)).toContain("Edge");
    expect(preview.body.mermaid).toContain("%% operator note");
    expect(preview.body.mermaid).toContain('spare["Spare"]');
    expect(preview.body.mermaid).toContain("%% nerdgram:generated");
    expect(await fs.readFile(path.join(dir, "Campus.mmd"), "utf8")).toBe(original);
    expect(await fs.readFile(path.join(dir, "Campus.csv"), "utf8")).toBe(links);

    const applied = await request(server)
      .post("/api/generate/refresh")
      .set(json)
      .send({ path: "Campus.mmd", diagramText: edited, text: updated, writeData: true });
    expect(applied.status).toBe(200);
    expect(await fs.readFile(path.join(dir, "Campus.csv"), "utf8")).toBe(updated);
    expect(await fs.readFile(path.join(dir, "Campus.mmd"), "utf8")).toBe(original);
  });

  it("rejects a non-JSON body and an unknown source", async () => {
    const server = app();
    const form = await request(server)
      .post("/api/generate/preview")
      .set("Host", HOST)
      .set("Content-Type", "text/plain")
      .send("local,remote");
    expect(form.status).toBe(415);

    const unknown = await request(server)
      .post("/api/generate/preview")
      .set(json)
      .send({ text: "Device ID, Local Intf", format: "yaml" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("invalid");
    expect(String(unknown.body.error).toLowerCase()).not.toContain("netbox");
  });

  it("stores raw LLDP output and refreshes it by parsing that file again", async () => {
    const server = app();
    const lldp = `core-sw#show lldp neighbors detail
------------------------------------------------
Local Intf: Gi1/0/1
Port id: Gi1/0/48
System Name: dist-sw
System Description: Cisco IOS Software, C3750E Software
System Capabilities: B
Enabled Capabilities: B
------------------------------------------------
Local Intf: Gi1/0/2
Port id: Fa0/1
System Name: access-sw
System Description: Cisco IOS Software, C2960 Software
Enabled Capabilities: B
`;
    const created = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text: lldp, format: "lldp", path: "Network/Core.mmd", title: "Core", groupBy: "platform" });
    expect(created.status).toBe(201);
    expect(created.body.dataPath).toBe("Network/Core.lldp");
    const diagram = await fs.readFile(path.join(dir, "Network", "Core.mmd"), "utf8");
    const stored = await fs.readFile(path.join(dir, "Network", "Core.lldp"), "utf8");
    expect(stored).toBe(lldp);
    expect(diagram).toContain("format: lldp");
    expect(diagram).toContain("%% nerdgram:generated");
    expect(diagram).toContain('["dist-sw"]');

    const updated = lldp.replace("Enabled Capabilities: B\n", "Enabled Capabilities: B\n").replace(
      "System Name: access-sw",
      "System Name: access-east",
    );
    const refreshed = await request(server)
      .post("/api/generate/refresh")
      .set(json)
      .send({ path: "Network/Core.mmd", text: updated, writeData: true });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.diff.nodes.added.map((node: { label: string }) => node.label)).toContain("access-east");
    expect(refreshed.body.diff.nodes.removed.map((node: { label: string }) => node.label)).toContain("access-sw");
    expect(refreshed.body.mermaid).toContain("%% nerdgram:generated");
    expect(await fs.readFile(path.join(dir, "Network", "Core.lldp"), "utf8")).toBe(updated);
    expect(await fs.readFile(path.join(dir, "Network", "Core.mmd"), "utf8")).toBe(diagram);
  });

  it("stores network JSON, previews both views, and refreshes only the generated block", async () => {
    const server = app();
    const text = JSON.stringify({
      schemaVersion: 1,
      devices: [
        { name: "core", role: "core" },
        { name: "dist", role: "distribution" },
      ],
      interfaces: [
        { device: "core", name: "Gi0/0", adminStatus: "up", operStatus: "up", ipv4: [{ address: "10.0.0.1", prefix: 30 }] },
        { device: "dist", name: "Gi0/1", adminStatus: "up", operStatus: "up", ipv4: [{ address: "10.0.0.2", prefix: 30 }] },
        {
          device: "core",
          name: "Gi0/1",
          switchportMode: "trunk",
          trunkVlans: [10, 20, 30],
          nativeVlan: 99,
        },
        { device: "dist", name: "Gi0/2", switchportMode: "trunk", trunkVlans: [10, 20, 30], nativeVlan: 99 },
      ],
      links: [{ a: { device: "core", interface: "GigabitEthernet0/1" }, b: { device: "dist", interface: "Gi0/2" } }],
    });
    const preview = await request(server).post("/api/generate/preview").set(json).send({ text, format: "network", view: "l3" });
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.mermaid).toContain("10.0.0.0/30");

    const layer2 = await request(server).post("/api/generate/preview").set(json).send({ text, format: "network", view: "l2" });
    expect(layer2.status).toBe(200);
    expect(layer2.body.mermaid).toContain("10,20,30 native 99");

    const created = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text, format: "network", view: "l3", path: "Campus-L3.mmd", title: "Campus" });
    expect(created.status).toBe(201);
    expect(created.body.dataPath).toBe("Campus-L3.network.json");
    const diagram = await fs.readFile(path.join(dir, "Campus-L3.mmd"), "utf8");
    expect(diagram).toContain("format: network");
    expect(diagram).toContain("view: l3");
    expect(await fs.readFile(path.join(dir, "Campus-L3.network.json"), "utf8")).toBe(text);

    const noted = `${diagram}%% hand note\n`;
    const refreshed = await request(server)
      .post("/api/generate/refresh")
      .set(json)
      .send({
        path: "Campus-L3.mmd",
        diagramText: noted,
        text: text.replace("10.0.0.2", "10.0.0.3"),
        writeData: false,
      });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.mermaid).toContain("%% hand note");
    expect(refreshed.body.mermaid).toContain("10.0.0.3");
    expect(refreshed.body.mermaid).not.toContain("10.0.0.2");
    expect(await fs.readFile(path.join(dir, "Campus-L3.mmd"), "utf8")).toBe(diagram);

    const token = await request(server)
      .post("/api/tokens")
      .set(json)
      .send({ name: "net", scope: "read-write" });
    expect(token.status).toBe(201);
    const v1 = await request(server)
      .post("/api/v1/generate")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${token.body.token}`)
      .send({ text, format: "network", view: "l2", path: "Campus-L2.mmd" });
    expect(v1.status).toBe(201);
    expect(v1.body.dataPath).toBe("Campus-L2.network.json");
    expect(v1.body.mermaid).toContain("native 99");
  });

  it("upserts the same path, keeps notes outside the markers, and still 409s on create-only", async () => {
    const server = app();
    const token = await request(server).post("/api/tokens").set(json).send({ name: "upsert", scope: "read-write" });
    expect(token.status).toBe(201);
    const auth = { ...json, Authorization: `Bearer ${token.body.token}` };

    const first = await request(server)
      .post("/api/v1/generate/upsert")
      .set(auth)
      .send({ text: links, path: "Campus.mmd", title: "Campus" });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(first.body.dataPath).toBe("Campus.csv");

    await fs.writeFile(path.join(dir, "Campus.mmd"), `${first.body.mermaid}%% keep this note\n`);
    const next = links.replaceAll("Atlanta", "Boston");
    const second = await request(server)
      .post("/api/v1/generate/upsert")
      .set(auth)
      .send({ text: next, path: "Campus.mmd", title: "Campus" });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.mermaid).toContain("Boston");
    expect(second.body.mermaid).toContain("%% keep this note");
    expect(second.body.mermaid).not.toContain("Atlanta");
    expect(await fs.readFile(path.join(dir, "Campus.csv"), "utf8")).toBe(next);
    const disk = await fs.readFile(path.join(dir, "Campus.mmd"), "utf8");
    expect(disk).toContain("%% keep this note");
    expect(disk).toContain("Boston");

    const createOnly = await request(server).post("/api/v1/generate").set(auth).send({ text: next, path: "Campus.mmd" });
    expect(createOnly.status).toBe(409);
    expect(createOnly.body.code).toBe("exists");

    await fs.writeFile(path.join(dir, "Hand.mmd"), "flowchart LR\n  A --> B\n");
    const hand = await request(server).post("/api/v1/generate/upsert").set(auth).send({ text: links, path: "Hand.mmd" });
    expect(hand.status).toBe(409);
    expect(hand.body.code).toBe("not_generated");
    expect(await fs.readFile(path.join(dir, "Hand.mmd"), "utf8")).toBe("flowchart LR\n  A --> B\n");
  });

  it("names network JSON fields and keeps row numbers for CSV", async () => {
    const server = app();
    const network = JSON.stringify({
      schemaVersion: 1,
      devices: [{ name: "core", serial: "ABC" }],
      interfaces: [],
    });
    const preview = await request(server)
      .post("/api/generate/preview")
      .set(json)
      .send({ text: network, format: "network", view: "l3" });
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toContainEqual({
      path: "/devices/0/serial",
      message: '/devices/0/serial: unexpected property "serial".',
    });
    expect(JSON.stringify(preview.body.errors)).not.toContain('"row"');

    const created = await request(server)
      .post("/api/generate")
      .set(json)
      .send({ text: network, format: "network", view: "l3", path: "Bad.mmd" });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe("Fix the fields listed before creating the diagram.");
    expect(created.body.errors[0].path).toBe("/devices/0/serial");
    expect(created.body.errors[0].row).toBeUndefined();

    const csv = "Local Device,Local Port,Remote Device,Remote Port\n,Gi0/1,Atlanta,Gi0/2\n";
    const rows = await request(server).post("/api/generate").set(json).send({ text: csv, path: "Rows.mmd" });
    expect(rows.status).toBe(400);
    expect(rows.body.error).toBe("Fix the rows listed before creating the diagram.");
    expect(rows.body.errors[0].row).toBeGreaterThan(0);
    expect(String(rows.body.errors[0].message)).toMatch(/Row /);
  });
});
