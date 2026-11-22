import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_MAX_CHARS } from "../src/diagramData.js";
import { importNetworkFormat } from "../src/network/import.js";
import { convertForeign } from "../src/diagramImport/convert.js";
import { VISIO_BINARY_MESSAGE } from "../src/diagramImport/model.js";
import { MAX_ZIP_ENTRIES } from "../src/diagramImport/zip.js";
import { hubLeafCount } from "../src/hubLayout.js";
import { REPO_ROOT } from "../src/paths.js";

function zip(files: { name: string; data: Buffer; method?: number }[]): Uint8Array {
  const parts: Buffer[] = [];
  for (const file of files) {
    const stored = file.method === 0;
    const payload = stored ? file.data : deflateRawSync(file.data);
    const name = Buffer.from(file.name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(stored ? 0 : 8, 8);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    parts.push(header, name, payload);
  }
  return new Uint8Array(Buffer.concat(parts));
}

const pageXml = `<?xml version="1.0"?>
<PageContents>
  <Shapes>
    <Shape ID="1" NameU="Rectangle" Type="Shape"><Text>Core</Text></Shape>
    <Shape ID="2" NameU="Dynamic connector" Type="Shape"><Text>Gi0/1</Text></Shape>
    <Shape ID="3" NameU="Rectangle" Type="Shape"><Text>Access</Text></Shape>
    <Shape ID="6" NameU="Dynamic connector" Type="Shape"><Text>loose</Text></Shape>
    <Shape ID="4" Type="Group" NameU="Rack"><Text>Rack</Text>
      <Shapes><Shape ID="5" NameU="Rectangle" Type="Shape"><Text>Switch</Text></Shape></Shapes>
    </Shape>
    <Shape ID="7" NameU="Rectangle" Type="Shape"><Text></Text></Shape>
  </Shapes>
  <Connects>
    <Connect FromSheet="2" FromCell="BeginX" ToSheet="1"/>
    <Connect FromSheet="2" FromCell="EndX" ToSheet="3"/>
    <Connect FromSheet="6" FromCell="BeginX" ToSheet="1"/>
  </Connects>
</PageContents>`;

function visioPackage(page = pageXml, extra: { name: string; data: Buffer; method?: number }[] = []): Uint8Array {
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(`<Types><Override ContentType="application/vnd.ms-visio.drawing.main+xml" PartName="/visio/pages/pages.xml"/></Types>`) },
    { name: "visio/pages/pages.xml", data: Buffer.from(`<Pages><Page ID="0" Name="Campus"><Rel r:id="rId1"/></Page></Pages>`) },
    { name: "visio/pages/_rels/pages.xml.rels", data: Buffer.from(`<Relationships><Relationship Id="rId1" Target="page1.xml"/></Relationships>`) },
    { name: "visio/pages/page1.xml", data: Buffer.from(page) },
    ...extra,
  ]);
}

describe("Lucid and Visio import", () => {
  it("reads the Lucid CSV and JSON samples into nodes, edges, and a warning", () => {
    const csv = convertForeign("lucid-campus.csv", readFileSync(path.join(REPO_ROOT, "docs/samples/imports/lucid-campus.csv")));
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    expect(csv.pages.map((page) => page.title)).toEqual(["Campus", "WAN"]);
    expect(csv.pages[0]?.mermaid).toContain("Core");
    expect(csv.pages[0]?.mermaid).toContain("Gi0/1");
    expect(csv.pages[0]?.mermaid).toMatch(/subgraph/);
    expect(csv.pages[0]?.warnings.join(" ")).toMatch(/no text/);
    expect(csv.pages[0]?.warnings.join(" ")).toMatch(/stub/);

    const json = convertForeign("lucid-campus.json", readFileSync(path.join(REPO_ROOT, "docs/samples/imports/lucid-campus.json")));
    expect(json.ok).toBe(true);
    if (!json.ok) return;
    expect(json.pages).toHaveLength(1);
    expect(json.pages[0]?.mermaid).toContain("Core");
    expect(json.pages[0]?.mermaid).toContain("Access");
  });

  it("reads a vsdx page, drops positions, and warns on a free end and a blank shape", () => {
    const sample = convertForeign(
      "visio-campus.vsdx",
      readFileSync(path.join(REPO_ROOT, "docs/samples/imports/visio-campus.vsdx")),
    );
    expect(sample.ok).toBe(true);
    if (!sample.ok) return;
    expect(sample.pages.map((page) => page.title)).toEqual(["Campus", "WAN"]);
    expect(sample.pages[0]?.mermaid).toContain("Gi0/1");
    expect(sample.pages[0]?.warnings.join(" ")).toMatch(/no text/);
    expect(sample.pages[0]?.warnings.join(" ")).toMatch(/stub/);
    expect(sample.pages[1]?.mermaid).toContain("MPLS");
    const result = convertForeign("campus.vsdx", visioPackage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages[0]?.title).toBe("Campus");
    expect(result.pages[0]?.mermaid).toContain("Core");
    expect(result.pages[0]?.mermaid).toContain("Gi0/1");
    expect(result.pages[0]?.mermaid).toContain("Switch");
    expect(result.pages[0]?.mermaid).toMatch(/subgraph .*Rack/);
    expect(result.pages[0]?.mermaid).not.toContain("PinX");
    expect(result.pages[0]?.warnings.join(" ")).toMatch(/stub/);
    expect(result.pages[0]?.warnings.join(" ")).toMatch(/no text/);
    expect(convertForeign("old.vsd", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])).ok).toBe(false);
    expect(convertForeign("old.vss", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toMatchObject({
      ok: false,
      message: VISIO_BINARY_MESSAGE,
    });
  });

  it("rejects an unsafe path, too many entries, and a zip that expands past 4 MiB", () => {
    expect(convertForeign("bad.vsdx", zip([{ name: "../secret.xml", data: Buffer.from("<x/>") }])).ok).toBe(false);
    const many = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, index) => ({
      name: `visio/pages/note-${index}.xml`,
      data: Buffer.from("<x/>"),
      method: 0 as const,
    }));
    expect(convertForeign("many.vsdx", zip(many)).ok).toBe(false);
    const huge = Buffer.alloc(DATA_MAX_CHARS + 1, 0x20);
    const declared = zip([{ name: "visio/pages/page1.xml", data: huge, method: 0 }]);
    const over = convertForeign("big.vsdx", declared);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toMatch(/4 MiB/);
  });

  it("imports a multi-megabyte drawing under the 4 MiB cap and a 50-leaf hub", () => {
    const padding = Buffer.alloc(3 * 1024 * 1024, 0x20);
    const wide = convertForeign("wide.vsdx", visioPackage(pageXml, [{ name: "visio/media/note.txt", data: padding, method: 0 }]));
    expect(wide.ok).toBe(true);
    const lines = ["Id,Name,Text Area 1,Line Source,Line Destination"];
    lines.push("hub,Core,Core,,");
    for (let index = 1; index <= 50; index += 1) {
      lines.push(`leaf${index},Leaf ${index},Leaf ${index},,`);
      lines.push(`edge${index},,${index},hub,leaf${index}`);
    }
    const hub = convertForeign("hub.csv", new TextEncoder().encode(lines.join("\n")));
    expect(hub.ok).toBe(true);
    if (!hub.ok) return;
    expect(hub.pages[0]?.nodes).toBeGreaterThanOrEqual(51);
    expect(hubLeafCount(hub.pages[0]?.mermaid ?? "")).toBeGreaterThanOrEqual(50);
  });

  it("cleans a huge network import file name quickly", () => {
    const started = performance.now();
    const result = importNetworkFormat({ view: "l3", sourceFile: `${"/".repeat(200_000)}x` }, "{}");
    expect(performance.now() - started).toBeLessThan(200);
    expect(result.source.file).toBe("data.network.json");
  });
});
