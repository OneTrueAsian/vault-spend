import fs from "node:fs";
import { describe, expect, it } from "vitest";

// First-attempt failures in the hosted sharded gate that were timing, not behaviour.
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("spec 360, the icon rail's hover titles", () => {
  // The rail is recognised by the sidebar's CSS width, but SidebarNav drops its "Drag to reorder" title (iconOnly) only after its own state
  // catches up, so a spec that reads the titles right after the width changes can see the old ones.
  it("waits for the drag hint to leave the nav buttons before checking their titles", () => {
    const source = read("feature360_qa_feature_toggles_and_sidebar_names.mjs");
    const wait = source.indexOf("the icon rail drops the drag-to-reorder hover title");
    const read_ = source.indexOf("const rail = await b.execute");
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(read_);
  });
});

describe("spec 306, creating and switching to a second profile", () => {
  it("allows 30 seconds for the new profile to become the current one", () => {
    expect(read("feature306_ask_vault_retirement_lifecycle.mjs")).toMatch(/=== "M5 Other", \{ timeout: 30000 \}\);\s*await b\.\$\('\.nav-item\[data-tab="settings"\]'\)/);
  });
});
