// Guards for VS-39 (F-05): every third-party action in every workflow is pinned to a full commit SHA, so a moved tag cannot change
// what the release, gate or macOS workflows run, and the packaging job does not restore a Rust build cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";

const DIR = new URL("../.github/workflows/", import.meta.url);
const names = fs.readdirSync(DIR).filter(n => n.endsWith(".yml"));
const workflows = Object.fromEntries(names.map(n => [n, yaml.load(fs.readFileSync(new URL(n, DIR), "utf8"))]));

// Returns every `uses:` value in a parsed workflow (step-level and job-level reusable workflows).
export function usesOf(wf) {
  const found = [];
  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
    if (job.uses) found.push({ where: id, uses: job.uses });
    for (const step of job.steps ?? []) if (step.uses) found.push({ where: id, uses: step.uses });
  }
  return found;
}
// Local paths are reviewed in the same commit; everything else must be owner/repo[/path]@<40 hex>.
export const isPinned = uses => uses.startsWith("./") || /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/.test(uses);

test("the pin check accepts a full SHA and rejects tags and branches", () => {
  assert.ok(isPinned("actions/checkout@11d5960a326750d5838078e36cf38b85af677262"));
  assert.ok(isPinned("./.github/workflows/windows-desktop-gate-sharded.yml"));
  for (const bad of ["actions/checkout@v4", "dtolnay/rust-toolchain@stable", "dtolnay/rust-toolchain@master", "actions/checkout@11d5960"]) assert.equal(isPinned(bad), false, bad);
});

test("every action in every workflow is pinned to a commit SHA", () => {
  const unpinned = [];
  for (const [name, wf] of Object.entries(workflows)) for (const { where, uses } of usesOf(wf)) if (!isPinned(uses)) unpinned.push(`${name}:${where}: ${uses}`);
  assert.deepEqual(unpinned, []);
});

test("the packaging job does not restore a Rust build cache", () => {
  const steps = workflows["release-windows.yml"].jobs["sharded-package"].steps;
  assert.deepEqual(steps.filter(s => s.uses?.startsWith("Swatinem/rust-cache@")), []);
});
