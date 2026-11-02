import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The base `button` rule (SharedButtons.css) centres a button's contents. Without its own justify-content the Get started
// rows on the Dashboard centred their circle and two lines of text, so each row started at a different left edge.
describe("Get started checklist rows", () => {
  it("start at the left edge, so every row lines up", () => {
    const css = readFileSync(new URL("./FirstRunChecklist.css", import.meta.url), "utf8");
    const rule = css.match(/\.checklist-step-btn\s*\{([^}]*)\}/);
    expect(rule, ".checklist-step-btn rule").not.toBeNull();
    expect(rule![1]).toMatch(/justify-content:\s*(flex-start|start)\b/);
  });
});
