import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GenerateStepProgress } from "../src/components/GenerateWizard";
import { wizardReducer, initialWizardState } from "../src/lib/generateWizard";

function markup(step: "input" | "map" | "preview", middle: "Options" | "Columns" = "Options") {
  return renderToStaticMarkup(
    createElement(GenerateStepProgress, { step, middle, onFinished: () => undefined }),
  );
}

describe("From data steps", () => {
  it("marks the current step, mutes upcoming steps, and uses Columns for a links table", () => {
    const first = markup("input", "Columns");
    expect(first).toContain("Data");
    expect(first).toContain("Columns");
    expect(first).toContain("Preview");
    expect(first).toContain('aria-current="step"');
    expect(first).toContain("is-current");
    expect(first).toContain("is-upcoming");
    expect(first).not.toContain("<button");
    const options = markup("map", "Options");
    expect(options).toContain("Options");
    expect(options).toContain("is-done");
    expect(options).toContain(">Data<");
  });

  it("goes back to a finished step and leaves an upcoming step alone", () => {
    const preview = wizardReducer(initialWizardState(), { type: "go", step: "input" });
    expect(preview.step).toBe("input");
    const onPreview = { ...initialWizardState(), step: "preview" as const };
    expect(wizardReducer(onPreview, { type: "go", step: "input" }).step).toBe("input");
    expect(wizardReducer(onPreview, { type: "go", step: "map" }).step).toBe("map");
    expect(wizardReducer(onPreview, { type: "go", step: "preview" }).step).toBe("preview");
  });
});
