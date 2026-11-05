import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";
import { GATE_JOBS, requiredChecks, checkOwner } from "../e2e/lib/gateChecks.mjs";

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
  assert.equal(release.jobs.release.if, "${{ !cancelled() && !inputs.sharded && !inputs.test_release && (inputs.diagnostic_only || needs.release-baseline.result == 'success') }}");
  assert.equal(prepare.jobs.windows.if, "${{ !inputs.sharded }}");
  assert.equal(prepare.jobs.macos.if, "${{ !inputs.sharded }}");
  assert.equal(prepare.jobs["sign-updates"].if, "${{ !inputs.sharded }}");
  assert.equal(prepare.on.workflow_call.inputs.sharded.default, false);
});

test("a sharded release-windows request must be a pinned diagnostic, a release on its own tag, or a draft test release", () => {
  assert.deepEqual(release.jobs["sharded-gate"].needs, "sharded-request");
  const run = release.jobs["sharded-request"].steps[0].run;
  for (const needle of ['"$DIAGNOSTIC_ONLY" == "true"', '"$RECOVERY" == "true"', "[0-9a-f]{40}", "refs/heads/*", 'refs/tags/$RELEASE_TAG', '"$SOURCE_SHA" == "$GITHUB_SHA"', "v[0-9]+"]) assert.ok(run.includes(needle), needle);
  assert.equal(release.jobs["sharded-gate"].with.recovery, "${{ inputs.recovery }}");
  // The signing job is unreachable for diagnostics.
  assert.equal(release.jobs["sign-updates"].if, "${{ !inputs.recovery && !inputs.diagnostic_only }}");
});

test("the serial gate still runs every check, unchanged, when the flag is off", () => {
  const names = release.jobs.release.steps.map(s => s.name).filter(Boolean);
  for (const name of ["Frontend tests", "Lint", "Rust tests", "Build current desktop test app", "Desktop WebDriver smoke preflight", "Full desktop E2E release gate", "Build Windows installers into the draft release"]) assert.ok(names.includes(name), name);
  assert.equal(step(release.jobs.release, "Full desktop E2E release gate").run.includes("-Shard"), false);
  assert.equal(step(prepare.jobs.windows, "Full desktop E2E release gate").run.includes("-Shard"), false);
  assert.equal(release.jobs.release["timeout-minutes"], 240);
});

test("every shard repeats the serial job's hosted-environment steps exactly", () => {
  for (const name of hostedSteps) assert.deepEqual(step(gate.jobs.shard, name), step(release.jobs.release, name), name);
  assert.deepEqual(step(gate.jobs.build, "Build current desktop test app"), step(release.jobs.release, "Build current desktop test app"));
  // Every check the serial job runs before the desktop specs still runs, unchanged, in exactly one job of the gate.
  const owner = { "Build E2E database fixture tool": "build", "Build frontend for Rust tests": "checks-rust", "Rust tests": "checks-rust", "Frontend tests": "checks-other", Lint: "checks-other",
    "Install RustSec scanner": "checks-other", "Dependency security policy tests": "checks-other", "Audit dependencies for x86_64-pc-windows-msvc": "checks-other" };
  for (const [name, job] of Object.entries(owner)) {
    assert.deepEqual(step(gate.jobs[job], name), step(release.jobs.release, name), name);
    for (const other of ["build", "checks-rust", "checks-other"]) if (other !== job) assert.equal(step(gate.jobs[other], name), undefined, `${name} runs only in ${job}`);
  }
  const contract = step(gate.jobs["checks-other"], "Verify signed updater release contracts");
  assert.equal(contract.if, "${{ inputs.contract_tests != '' }}");
  assert.equal(contract.run, "node --test @($env:CONTRACT_TESTS -split '\\s+' | Where-Object { $_ })");
  assert.equal(step(gate.jobs["checks-other"], "Validate pinned preparation source").if, "${{ inputs.validate_preparation }}");
  assert.equal(step(gate.jobs["checks-other"], "Validate pinned preparation source").run, "node tools/prepare-update-artifacts.mjs validate");
  assert.deepEqual(step(gate.jobs["checks-other"], "Repair legacy test driver paths for recovery"), step(gate.jobs.build, "Repair legacy test driver paths for recovery"));
  assert.deepEqual(step(gate.jobs.build, "Repair legacy test driver paths for recovery"), step(gate.jobs.shard, "Repair legacy test driver paths for recovery"));
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
  assert.equal(gate.jobs.build.steps.find(s => s.name === "Stage the desktop test app for the test jobs").run, "node tools/transfer-build.mjs stage transfer");
  assert.equal(gate.jobs.build.steps.find(s => s.name === "Stage the desktop test app for the test jobs").env.CARGO_PROFILE_DEV_OPT_LEVEL, 1);
});

test("the whole staging folder travels, so the gitignored mobile viewer build reaches every shard", () => {
  const upload = gate.jobs.build.steps.find(s => s.with?.name === "desktop-test-app-${{ github.run_attempt }}");
  assert.equal(upload.with.path, "transfer/");
  const download = gate.jobs.shard.steps.find(s => s.with?.name === "desktop-test-app-${{ github.run_attempt }}");
  assert.equal(download.with.path, "transfer");
});

test("the shards use the Node and Rust the build used", () => {
  const setup = gate.jobs.shard.steps.find(s => s.uses === "actions/setup-node@v4");
  assert.equal(setup.with["node-version"], "${{ needs.build.outputs.node-version }}");
  const rust = gate.jobs.shard.steps.find(s => s.uses === "dtolnay/rust-toolchain@master");
  assert.equal(rust.with.toolchain, "${{ needs.build.outputs.rust-version }}");
  assert.equal(gate.jobs.shard.steps.find(s => s.uses === "Swatinem/rust-cache@v2").with["save-if"], false);
});

test("the aggregate job joins all six shards of this attempt and always reports", () => {
  const job = gate.jobs.aggregate;
  assert.deepEqual(job.needs, ["build", "checks-rust", "checks-other", "shard"]);
  assert.equal(job.if, "${{ !cancelled() }}");
  const join = job.steps.find(s => s.name === "Join shard results, check records and job results");
  assert.ok(join.run.includes("manifest/transfer-manifest.json 6 \"$RUN_ATTEMPT\" gate-summary.json --checks checks --contracts \"$CONTRACTS\""));
  assert.equal(join.env.NEEDS_JSON, "${{ toJSON(needs) }}", "the real result of every job");
  assert.equal(join.env.CONTRACTS, "${{ inputs.contract_tests != '' && 'yes' || 'no' }}");
  assert.equal(job.steps.find(s => s.with?.pattern?.startsWith("shard-evidence")).with.pattern, "shard-evidence-*-attempt-${{ github.run_attempt }}");
  assert.equal(job.steps.find(s => s.with?.pattern?.startsWith("check-records")).with.pattern, "check-records-*-attempt-${{ github.run_attempt }}");
  assert.equal(job.steps.find(s => s.with?.pattern?.startsWith("check-records")).with.path, "checks");
  for (const j of ["build", "checks-rust", "checks-other", "shard"]) assert.equal(gate.jobs[j]["timeout-minutes"] > 0, true);
  assert.equal(gate.jobs.build["timeout-minutes"], 240);
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

test("the gate has exactly the expected jobs, and the aggregate verifies exactly the jobs the gate defines", () => {
  assert.deepEqual(Object.keys(gate.jobs), ["build", "checks-rust", "checks-other", "shard", "aggregate"]);
  assert.deepEqual([...GATE_JOBS].sort(), ["build", "checks-other", "checks-rust", "shard"]);
  assert.deepEqual([...gate.jobs.aggregate.needs].sort(), [...GATE_JOBS].sort());
});

test("the shards need only the build, so they start when it succeeds and do not wait for any check", () => {
  assert.equal(gate.jobs.shard.needs, "build");
  assert.equal(gate.jobs["checks-rust"].needs, undefined);
  assert.equal(gate.jobs["checks-other"].needs, undefined);
  assert.equal(gate.jobs.build.needs, undefined);
  assert.equal(gate.jobs.shard.if, undefined, "implicit success(): a shard never runs after a failed build");
});

test("the desktop test app is built exactly once, in the build job, and no other job builds it", () => {
  const builds = Object.entries(gate.jobs).filter(([, job]) => (job.steps ?? []).some(s => /build:app|tauri build/.test(s.run ?? "")));
  assert.deepEqual(builds.map(([id]) => id), ["build"]);
  assert.equal(JSON.stringify(gate.jobs["checks-rust"].steps).includes("init_db"), false);
});

test("each check job ends by recording exactly the checks it owns, with no status function, then uploads them under a run-attempt name", () => {
  const recorded = [];
  for (const id of ["build", "checks-rust", "checks-other"]) {
    const steps = gate.jobs[id].steps, last = steps.at(-1);
    assert.match(last.uses, /^actions\/upload-artifact@v4/, id);
    assert.equal(last.with.name, `check-records-${id}-attempt-` + "${{ github.run_attempt }}", id);
    assert.equal(last.with.path, "check-records/"); assert.equal(last.with["if-no-files-found"], "error");
    assert.equal(last.if, undefined, `${id}: the upload runs only after a clean job`);
    for (const s of steps) if (s.run?.includes("write-check-records")) {
      assert.doesNotMatch(String(s.if ?? ""), /always|failure|cancelled|success\(\)/, `${id}: ${s.name}`);
      const match = s.run.match(/^node tools\/write-check-records\.mjs check-records ([a-z -]+)$/);
      assert.ok(match, s.name);
      for (const check of match[1].split(" ")) { assert.equal(checkOwner(check), id, `${check} belongs to ${id}`); recorded.push(check); }
    }
    // every record step sits after every real step of its job: nothing that can fail comes later
    const lastReal = steps.findLastIndex(s => !s.run?.includes("write-check-records") && !s.uses?.startsWith("actions/upload-artifact") && s.if !== "always()");
    const firstRecord = steps.findIndex(s => s.run?.includes("write-check-records"));
    assert.ok(firstRecord > lastReal, `${id}: records come after all checks`);
  }
  assert.deepEqual(recorded.sort(), requiredChecks({ contracts: true }).sort(), "the workflow writes a record for every required check and for nothing else");
  assert.equal(step(gate.jobs["checks-other"], "Record the contract tests check").if, "${{ inputs.contract_tests != '' }}");
});

test("every check job confirms the exact commit; tag cache saves stay on where something is compiled", () => {
  for (const id of ["checks-rust", "checks-other"]) {
    const confirm = step(gate.jobs[id], "Confirm the requested commit");
    assert.match(confirm.run, /git rev-parse HEAD/); assert.equal(confirm.env.SOURCE_SHA, "${{ inputs.source_sha }}");
    for (const s of gate.jobs[id].steps) if (s.uses?.startsWith("actions/checkout")) assert.equal(s.with.ref, "${{ inputs.source_sha }}");
  }
  const cache = id => gate.jobs[id].steps.find(s => s.uses === "Swatinem/rust-cache@v2").with;
  for (const id of ["build", "checks-rust"]) { assert.equal(cache(id)["cache-on-failure"], true, id); assert.equal(cache(id)["save-if"], undefined, `${id} keeps saving its cache`); }
});
