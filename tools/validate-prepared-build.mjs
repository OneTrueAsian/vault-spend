import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packageName } from "./update-signing.mjs";
const REPO = "OneTrueAsian/vault-spend";
const ALLOWED = new Set([".github/workflows/build-macos-check.yml", ".github/workflows/prepare-signed-installers.yml", "tools/prepare-update-artifacts.test.mjs", "tools/validate-prepared-build.mjs", "tools/validate-prepared-build.test.mjs", "docs/UPDATE-SIGNING.md"]);
export function validateBuild(run, jobs, sha, changed, windowsLog) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "") || run.head_sha !== sha || run.head_branch !== "release-1.3.1" ||
      run.head_repository?.full_name !== REPO || run.event !== "workflow_dispatch" || run.status !== "completed" ||
      run.path !== ".github/workflows/build-macos-check.yml" || changed.some(file => !ALLOWED.has(file)))
    throw Error("Existing build must use the exact approved source; application/test changes require rebuilding.");
  for (const platform of ["windows", "macos"]) {
    const job = jobs.find(job => job.name === "prepare-signed / " + platform);
    const required = platform === "windows"
      ? ["Frontend tests", "Lint", "Rust tests", "Desktop WebDriver smoke preflight", "Full desktop E2E release gate", "Build Windows installers without publication", "Record final Windows build provenance"]
      : ["Run npm test", "Run npm run lint", "Run cargo test --workspace", "Build universal DMG without publication", "Record final macOS build provenance"];
    if (job?.conclusion !== "success" || required.some(name => !job.steps?.some(step => step.name === name && step.conclusion === "success")))
      throw Error("Existing packaging gates did not all pass.");
  }
  if (!windowsLog.includes("202/202 passed")) throw Error("Full Windows desktop evidence is missing.");
  if (jobs.some(job => job.conclusion === "failure" && !job.name.startsWith("prepare-signed / sign-updates")))
    throw Error("Existing run has an unrelated failure.");
}
export function recordedDigests(log, target) {
  const matches = [...log.matchAll(/VAULTSPEND_UPDATE_EXPECTED_DIGESTS: (\{[^\r\n]+\})/g)];
  if (matches.length !== 1) throw Error("Packaging output hashes are missing or ambiguous.");
  const digests = JSON.parse(matches[0][1]);
  const names = target === "windows-x86_64" ? ["Vault.Spend_1.3.1_x64-setup.exe", "Vault.Spend_1.3.1_x64_en-US.msi"] : ["Vault.Spend_1.3.1_universal.dmg"];
  if (Object.keys(digests).sort().join() !== names.sort().join()) throw Error("Unexpected original installer set.");
  for (const [name, value] of Object.entries(digests)) {
    packageName("1.3.1", target, name);
    if (Object.keys(value).sort().join() !== "sha256,size" || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > 128 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(value.sha256))
      throw Error("Invalid original byte hashes.");
  }
  return digests;
}
function api(endpoint, json = true) {
  const text = execFileSync("gh", ["api", "--allow-escape-sequences", "repos/" + REPO + endpoint], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
  return json ? JSON.parse(text) : text.replace(/\x1b\[[0-9;]*m/g, "");
}
function main() {
  const id = process.env.PREPARED_RUN_ID, sha = process.env.SOURCE_SHA;
  if (process.env.GITHUB_REF !== "refs/heads/release-1.3.1" || process.env.PREPARE_SIGNED === "true" || !/^[1-9]\d*$/.test(id ?? "") || !/^[a-f0-9]{40}$/.test(sha ?? ""))
    throw Error("Signing recovery requires one existing run, exact source and the preparation branch.");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== process.env.GITHUB_SHA) throw Error("Workflow source changed.");
  execFileSync("git", ["merge-base", "--is-ancestor", sha, head]);
  const changed = execFileSync("git", ["diff", "--name-only", sha, head], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
  const run = api("/actions/runs/" + id), jobs = api("/actions/runs/" + id + "/jobs?per_page=100").jobs;
  const windows = jobs.find(job => job.name === "prepare-signed / windows");
  if (!windows) throw Error("Windows packaging job missing.");
  validateBuild(run, jobs, sha, changed, api("/actions/jobs/" + windows.id + "/logs", false));
  const outputs = { source_sha: sha };
  for (const [target, field] of [["windows-x86_64", "windows_digests"], ["macos-universal", "macos_digests"]]) {
    const job = jobs.find(job => job.name === `prepare-signed / sign-updates (${target})`);
    if (!job) throw Error("Original signing provenance job missing.");
    outputs[field] = JSON.stringify(recordedDigests(api("/actions/jobs/" + job.id + "/logs", false), target));
  }
  for (const [name, value] of Object.entries(outputs)) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log("Original platform gates, exact source and recorded packaging hashes verified. Publication remains disabled.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
