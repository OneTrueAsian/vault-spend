import fs from "node:fs";
import { describe, expect, it } from "vitest";

// A single click on a page's "?" button can be missed on a hosted runner (spec 361 failed its first attempt waiting for Help that never opened).
// The spec clicks again only while Help is not showing, so it never closes or double-opens one that did open.
const source = fs.readFileSync(new URL("../feature361_qa_help_sections_and_page_links.mjs", import.meta.url), "utf8");

describe("spec 361 opening Help from a page's ? button", () => {
  it("clicks the button only while Help is not showing, instead of one click and a wait", () => {
    expect(source).not.toMatch(/await help\.click\(\);\s*await b\.\$\("\.help-view, \.help-search"\)\.waitForExist\(\{ timeout: 10000 \}\);/);
    expect(source).toMatch(/if \(await b\.\$\("\.help-view, \.help-search"\)\.isExisting\(\)\) return true;\s*await help\.click\(\);\s*return false;/);
  });
});
