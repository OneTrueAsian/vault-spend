import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";

const read = name => fs.readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
const gateText = read("windows-desktop-gate-sharded.yml"), gate = yaml.load(gateText);
const releaseText = read("release-windows.yml"), release = yaml.load(releaseText);
const prepareText = read("prepare-signed-installers.yml"), prepare = yaml.load(prepareText);
const step = (job, name) => job.steps.find(s => s.name === name);
const hostedSteps = ["Refresh hosted WebView2 runtime", "Pin hosted Edge version", "Install desktop test drivers", "Install native Edge test driver", "Prepare medium-integrity desktop tests",
  "Desktop WebDriver smoke preflight", "Verify native Edge driver still matches Edge"];

test("the sharded gate cannot publish, sign or move a tag", () => {
  assert.deepEqual(gate.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(gate.on), ["workflow_call"]);
  assert.equal(gate.on.workflow_call.secrets, undefined, "no secrets are accepted");
  assert.doesNotMatch(gateText, /secrets\.|GITHUB_TOKEN|GH_TOKEN|gh release|git push|git tag|tagName|releaseName|tauri-action|contents: write|update-signing|environment:/);
  for (const job of Object.values(gate.jobs)) {
    assert.equal(job.permissions, undefined, "jobs inherit the read-only workflow permission");
    for (const s of job.steps) if (s.uses?.startsWith("actions/checkout")) assert.equal(s.with["persist-credentials"], false);
  }
});

test("both callers reach it read-only, without secrets, and keep their serial path behind the flag", () => {
  for (const [workflow, name] of [[release, "release-windows.yml"], [prepare, "prepare-signed-installers.yml"]]) {
    const call = workflow.jobs["sharded-gate"];
    assert.equal(call.uses, "./.github/workflows/windows-desktop-gate-sharded.yml", name);
    assert.deepEqual(call.permissions, { contents: "read" }, name);
    assert.equal(call.secrets, undefined, name);
    assert.equal(call.if, "${{ inputs.sharded }}", name);
    assert.equal(workflow.on.workflow_dispatch.inputs.sharded.default, false, name);
    assert.equal(workflow.on.workflow_dispatch.inputs.sharded.type, "boolean", name);
  }
  assert.equal(release.jobs.release.if, "${{ !inputs.sharded }}");
  assert.equal(prepare.jobs.windows.if, "${{ !inputs.sharded }}");
  assert.equal(prepare.jobs.macos.if, "${{ !inputs.sharded }}");
  assert.equal(prepare.jobs["sign-updates"].if, "${{ !inputs.sharded }}");
  assert.equal(prepare.on.workflow_call.inputs.sharded.default, false);
});

test("a sharded release-windows request must already be a pinned non-publishing diagnostic", () => {
  assert.deepEqual(release.jobs["sharded-gate"].needs, "sharded-request");
  const run = release.jobs["sharded-request"].steps[0].run;
  for (const needle of ['"$DIAGNOSTIC_ONLY" == "true"', '"$RECOVERY" == "true"', "[0-9a-f]{40}", "refs/heads/*", "v[0-9]+"]) assert.ok(run.includes(needle), needle);
  assert.equal(release.jobs["sharded-gate"].with.recovery, "${{ inputs.recovery }}");
  // The signing job is unreachable for diagnostics.
  assert.equal(release.jobs["sign-updates"].if, "${{ !inputs.recovery && !inputs.diagnostic_only }}");
});

test("the serial gate still runs every check, unchanged, when the flag is off", () => {
  const names = release.jobs.release.steps.map(s => s.name).filter(Boolean);
  for (const name of ["Frontend tests", "Lint", "Rust tests", "Build current desktop test app", "Desktop WebDriver smoke preflight", "Full desktop E2E release gate", "Build and publish Windows installers"]) assert.ok(names.includes(name), name);
  assert.equal(step(release.jobs.release, "Full desktop E2E release gate").run.includes("-Shard"), false);
  assert.equal(step(prepare.jobs.windows, "Full desktop E2E release gate").run.includes("-Shard"), false);
  assert.equal(release.jobs.release["timeout-minutes"], 240);
});

test("every shard repeats the serial job's hosted-environment steps exactly", () => {
  for (const name of hostedSteps) assert.deepEqual(step(gate.jobs.shard, name), step(release.jobs.release, name), name);
  assert.deepEqual(step(gate.jobs.prepare, "Build current desktop test app"), step(release.jobs.release, "Build current desktop test app"));
  for (const name of ["Frontend tests", "Lint", "Build frontend for Rust tests", "Rust tests", "Build E2E database fixture tool", "Install RustSec scanner", "Dependency security policy tests", "Audit dependencies for x86_64-pc-windows-msvc"])
    assert.deepEqual(step(gate.jobs.prepare, name), step(release.jobs.release, name), name);
});

test("the full gate step differs from the serial one only by naming its shard of six", () => {
  const serial = step(release.jobs.release, "Full desktop E2E release gate"), sharded = step(gate.jobs.shard, "Full desktop E2E release gate");
  assert.deepEqual(sharded.env, serial.env);
  assert.equal(sharded.run.replace(" -Shard ${{ matrix.shard }}/6", ""), serial.run);
  assert.ok(sharded.run.includes("-Gate full -Shard ${{ matrix.shard }}/6"));
  assert.deepEqual(gate.jobs.shard.strategy.matrix.shard, [1, 2, 3, 4, 5, 6]);
  assert.equal(gate.jobs.shard.strategy["fail-fast"], false);
});

test("each shard checks the transferred build before any test runs, and never rebuilds it", () => {
  const names = gate.jobs.shard.steps.map(s => s.name ?? s.uses);
  const receive = names.indexOf("Receive the desktop test app and check its build identity");
  assert.ok(receive > names.indexOf("Install dependencies"));
  assert.ok(receive < names.indexOf("Desktop WebDriver smoke preflight") && receive < names.indexOf("Full desktop E2E release gate"));
  assert.equal(gate.jobs.shard.steps[receive].run, "node tools/transfer-build.mjs receive transfer");
  assert.equal(gate.jobs.shard.steps[receive].env.CARGO_PROFILE_DEV_OPT_LEVEL, 1);
  assert.doesNotMatch(JSON.stringify(gate.jobs.shard.steps), /build:app|tauri build|cargo build|--allow-stale-artifact|--force/);
  assert.equal(gate.jobs.prepare.steps.find(s => s.name === "Stage the desktop test app for the test jobs").run, "node tools/transfer-build.mjs stage transfer");
  assert.equal(gate.jobs.prepare.steps.find(s => s.name === "Stage the desktop test app for the test jobs").env.CARGO_PROFILE_DEV_OPT_LEVEL, 1);
});

test("the whole staging folder travels, so the gitignored mobile viewer build reaches every shard", () => {
  const upload = gate.jobs.prepare.steps.find(s => s.with?.name === "desktop-test-app-${{ github.run_attempt }}");
  assert.equal(upload.with.path, "transfer/");
  const download = gate.jobs.shard.steps.find(s => s.with?.name === "desktop-test-app-${{ github.run_attempt }}");
  assert.equal(download.with.path, "transfer");
});

test("the shards use the Node and Rust the build used", () => {
  const setup = gate.jobs.shard.steps.find(s => s.uses === "actions/setup-node@v4");
  assert.equal(setup.with["node-version"], "${{ needs.prepare.outputs.node-version }}");
  const rust = gate.jobs.shard.steps.find(s => s.uses === "dtolnay/rust-toolchain@master");
  assert.equal(rust.with.toolchain, "${{ needs.prepare.outputs.rust-version }}");
  assert.equal(gate.jobs.shard.steps.find(s => s.uses === "Swatinem/rust-cache@v2").with["save-if"], false);
});

test("the aggregate job joins all six shards of this attempt and always reports", () => {
  const job = gate.jobs.aggregate;
  assert.deepEqual(job.needs, ["prepare", "shard"]);
  assert.equal(job.if, "${{ !cancelled() }}");
  const join = job.steps.find(s => s.name === "Join shard results");
  assert.ok(join.run.includes("manifest/transfer-manifest.json 6 \"$RUN_ATTEMPT\""));
  assert.equal(job.steps.find(s => s.with?.pattern).with.pattern, "shard-evidence-*-attempt-${{ github.run_attempt }}");
  for (const j of ["prepare", "shard"]) assert.equal(gate.jobs[j]["timeout-minutes"] > 0, true);
  assert.equal(gate.jobs.prepare["timeout-minutes"], 240);
  assert.equal(gate.jobs.shard.steps.find(s => s.name === "Refresh hosted WebView2 runtime")["timeout-minutes"], 10);
});

test("six shards of the real spec list cover every spec exactly once", async () => {
  const { shardSpecs } = await import("../e2e/lib/specShard.mjs");
  const weights = JSON.parse(fs.readFileSync(new URL("../e2e/spec-weights.json", import.meta.url), "utf8")).weights;
  const specs = ["smoke.mjs", ...fs.readdirSync(new URL("../e2e/", import.meta.url)).filter(f => /^feature\d+.*\.mjs$/.test(f))];
  const parts = [1, 2, 3, 4, 5, 6].map(index => shardSpecs(specs, weights, { index, total: 6 }));
  assert.deepEqual(parts.flat().sort(), [...specs].sort());
  assert.ok(parts.every(p => p.length > 0));
});
