import { describe, expect, it } from "vitest";
import { unitsFromDraft, type ImportDraft } from "../src/lib/importDrafts";
import { MERMAID_IMPORT_HINT, SUPPORTED_IMPORT_LINE, recognizeImport } from "../src/lib/importRecognize";

function textFile(name: string, text: string) {
  return recognizeImport(name, new TextEncoder().encode(text));
}

describe("import recognition", () => {
  it("lists Mermaid extensions on the import hint", () => {
    expect(MERMAID_IMPORT_HINT).toContain(".mmd");
    expect(MERMAID_IMPORT_HINT).toContain(".mermaid");
    expect(MERMAID_IMPORT_HINT).toContain(".md");
    expect(MERMAID_IMPORT_HINT).toContain(".markdown");
    expect(MERMAID_IMPORT_HINT).toContain(".txt");
    expect(SUPPORTED_IMPORT_LINE).toContain("Import supports Mermaid");
    expect(SUPPORTED_IMPORT_LINE).toContain("From data opens CSV");
  });

  it("imports Mermaid from a .txt paste and an ordinary .mmd", () => {
    const pasted = textFile("notes.txt", "flowchart LR\n  A --> B\n");
    expect(pasted.action).toBe("diagram");
    expect(pasted.kind).toBe("mermaid");
    expect(pasted.diagramText).toContain("flowchart LR");
    const ordinary = textFile("Rack.mmd", "flowchart LR\n  A --> B\n");
    expect(ordinary.action).toBe("diagram");
    expect(ordinary.label).toBe("Mermaid");
  });

  it("imports the fenced source from Markdown", () => {
    const found = textFile("notes.md", "# Site\n\n```mermaid\nflowchart TD\n  A --> B\n```\n");
    expect(found.kind).toBe("markdown");
    expect(found.action).toBe("diagram");
    expect(found.diagramText).toContain("flowchart TD");
    expect(found.diagramText).not.toContain("# Site");
  });

  it("routes generic JSON, CSV, CDP, LLDP, and network JSON to From data", () => {
    expect(textFile("rows.json", '{"nodes":[{"id":"a"}]}').dataFormat).toBe("json");
    expect(textFile("links.csv", "local,remote\na,b\n").dataFormat).toBe("csv");
    const lucidCsv = textFile(
      "shapes.csv",
      "Id,Name,Page Name,Line Source,Line Destination,Text Area 1\n1,Core,Campus,,,Core\n",
    );
    expect(lucidCsv.kind).toBe("lucidchart");
    expect(lucidCsv.label).toBe("Lucid CSV");
    expect(lucidCsv.action).toBe("convert");
    expect(textFile("show.txt", "core#show cdp neighbors detail\n").dataFormat).toBe("cdp");
    expect(textFile("core.route", "core#show ip route\nC        10.1.0.0/30 is directly connected, Gi0/0\n").dataFormat).toBe(
      "route",
    );
    expect(textFile("show.txt", "core#show lldp neighbors detail\n").dataFormat).toBe("lldp");
    const network = textFile("Campus.network.json", '{"schemaVersion":1,"devices":[],"interfaces":[]}');
    expect(network.kind).toBe("network");
    expect(network.action).toBe("from-data");
  });

  it("routes a style-preset document to Style presets", () => {
    const found = textFile(
      "presets.json",
      '{"version":1,"presets":[{"name":"Lab","style":{"theme":"dark"}}]}',
    );
    expect(found.kind).toBe("style-preset");
    expect(found.action).toBe("style-presets");
  });

  it("names unsupported formats instead of treating them as Mermaid", () => {
    const lucid = textFile("export.txt", '{"product":"lucidchart","pages":[]}');
    expect(lucid.kind).toBe("lucidchart");
    expect(lucid.action).toBe("convert");
    expect(lucid.message).toMatch(/imported as a diagram/i);
    expect(textFile("map.drawio", "<mxfile><diagram/></mxfile>").kind).toBe("drawio");
    expect(textFile("net.puml", "@startuml\nA -> B\n@enduml").kind).toBe("plantuml");
    expect(textFile("net.dot", "digraph G { A -> B }").kind).toBe("graphviz");
    expect(textFile("net.d2", "direction: right\nserver -> client\n").kind).toBe("d2");
    expect(textFile("board.json", '{"type":"excalidraw","elements":[],"appState":{}}').kind).toBe("excalidraw");
    expect(textFile("icon.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>").kind).toBe("svg");
    expect(recognizeImport("pic.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])).kind).toBe("png");
    expect(recognizeImport("pic.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0x00])).kind).toBe("jpg");
    expect(recognizeImport("page.pdf", new TextEncoder().encode("%PDF-1.7")).kind).toBe("pdf");
    expect(recognizeImport("net.vsdx", new Uint8Array([0x50, 0x4b, 0x03, 0x04])).action).toBe("convert");
    const vsd = recognizeImport("net.vsd", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
    expect(vsd.kind).toBe("visio");
    expect(vsd.message).toMatch(/save this file as \.vsdx/i);
    const visioZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("vnd.ms-visio.drawing")]);
    expect(recognizeImport("drawing.bin", visioZip).action).toBe("convert");
    expect(textFile("board.drawio", "<mxGraphModel><root><mxCell id='0'/></root></mxGraphModel>").kind).toBe("drawio");
  });

  it("names a structure-only Lucid export and does not open it in From data", () => {
    const lucid = {
      pages: [
        {
          shapes: [
            { class: "FreehandBlock", id: "s1" },
            { type: "ProcessBlock", id: "s2" },
          ],
          lines: [{ endpoint1: { x: 0, y: 0 }, endpoint2: { x: 40, y: 20 }, style: { stroke: "#111" } }],
        },
      ],
    };
    const found = textFile("export.txt", JSON.stringify(lucid));
    expect(found.kind).toBe("lucidchart");
    expect(found.action).toBe("convert");
    expect(found.action).not.toBe("from-data");
  });

  it("names an id-keyed Lucid export that links shapes with from and to", () => {
    const lucid = {
      pages: [
        {
          shapes: {
            s1: { type: "FreehandBlock" },
            s2: { class: "ProcessBlock" },
            s3: { type: "DefaultSquareBlock" },
          },
          lines: {
            l1: { from: "s1", to: "s2" },
          },
        },
      ],
    };
    const found = textFile("export.txt", JSON.stringify(lucid));
    expect(found.kind).toBe("lucidchart");
    expect(found.action).toBe("convert");
  });

  it("keeps network JSON and a plain nodes and links file on the From data path", () => {
    const network = textFile(
      "Campus.network.json",
      '{"schemaVersion":1,"devices":[{"name":"r1"}],"interfaces":[],"links":[{"source":"a","target":"b"}]}',
    );
    expect(network.kind).toBe("network");
    expect(network.action).toBe("from-data");
    const plain = textFile("rows.json", '{"nodes":[{"id":"a"}],"links":[{"source":"a","target":"b"}]}');
    expect(plain.kind).toBe("json");
    expect(plain.action).toBe("from-data");
  });

  it("imports each Lucid page, or one chosen page, and can set a hub layout", () => {
    const draft: ImportDraft = {
      id: "lucid",
      sourceName: "campus.csv",
      text: "",
      diagramName: "",
      pages: [
        { id: "p1", title: "Campus", text: "flowchart LR\n  a --> b\n", warnings: ["Shape x has no text."], nodes: 2 },
        { id: "p2", title: "WAN", text: "flowchart LR\n  c --> d\n", warnings: [], nodes: 2 },
      ],
      pageChoice: "all",
      hubLayout: "",
    };
    const both = unitsFromDraft(draft);
    expect(both.map((unit) => unit.diagramName)).toEqual(["campus - Campus.mmd", "campus - WAN.mmd"]);
    expect(both[0]?.warnings).toEqual(["Shape x has no text."]);
    const one = unitsFromDraft({ ...draft, pageChoice: "p2" });
    expect(one).toHaveLength(1);
    expect(one[0]?.diagramName).toBe("campus.mmd");
    expect(one[0]?.text).toContain("c --> d");
    const hub = unitsFromDraft({ ...draft, pageChoice: "p1", hubLayout: "compact" });
    expect(hub[0]?.text).toMatch(/hubLayout: compact/);
  });

  it("says when a file is not a recognized format", () => {
    const found = textFile("notes.txt", "hello from a meeting\n");
    expect(found.kind).toBe("unknown");
    expect(found.action).toBe("unsupported");
    expect(found.message).toMatch(/not a recognized format/i);
    expect(found.message).toMatch(/From data/);
  });
});
