import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBuild, recordedDigests } from "./validate-prepared-build.mjs";

const sha = "a".repeat(40);
function fixture() {
  return {
    run: { head_sha: sha, head_branch: "release-1.3.1", head_repository: { full_name: "OneTrueAsian/vault-spend" }, event: "workflow_dispatch", status: "completed", path: ".github/workflows/build-macos-check.yml" },
    jobs: [
      { name: "prepare-signed / windows", conclusion: "success", steps: ["Frontend tests", "Lint", "Rust tests", "Desktop WebDriver smoke preflight", "Full desktop E2E release gate", "Build Windows installers without publication", "Record final Windows build provenance"].map(name => ({ name, conclusion: "success" })) },
      { name: "prepare-signed / macos", conclusion: "success", steps: ["Run npm test", "Run npm run lint", "Run cargo test --workspace", "Build universal DMG without publication", "Record final macOS build provenance"].map(name => ({ name, conclusion: "success" })) },
    ],
  };
}
test("signing recovery requires exact source, both packaging gates, full regression and no application drift", () => {
  const { run, jobs } = fixture();
  validateBuild(run, jobs, sha, [".github/workflows/build-macos-check.yml"], "202/202 passed");
  for (const change of [{ head_sha: "b".repeat(40) }, { head_branch: "main" }, { status: "in_progress" }, { event: "push" }, { path: "other.yml" }])
    assert.throws(() => validateBuild({ ...run, ...change }, jobs, sha, [], "202/202 passed"));
  assert.throws(() => validateBuild(run, jobs, sha, ["src/App.tsx"], "202/202 passed"));
  assert.throws(() => validateBuild(run, jobs, sha, ["e2e/lib/protection.mjs"], "202/202 passed"));
  assert.throws(() => validateBuild(run, jobs, sha, [], "199/202 passed"));
  assert.throws(() => validateBuild(run, [{ ...jobs[0], conclusion: "failure" }, jobs[1]], sha, [], "202/202 passed"));
  const broken = structuredClone(jobs); broken[0].steps[4].conclusion = "skipped";
  assert.throws(() => validateBuild(run, broken, sha, [], "202/202 passed"));
});
test("signing recovery uses original packaging hashes and refuses ambiguous or malformed metadata", () => {
  const digests = { "Vault.Spend_1.3.1_universal.dmg": { size: 123, sha256: "b".repeat(64) } };
  const log = "timestamp   VAULTSPEND_UPDATE_EXPECTED_DIGESTS: " + JSON.stringify(digests);
  assert.deepEqual(recordedDigests(log, "macos-universal"), digests);
  for (const bad of ["", log + "\n" + log, log.replace("universal.dmg", "x64-setup.exe"), log.replace('"size":123', '"size":-1'), log.replace("b".repeat(64), "bad")])
    assert.throws(() => recordedDigests(bad, "macos-universal"));
});
