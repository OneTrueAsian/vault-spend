import fs from "node:fs";
import { describe, expect, it } from "vitest";

// The profile menu's "Lock profile" entry only exists once the menu has rendered open. A script that looks it up and clicks it in one step
// throws "Cannot read properties of null" when the render is a moment late (spec 286, hosted sharded gate). Specs wait for the entry first.
const dir = new URL("../", import.meta.url);
const specs = fs.readdirSync(dir).filter(f => /^feature\d+.*\.mjs$/.test(f));

describe("clicking Lock profile in the profile menu", () => {
  it("is never a one-step lookup-and-click inside a script", () => {
    const offenders = specs.filter(file => /querySelector\(\s*["']\[data-profile-switcher-lock\]["']\s*\)\.click\(\)/.test(fs.readFileSync(new URL(file, dir), "utf8")));
    expect(offenders).toEqual([]);
  });
  it("opens the profile menu through the shared helper, not a one-step script click that can be missed (specs 306 and 310)", () => {
    const offenders = specs.filter(file => /querySelector\(\s*["']\.profile-switcher-toggle["']\s*\)\.click\(\)/.test(fs.readFileSync(new URL(file, dir), "utf8")));
    expect(offenders).toEqual([]);
  });
});
