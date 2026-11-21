import { describe, expect, it } from "vitest";
import { MERMAID_IMPORT_HINT, recognizeImport } from "../src/lib/importRecognize";

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
    expect(textFile("show.txt", "core#show cdp neighbors detail\n").dataFormat).toBe("cdp");
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
    expect(lucid.action).toBe("unsupported");
    expect(lucid.message).toMatch(/not supported yet/i);
    expect(lucid.message).toMatch(/From data/);
    expect(textFile("map.drawio", "<mxfile><diagram/></mxfile>").kind).toBe("drawio");
    expect(textFile("net.puml", "@startuml\nA -> B\n@enduml").kind).toBe("plantuml");
    expect(textFile("net.dot", "digraph G { A -> B }").kind).toBe("graphviz");
    expect(textFile("net.d2", "direction: right\nserver -> client\n").kind).toBe("d2");
    expect(textFile("board.json", '{"type":"excalidraw","elements":[],"appState":{}}').kind).toBe("excalidraw");
    expect(textFile("icon.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>").kind).toBe("svg");
    expect(recognizeImport("pic.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])).kind).toBe("png");
    expect(recognizeImport("pic.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0x00])).kind).toBe("jpg");
    expect(recognizeImport("page.pdf", new TextEncoder().encode("%PDF-1.7")).kind).toBe("pdf");
    expect(recognizeImport("net.vsdx", new Uint8Array([0x50, 0x4b, 0x03, 0x04])).kind).toBe("visio");
    expect(recognizeImport("net.vsd", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])).kind).toBe("visio");
  });

  it("says when a file is not a recognized format", () => {
    const found = textFile("notes.txt", "hello from a meeting\n");
    expect(found.kind).toBe("unknown");
    expect(found.action).toBe("unsupported");
    expect(found.message).toMatch(/not a recognized format/i);
    expect(found.message).toMatch(/From data/);
  });
});
