import { describe, expect, it } from "vitest";
import {
  anchorsFromElement,
  lineIsComfortablyVisible,
  pointerMovedPastClick,
  sourceLocationForElement,
  type SourceAnchor,
} from "../src/lib/sourceJump";

function anchor(partial: Partial<SourceAnchor> & Pick<SourceAnchor, "id">): SourceAnchor {
  return {
    id: partial.id,
    className: partial.className ?? "",
    dataId: partial.dataId ?? null,
    dataEt: partial.dataEt ?? null,
    dataFrom: partial.dataFrom ?? null,
    dataTo: partial.dataTo ?? null,
    name: partial.name ?? null,
    tag: partial.tag ?? "g",
    text: partial.text ?? "",
  };
}

function at(source: string, id: string, partial: Partial<SourceAnchor> = {}) {
  return sourceLocationForElement(source, [anchor({ id, ...partial })]);
}

describe("preview click distance", () => {
  it("treats a small twitch as a click and a pan as a drag", () => {
    expect(pointerMovedPastClick(2, 3)).toBe(false);
    expect(pointerMovedPastClick(6, 0)).toBe(false);
    expect(pointerMovedPastClick(7, 0)).toBe(true);
    expect(pointerMovedPastClick(0, 8)).toBe(true);
  });

  it("leaves a line alone when it already sits inside the scroller margin", () => {
    expect(lineIsComfortablyVisible(0, 400, 80, 100)).toBe(true);
    expect(lineIsComfortablyVisible(0, 400, 0, 20)).toBe(false);
    expect(lineIsComfortablyVisible(0, 400, 370, 390)).toBe(false);
    expect(lineIsComfortablyVisible(10, 10, 10, 20)).toBe(false);
  });
});

describe("flowchart element to source line", () => {
  const source = `---
title: WAN
---
flowchart LR
  Core[Core] --> Atlanta[Atlanta]
  Core -->|link| Atlanta
  Core --> Remote[Remote site]
  subgraph sites [Sites]
    Atlanta
  end
  click Atlanta "nerdgram:Sites/Atlanta.mmd"
`;

  it("jumps to a node's definition, not a later edge or click", () => {
    const hit = at(source, "nerdgram-1-flowchart-Atlanta-1", { className: "node default" });
    expect(hit).toEqual({ line: 5, column: source.split("\n")[4].indexOf("Atlanta") });
    expect(source.split("\n")[hit!.line - 1]).toContain("Atlanta[Atlanta]");
  });

  it("prefers the longer node id when one id is a prefix of another", () => {
    const code = "flowchart LR\n  A[Short]\n  Atlanta[Atlanta]\n  A --> Atlanta\n";
    expect(at(code, "flowchart-A-0")?.line).toBe(2);
    expect(at(code, "flowchart-Atlanta-1")?.line).toBe(3);
  });

  it("keeps a hyphenated node id intact", () => {
    const code = "flowchart LR\n  Core-Site[Core]\n  Core-Site --> Edge[Edge]\n";
    const hit = at(code, "nerdgram-4-flowchart-Core-Site-0");
    expect(hit?.line).toBe(2);
    expect(code.split("\n")[1]?.[hit!.column]).toBe("C");
  });

  it("jumps to the first edge, and the second edge uses Mermaid's skipped counter", () => {
    const first = at(source, "nerdgram-flowchart-L_Core_Atlanta_0", { dataId: "L_Core_Atlanta_0" });
    const second = at(source, "ignored", {
      className: "label",
      dataId: "L_Core_Atlanta_2",
      tag: "g",
    });
    expect(first?.line).toBe(5);
    expect(second?.line).toBe(6);
    expect(source.split("\n")[5]).toContain("|link|");
    const third = "flowchart LR\n  A --> B\n  A --> B\n  A --> B\n";
    expect(at(third, "x", { dataId: "L_A_B_3" })?.line).toBe(4);
    expect(at(third, "x", { dataId: "L_A_B_1" })).toBeNull();
  });

  it("jumps to a subgraph header, including an anonymous title", () => {
    expect(at(source, "nerdgram-flowchart-sites", { className: "cluster" })?.line).toBe(8);
    const anon = "flowchart TB\n  subgraph sites [Sites]\n    A[A]\n  end\n  subgraph Hello there\n    B[B]\n  end\n";
    expect(at(anon, "preview-subGraph1", { className: "cluster " })?.line).toBe(5);
  });

  it("uses the edge line when a node is only introduced there", () => {
    const code = "flowchart LR\n  A --> B\n";
    const hit = at(code, "flowchart-A-0");
    expect(hit).toEqual({ line: 2, column: 2 });
  });

  it("does nothing for markers, filters, and diagram types without ids", () => {
    expect(at(source, "nerdgram-flowchart_flowchart-v2-pointEnd", { className: "marker" })).toBeNull();
    expect(at(source, "nerdgram-flowchart-drop-shadow")).toBeNull();
    expect(at("pie showData\n  \"A\" : 10\n", "flowchart-A-0")).toBeNull();
    expect(sourceLocationForElement(source, [])).toBeNull();
    expect(sourceLocationForElement("   ", [anchor({ id: "flowchart-A-0" })])).toBeNull();
  });
});

describe("sequence element to source line", () => {
  const source = `sequenceDiagram
  participant Alice as User
  participant Bob
  Alice->>Bob: Hello
  Bob-->>Alice: Hi
`;

  it("jumps to the participant declaration, not the first message", () => {
    const hit = at(source, "root-0", { className: "", dataId: "Alice", dataEt: "participant" });
    expect(hit?.line).toBe(2);
    expect(source.split("\n")[1]?.[hit!.column]).toBe("A");
  });

  it("reads the actor name from the lifeline and from a footer rect", () => {
    expect(at(source, "actor0", { className: "actor-line", dataId: "Alice", name: "Alice" })?.line).toBe(2);
    const footer = anchorsFromElement(
      el("text", { class: "actor actor-box", text: "User" }, [
        el("rect", { class: "actor actor-bottom", name: "Alice" }),
      ]),
    );
    expect(sourceLocationForElement(source, footer)?.line).toBe(2);
  });

  it("jumps to the message for the line and for the label beside it", () => {
    expect(
      at(source, "", {
        className: "messageLine0",
        dataId: "i0",
        dataEt: "message",
        dataFrom: "Alice",
        dataTo: "Bob",
      })?.line,
    ).toBe(4);
    const label = anchorsFromElement(el("text", { class: "messageText", text: "Hi" }, [], el("line", {
      class: "messageLine1",
      "data-id": "i1",
      "data-et": "message",
      "data-from": "Bob",
      "data-to": "Alice",
    })));
    expect(sourceLocationForElement(source, label)?.line).toBe(5);
  });

  it("does not guess when the message text is shared and the line id is missing", () => {
    const code = "sequenceDiagram\n  A->>B: Same\n  B->>A: Same\n";
    expect(at(code, "", { className: "messageText", text: "Same", tag: "text" })).toBeNull();
  });

  it("keeps message indexes aligned when a note sits between them", () => {
    const code = "sequenceDiagram\n  A->>B: One\n  note right of A: aside\n  B-->>A: Two\n";
    expect(at(code, "", { dataId: "i2", dataEt: "message", dataFrom: "B", dataTo: "A" })?.line).toBe(4);
    expect(at(code, "", { dataId: "i1", dataEt: "message" })).toBeNull();
  });
});

describe("class, state, and ER element to source line", () => {
  const classes = `classDiagram
  class Animal {
    +int age
    +eat()
  }
  class Dog
  Animal <|-- Dog : extends
  Dog <|-- Puppy : child
`;

  it("jumps to the class declaration and to a member inside it", () => {
    expect(at(classes, "svg-classId-Animal-0")?.line).toBe(2);
    const member = sourceLocationForElement(classes, [
      anchor({ id: "", className: "nodeLabel", tag: "span", text: "+eat()" }),
      anchor({ id: "svg-classId-Animal-0", className: "node" }),
    ]);
    expect(member?.line).toBe(4);
    expect(at(classes, "svg-classId-Dog-1")?.line).toBe(6);
  });

  it("uses the global relation counter, so the second relation is _2", () => {
    expect(at(classes, "svg-id_Animal_Dog_1", { dataId: "id_Animal_Dog_1" })?.line).toBe(7);
    expect(at(classes, "x", { dataId: "id_Dog_Puppy_2" })?.line).toBe(8);
    expect(at(classes, "x", { dataId: "id_Dog_Puppy_1" })).toBeNull();
  });

  const states = `stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  state Running {
    [*] --> Tick
  }
`;

  it("jumps to a state definition ahead of a transition, and to each edge", () => {
    const withDecl = `stateDiagram-v2\n  state Idle\n  [*] --> Idle\n  Idle --> Running : start\n`;
    expect(at(withDecl, "preview-state-Idle-1")?.line).toBe(2);
    const firstMention = at(states, "preview-state-Idle-1");
    expect(firstMention?.line).toBe(2);
    expect(states.split("\n")[1]?.[firstMention!.column ?? -1]).toBe("I");
    expect(at(states, "preview-state-Running-4")?.line).toBe(4);
    expect(at(states, "preview-edge0", { dataId: "edge0" })?.line).toBe(2);
    expect(at(states, "x", { dataId: "edge1", className: "edgeLabel", text: "start", tag: "span" })?.line).toBe(3);
    expect(at(states, "preview-edge2", { dataId: "edge2" })?.line).toBe(5);
    expect(at(states, "preview-state-root_start-0")).toBeNull();
    expect(at(states, "preview-state-Running_start-2")).toBeNull();
  });

  it("lets a note consume an edge number without becoming that edge", () => {
    const code = "stateDiagram-v2\n  [*] --> Idle\n  note right of Idle : waiting\n  Idle --> Run : go\n";
    expect(at(code, "st-edge0", { dataId: "edge0" })?.line).toBe(2);
    expect(at(code, "st-edge2", { dataId: "edge2" })?.line).toBe(4);
    expect(at(code, "st-state-Idle----note-1", { className: "node statediagram-note", text: "waiting" })?.line).toBe(3);
  });

  const er = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER {
    int id
    string name
  }
`;

  it("jumps to an entity block, an attribute, and the relationship", () => {
    expect(at(er, "svg-entity-ORDER-1")?.line).toBe(3);
    expect(at(er, "svg-entity-CUSTOMER-0")?.line).toBe(2);
    const name = sourceLocationForElement(er, [
      anchor({ id: "", className: "nodeLabel", tag: "span", text: "name" }),
      anchor({ id: "svg-entity-ORDER-1" }),
    ]);
    expect(name?.line).toBe(5);
    expect(at(er, "svg-id_entity-CUSTOMER-0_entity-ORDER-1_0", { dataId: "id_entity-CUSTOMER-0_entity-ORDER-1_0" })?.line).toBe(2);
  });

  it("numbers entities by first appearance when the block comes first", () => {
    const code = "erDiagram\n  ORDER {\n    int id\n  }\n  CUSTOMER ||--o{ ORDER : places\n";
    expect(at(code, "svg-entity-ORDER-0")?.line).toBe(2);
    expect(at(code, "x", { dataId: "id_entity-CUSTOMER-1_entity-ORDER-0_0" })?.line).toBe(5);
  });
});

type Attrs = Record<string, string | undefined>;

function el(
  tag: string,
  attrs: Attrs,
  previous: ReturnType<typeof el>[] = [],
  next?: ReturnType<typeof el>,
) {
  const node = {
    tagName: tag,
    textContent: attrs.text ?? "",
    parentElement: null as ReturnType<typeof el> | null,
    nextElementSibling: next ?? null,
    previousElementSibling: previous[0] ?? null,
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
  };
  return node;
}
