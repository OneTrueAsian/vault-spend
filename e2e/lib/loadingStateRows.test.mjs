import fs from "node:fs";
import { describe, expect, it } from "vitest";

// Spec 157 can only see the loading placeholder if the first load outlasts the moment the spec starts watching. With 20,000 rows a fast hosted
// runner had finished loading by then (the placeholder was never seen, 116 ms to the first row). It uses the 50,000-row size the original
// QA report (H3) described, which widens that window.
const source = fs.readFileSync(new URL("../feature157_loading_state.mjs", import.meta.url), "utf8");

describe("spec 157's fixture", () => {
  it("has at least the 50,000 rows of the QA report", () => {
    expect(Number(source.match(/const ROWS = ([\d_]+);/)?.[1].replaceAll("_", ""))).toBeGreaterThanOrEqual(50000);
  });
});
