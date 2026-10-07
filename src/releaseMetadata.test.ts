import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHANGELOG } from "./changelog";

// The version lives in several files that must be bumped together for a release; this keeps them
// from drifting apart. `CANDIDATE` is the version this branch is preparing — change it (and add the
// CHANGELOG entry) as part of cutting the next release.
const CANDIDATE = "1.3.0";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

function packageVersion(lockText: string, name: string): string | undefined {
  const match = new RegExp(`name = "${name}"\\r?\\nversion = "([^"]+)"`).exec(lockText);
  return match?.[1];
}

describe("release metadata", () => {
  const pkg = JSON.parse(read("package.json")).version as string;
  const tauri = JSON.parse(read("src-tauri/tauri.conf.json")).version as string;
  const cargo = /^version = "([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1];

  it("names the same version in package.json, tauri.conf.json and the Rust crate", () => {
    expect({ pkg, tauri, cargo }).toEqual({ pkg, tauri: pkg, cargo: pkg });
  });

  it("keeps both lockfiles on that version", () => {
    const npmLock = JSON.parse(read("package-lock.json"));
    expect(npmLock.version).toBe(pkg);
    expect(npmLock.packages[""].version).toBe(pkg);
    expect(packageVersion(read("Cargo.lock"), "vaultspend")).toBe(pkg);
  });

  it("has a What's New entry with content for the current version", () => {
    expect(CHANGELOG[pkg]?.length ?? 0).toBeGreaterThan(0);
  });

  it(`is the ${CANDIDATE} release candidate and its notes cover what shipped`, () => {
    expect(pkg).toBe(CANDIDATE);
    const notes = (CHANGELOG[CANDIDATE] ?? []).join("\n");
    expect(notes).toMatch(/mobile/i);
    expect(notes).toMatch(/snapshot/i);
    expect(notes).toMatch(/Settings/);
    expect(notes).toMatch(/Accounts/);
    expect(notes).toMatch(/Goals/);
    expect(notes).toMatch(/1900.*2100/);
    // Everything else 1.3.0 changed that people will notice.
    expect(notes).toMatch(/import review/i);
    expect(notes).toMatch(/remember/i);
    expect(notes).toMatch(/Show more/);
    expect(notes).toMatch(/Money out \/ Money in/);
    expect(notes).toMatch(/Show names/);
    expect(notes).toMatch(/Budget/);
    expect(notes).toMatch(/Dashboard/);
    expect(notes).toMatch(/Recurring/);
    expect(notes).toMatch(/Oct 4/);
    expect(notes).toMatch(/red only/i);
    expect(notes).toMatch(/Charts/);
    expect(notes).toMatch(/Help/);
  });

  it("preserves the 1.2.9 release notes", () => {
    const notes = (CHANGELOG["1.2.9"] ?? []).join("\n");
    expect(notes).toMatch(/comparisons/i);
    expect(notes).toMatch(/flip the signs/i);
    expect(notes).toMatch(/note to any transaction/i);
    expect(notes).toMatch(/retro/i);
    expect(notes).toMatch(/slate/i);
    expect(notes).toMatch(/same name as an existing one/i);
  });
});
