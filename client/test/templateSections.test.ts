import { describe, expect, it } from "vitest";
import { foldSections, sectionIsOpen } from "../src/lib/templateSections";

describe("template gallery sections", () => {
  it("expands and collapses only the sections that are showing", () => {
    const current = { Network: false, Security: true };
    const shown = ["Network", "Software"];
    expect(foldSections(shown, true, current)).toEqual({ Network: true, Software: true, Security: true });
    expect(foldSections(shown, false, current)).toEqual({ Network: false, Software: false, Security: true });
  });

  it("keeps a filter's sections open until Expand all or Collapse all sets them", () => {
    expect(sectionIsOpen("Network", true, {}, true)).toBe(true);
    expect(sectionIsOpen("Network", true, { Network: false }, true)).toBe(false);
    expect(sectionIsOpen("Network", false, {}, false)).toBe(false);
    expect(sectionIsOpen("Network", false, { Network: true }, false)).toBe(true);
  });
});
