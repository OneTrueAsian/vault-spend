// Kind: policy lint (checks source text, not behaviour).
import fs from "node:fs";
import { describe, expect, it } from "vitest";

// Spec 157 reproduces the original QA report (H3): a 50,000-row profile. It no longer relies on the size to see the loading placeholder;
// it starts watching before it opens the profile (VS-10).
const source = fs.readFileSync(new URL("../feature157_loading_state.mjs", import.meta.url), "utf8");

describe("spec 157's fixture", () => {
  it("has at least the 50,000 rows of the QA report", () => {
    expect(Number(source.match(/const ROWS = ([\d_]+);/)?.[1].replaceAll("_", ""))).toBeGreaterThanOrEqual(50000);
  });
});
