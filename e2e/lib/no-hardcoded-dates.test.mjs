import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Fixture dates written as a fixed calendar day drift: a view showing "the last 6 months" or "this month"
// reads them differently as time passes, and the spec starts failing on a calendar date (feature42/43,
// October 2026). Fixture dates go through dateInMonth/monthFromNow (lib/dates.mjs) instead. A date that
// must stay fixed (a version id, a date that only has to be "long ago") says so on its own line with
// `// fixed date: <why>`.
const E2E_DIR = path.resolve(import.meta.dirname, "..");
const DATE = /\b20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;

/** Every non-comment line in e2e/**\/*.mjs (tests excluded) that spells out a calendar date. */
export function hardCodedDates(dir = E2E_DIR) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs") || entry.name.endsWith(".test.mjs")) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (file.includes("node_modules")) continue;
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || /\/\/ fixed date: \S/.test(line)) return;
        if (DATE.test(line)) found.push(`${path.relative(dir, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
  }
  return found;
}

describe("e2e fixtures", () => {
  // It reads every spec from disk; the first read of freshly written files (a new checkout, which the
  // virus scanner checks) once took 5.9 s inside a full run, past vitest's 5 s default.
  it("spell no calendar dates outside comments (use lib/dates.mjs)", { timeout: 30_000 }, () => {
    expect(hardCodedDates()).toEqual([]);
  });
});
