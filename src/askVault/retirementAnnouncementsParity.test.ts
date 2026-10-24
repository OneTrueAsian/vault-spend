import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RETIREMENT_ANNOUNCEMENTS } from "./retirementScreenContract";

// The compiled-screen matrix (e2e/lib/retirementScreenMatrix.mjs) restates the announcement table so it can check what the real app announces. This keeps that copy equal to the source of truth.
describe("the compiled-screen matrix's announcement table equals RETIREMENT_ANNOUNCEMENTS", () => {
  const source = readFileSync(join(__dirname, "../../e2e/lib/retirementScreenMatrix.mjs"), "utf8");
  const start = source.indexOf("const ANNOUNCE = {");
  const block = source.slice(start, source.indexOf("};", start));
  const entry = /([a-z-]+|"[a-z-]+"):\s*\{\s*heading:\s*(null|"(?:[^"\\]|\\.)*"),\s*live:\s*"(alert|status|none)"\s*\}/g;
  const copy = Object.fromEntries([...block.matchAll(entry)].map(([, key, heading, live]) => [key.replace(/"/g, ""), { heading: JSON.parse(heading), live }]));
  it("lists every stage, with the same heading and live region", () => {
    expect(copy).toEqual(RETIREMENT_ANNOUNCEMENTS);
  });
});
