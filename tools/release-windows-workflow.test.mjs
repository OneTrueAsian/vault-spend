// Guards for the release path (real releases and the draft test release); the sharded gate is the only route. The workflow YAML is evaluated, not just pattern-matched: a small evaluator runs the real `if:` expressions
// and `needs:` graph of release-windows.yml and windows-desktop-gate-sharded.yml against every input and job-result
// combination, and the real request-validation script is executed under bash. The model follows GitHub's documented rules: a job without a status
// function in its `if` gets an implicit success(), which is false when any needed job did not succeed (a skipped need included).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

const read = name => fs.readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
const release = yaml.load(read("release-windows.yml")), gate = yaml.load(read("windows-desktop-gate-sharded.yml"));
const macos = yaml.load(read("build-macos.yml"));
const BASH = ["C:/Program Files/Git/bin/bash.exe", "/usr/bin/bash", "/bin/bash"].find(p => fs.existsSync(p));

// ---- expression evaluator (the subset these workflows use) ----
const STATUS = /\b(always|cancelled|failure|success)\(\)/;
function evaluate(expression, ctx) {
  const source = String(expression).trim().replace(/^\$\{\{\s*/, "").replace(/\s*\}\}$/, "");
  const tokens = source.match(/'(?:[^']|'')*'|&&|\|\||==|!=|!|\(|\)|,|[A-Za-z_][A-Za-z0-9_.\-]*\(?/g) ?? [];
  let at = 0;
  const truthy = v => !(v === "" || v === false || v === null || v === undefined || v === 0);
  const lookup = path => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  function primary() {
    const t = tokens[at++];
    if (t === "(") { const v = or(); at++; return v; }
    if (t === "!") return !truthy(primary());
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === "true" || t === "false") return t === "true";
    if (t.endsWith("(")) {
      const name = t.slice(0, -1), args = [];
      while (tokens[at] !== ")") { args.push(or()); if (tokens[at] === ",") at++; }
      at++;
      if (name === "cancelled") return ctx.cancelled === true;
      if (name === "success") return Object.values(ctx.needs ?? {}).every(n => n.result === "success");
      if (name === "always") return true;
      if (name === "failure") return Object.values(ctx.needs ?? {}).some(n => n.result === "failure");
      if (name === "format") return String(args[0]).replace(/\{(\d)\}/g, (_, i) => String(args[Number(i) + 1]));
      throw Error(`Unsupported function ${name}`);
    }
    const v = lookup(t);
    return v === undefined ? "" : v;
  }
  function cmp() { let l = primary(); while (tokens[at] === "==" || tokens[at] === "!=") { const op = tokens[at++], r = primary(); l = op === "==" ? same(l, r) : !same(l, r); } return l; }
  function and() { let l = cmp(); while (tokens[at] === "&&") { at++; const r = cmp(); l = truthy(l) ? r : l; } return l; }
  function or() { let l = and(); while (tokens[at] === "||") { at++; const r = and(); l = truthy(l) ? l : r; } return l; }
  const value = or();
  assert.equal(at, tokens.length, `unparsed expression: ${expression}`);
  return value;
}
const needsOf = job => [job.needs ?? []].flat();
/** Whether a job (or step) runs: its own `if`, with GitHub's implicit success() when no status function is written. */
function runs(node, ctx) {
  if (node.if === undefined) return Object.values(ctx.needs ?? {}).every(n => n.result === "success");
  const text = String(node.if);
  const value = evaluate(text, ctx);
  return STATUS.test(text) ? Boolean(value) && value !== "" : Boolean(value) && Object.values(ctx.needs ?? {}).every(n => n.result === "success");
}
/** Simulates the jobs of a workflow. `fail` maps a job id to the result its steps would end with (default success). */
function simulate(workflow, inputs, fail = {}, github = {}) {
  const results = {}, jobs = workflow.jobs;
  for (let pass = 0; pass < 12; pass++) for (const [id, job] of Object.entries(jobs)) {
    if (results[id] || !needsOf(job).every(n => results[n])) continue;
    const needs = Object.fromEntries(needsOf(job).map(n => [n, { result: results[n] }]));
    const ctx = { inputs, needs, github, cancelled: Object.values(needs).some(n => n.result === "cancelled") };
    if (!runs(job, ctx)) { results[id] = "skipped"; continue; }
    results[id] = job.uses ? callGate(inputs, fail) : (fail[id] ?? "success");
  }
  return results;
}
/** The called gate workflow. Caller result: cancelled if any inner job was, else failure if any failed, else success (skipped only if all were). */
function callGate(callerInputs, fail) {
  const inputs = { fault: "", ...callerInputs }, inner = {};
  const faulted = (job, shard) => job.steps.some(s => /^Injected test fault/.test(s.name ?? "") && evaluate(s.if, { inputs, matrix: { shard }, needs: {} }) === true);
  for (const [id, job] of Object.entries(gate.jobs)) {
    const needs = Object.fromEntries(needsOf(job).map(n => [n, { result: inner[n] }]));
    const ctx = { inputs, needs, cancelled: Object.values(needs).some(n => n.result === "cancelled") };
    if (!runs(job, ctx)) { inner[id] = "skipped"; continue; }
    let outcomes;
    if (id === "shard") outcomes = [1, 2, 3, 4, 5, 6].map(s => (faulted(job, s) ? "failure" : fail[`shard-${s}`] ?? "success"));
    else if (id === "aggregate") outcomes = [fail.aggregate ?? (Object.values(needs).every(n => n.result === "success") ? "success" : "failure")];
    else outcomes = [faulted(job) ? "failure" : fail[id] ?? "success"];
    inner[id] = outcomes.includes("cancelled") ? "cancelled" : outcomes.includes("failure") ? "failure" : outcomes.includes("skipped") ? "skipped" : "success";
  }
  const all = Object.values(inner);
  return all.includes("cancelled") ? "cancelled" : all.includes("failure") ? "failure" : all.every(r => r === "skipped") ? "skipped" : "success";
}
const dispatch = (over = {}) => ({ tag: "v1.3.90", recovery: false, source_sha: "a".repeat(40), diagnostic_only: false, test_release: true, fault: "", ...over });
const DOWNSTREAM = ["sharded-package", "sharded-sign-updates"];
const GATE_JOBS_WITH_CHECKS = ["build", "checks-rust", "checks-other"];

test("the evaluator itself follows GitHub's rules", () => {
  assert.equal(evaluate("${{ inputs.a && 'x' || 'y' }}", { inputs: { a: true } }), "x");
  assert.equal(evaluate("${{ inputs.a && 'x' || 'y' }}", { inputs: { a: false } }), "y");
  assert.equal(evaluate("${{ !inputs.a && !inputs.b }}", { inputs: { a: false, b: false } }), true);
  assert.equal(evaluate("${{ inputs.fault == format('{0}', matrix.shard) }}", { inputs: { fault: "3" }, matrix: { shard: 3 } }), true);
  assert.equal(runs({ if: "${{ inputs.x }}" }, { inputs: { x: true }, needs: { a: { result: "skipped" } } }), false, "implicit success() fails on a skipped need");
  assert.equal(runs({ if: "${{ !cancelled() }}" }, { inputs: {}, needs: { a: { result: "failure" } } }), true, "an explicit status function lifts the implicit one");
});

const production = (over = {}) => dispatch({ test_release: false, tag: "v1.3.3", ...over });
const diagnostic = (over = {}) => dispatch({ test_release: false, diagnostic_only: true, recovery: true, tag: "v1.3.2", ...over });
const ROUTES = [["draft test release", dispatch], ["sharded production release", production]];

test("a clean gate runs packaging then signing on both routes", () => {
  for (const [name, make] of ROUTES) {
    assert.deepEqual(simulate(release, make()), { "sharded-request": "success", "release-baseline": "success", "sharded-gate": "success", "sharded-package": "success", "sharded-sign-updates": "success" }, name);
  }
});

test("any failed, cancelled, skipped or fault-injected part of the gate, or a failed baseline, blocks packaging, signing and upload", () => {
  for (const [name, make] of ROUTES) {
    const blocked = (inputs, fail) => { const r = simulate(release, inputs, fail); for (const j of DOWNSTREAM) assert.equal(r[j], "skipped", `${name}: ${j} must not run: ${JSON.stringify([inputs.fault, fail])}`); return r; };
    assert.equal(blocked(make(), { "sharded-request": "failure" })["sharded-gate"], "skipped", name);
    for (const bad of ["failure", "cancelled", "skipped"]) {
      for (const job of GATE_JOBS_WITH_CHECKS) blocked(make(), { [job]: bad });
      for (let s = 1; s <= 6; s++) blocked(make(), { [`shard-${s}`]: bad });
      if (bad !== "skipped") blocked(make(), { aggregate: bad }); // an aggregate that never ran leaves no summary: the packaging job fails at its download (guarded below)
      blocked(make(), { "release-baseline": bad });
    }
  }
  // The injected faults reach the real gate steps through the real `if:` expressions, on the test route only.
  for (const fault of ["prepare", "rust-checks", "other-checks"]) {
    const r = simulate(release, dispatch({ fault }));
    assert.equal(r["sharded-gate"], "failure", fault);
    for (const j of DOWNSTREAM) assert.equal(r[j], "skipped", `${fault}: ${j}`);
  }
  for (let s = 1; s <= 6; s++) {
    const r = simulate(release, dispatch({ fault: String(s) }));
    assert.equal(r["sharded-gate"], "failure", `shard ${s}`);
    for (const j of DOWNSTREAM) assert.equal(r[j], "skipped", j);
  }
});

test("a refused request never reaches the gate, and diagnostics can never package or sign", () => {
  const refused = simulate(release, dispatch(), { "sharded-request": "failure" });
  for (const j of ["sharded-gate", ...DOWNSTREAM]) assert.equal(refused[j], "skipped", j);
  const diag = simulate(release, diagnostic());
  for (const j of ["release-baseline", "sharded-package", "sharded-sign-updates"]) assert.equal(diag[j], "skipped", j);
  assert.equal(diag["sharded-gate"], "success");
});

test("the dispatch inputs: no sharded switch, a boolean test_release that is off by default, an empty fault", () => {
  const inputs = release.on.workflow_dispatch.inputs;
  assert.equal(inputs.sharded, undefined);
  assert.equal(inputs.test_release.default, false);
  assert.equal(inputs.test_release.type, "boolean");
  assert.equal(inputs.fault.default, "");
  assert.equal(release.jobs["sharded-gate"].if, undefined, "the gate always runs for an accepted request");
  assert.equal(release.jobs["sharded-package"].if, "${{ !inputs.diagnostic_only }}");
  assert.equal(release.jobs["sharded-sign-updates"].if, "${{ !inputs.diagnostic_only }}");
});

test("the packaging and signing jobs never use a status function that would let them run after a failure", () => {
  for (const id of ["sharded-package", "sharded-sign-updates"]) {
    assert.doesNotMatch(String(release.jobs[id].if), /always|cancelled|failure|success/, id);
    for (const s of release.jobs[id].steps) assert.doesNotMatch(String(s.if ?? ""), /always|cancelled|failure/, `${id}: ${s.name}`);
  }
  assert.deepEqual(release.jobs["sharded-package"].needs, ["sharded-gate", "release-baseline"]);
  assert.deepEqual(release.jobs["sharded-sign-updates"].needs, ["sharded-package", "release-baseline"]);
  assert.equal(release.jobs["sharded-sign-updates"].environment, "release-signing");
  assert.equal(release.jobs["sharded-package"].environment, undefined);
  assert.equal(release.jobs["release-baseline"].permissions.contents, "read");
  assert.deepEqual(gate.on.workflow_call.secrets, undefined);
});

const ASSERT = stage => new RegExp(`assert-draft-release\\.mjs "\\$RELEASE_TAG" --mode "\\$MODE" --stage ${stage} --previous "\\$PREVIOUS"`);
const MODE = "${{ inputs.test_release && 'test' || 'production' }}", PREVIOUS = "${{ needs.release-baseline.outputs.previous }}";

test("the baseline job reads the newest published release once, before anything is built, and every later check is held to it", () => {
  const job = release.jobs["release-baseline"], step = job.steps.find(s => s.id === "baseline");
  assert.equal(job.if, "${{ !inputs.diagnostic_only }}");
  assert.equal(job.outputs.previous, "${{ steps.baseline.outputs.previous }}");
  assert.match(step.run, /releases\/latest --jq \.tag_name/);
  assert.match(step.run, /--stage before --previous "\$previous"/);
  assert.match(step.run, /echo "previous=\$previous" >> "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(JSON.stringify(release.jobs), /v1\.3\.2\b/, "no fixed baseline tag");
  assert.doesNotMatch(JSON.stringify(release.jobs), /assert-draft-release\.mjs "\$RELEASE_TAG" v1\./);
});

test("the baseline job stays read-only, so its comment says it cannot see drafts and the packaging job's check is the one that refuses a stale draft (VS-72)", () => {
  assert.equal(release.jobs["release-baseline"].permissions.contents, "read");
  const text = read("release-windows.yml"), start = text.indexOf("\n  release-baseline:"), end = text.indexOf("\n  sharded-gate:");
  const comment = text.slice(start, end).split(/\r?\n/).filter(l => /^\s{4}#/.test(l)).join(" ");
  assert.match(comment, /read-only token cannot see draft releases/);
  assert.match(comment, /sharded-package/);
  assert.match(comment, /VS-72/);
});

test("the sharded packaging job verifies the gate evidence first, builds a draft, and rechecks it after every release change", () => {
  const steps = release.jobs["sharded-package"].steps, names = steps.map(s => s.name ?? s.uses);
  const verify = names.indexOf("Verify the gate evidence before building anything"), before = names.indexOf("Confirm the tag has no release yet or only an empty draft");
  const build = names.indexOf("Build Windows installers into the draft release"), after = names.indexOf("Confirm the release is still one draft");
  assert.ok(verify > 0 && verify < before && before < build && build < after);
  assert.ok(names.indexOf("Validate the release request") < verify);
  assert.equal(steps.find(s => s.uses === "actions/download-artifact@v4").with.name, "sharded-gate-summary-${{ github.run_attempt }}");
  assert.ok(names.indexOf("actions/download-artifact@v4") < verify, "the summary the aggregate writes is fetched before anything else is trusted");
  assert.match(steps[verify].run, /verify-sharded-gate-summary\.mjs gate-evidence\/gate-summary\.json \$env:RUN_ATTEMPT --contracts yes$/);
  assert.equal(steps[verify].env.SOURCE_SHA, "${{ inputs.source_sha }}");
  assert.equal(steps[verify].env.RUN_ATTEMPT, "${{ github.run_attempt }}");
  assert.equal(steps[verify].env.GITHUB_RUN_ID, undefined, "the run id comes from the runner, not from the workflow");
  const tauri = steps[build];
  assert.equal(tauri.with.releaseDraft, true, "always a draft");
  assert.equal(tauri.with.prerelease, "${{ inputs.test_release }}", "a prerelease only on the test route");
  assert.equal(tauri.with.tagName, "${{ inputs.tag }}");
  assert.match(steps[before].run, ASSERT("before")); assert.match(steps[after].run, ASSERT("after"));
  for (const i of [before, after]) { assert.equal(steps[i].env.MODE, MODE); assert.equal(steps[i].env.PREVIOUS, PREVIOUS); }
  assert.equal(release.jobs["sharded-package"].permissions.contents, "write");
  assert.equal(steps.find(s => s.id === "provenance").run, "node tools/update-build-provenance.mjs windows-x86_64 $env:RELEASE_TAG.Substring(1)");
  assert.doesNotMatch(JSON.stringify(steps), /--clobber/);
});

const PWSH = ["pwsh", "C:/Program Files/PowerShell/7/pwsh.exe"].find(p => spawnSync(p, ["-NoProfile", "-Command", "exit 0"]).status === 0);
test("the packaging job's request check holds each route to its own tags", { skip: !PWSH && "pwsh is required" }, () => {
  const step = release.jobs["sharded-package"].steps.find(s => s.name === "Validate the release request");
  const attempt = (tag, testRelease, ref = `refs/tags/${tag}`) => {
    // Version files are checked against the real checkout only when the other checks pass, so run the tag rules in isolation.
    const probe = step.run.split("$version = ")[0];
    const out = spawnSync(PWSH, ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; function git { 'x' }; ${probe}`], { env: { ...process.env, RELEASE_TAG: tag, TEST_RELEASE: String(testRelease), GITHUB_REF: ref, SOURCE_SHA: "a".repeat(40), GITHUB_SHA: "a".repeat(40) }, encoding: "utf8" });
    return `${out.stdout}${out.stderr}`;
  };
  assert.match(attempt("v1.3.3", true), /reserved test tag/i);
  assert.match(attempt("v1.3.91", false), /Reserved test tag/);
  assert.match(attempt("v1.3", false), /Invalid stable release tag/);
  assert.match(attempt("v1.3.3", false, "refs/heads/main"), /release tag as its ref/);
});

test("the signing job signs the final bytes, uploads without overwriting, never publishes, and rechecks the draft before and after", () => {
  const sharded = release.jobs["sharded-sign-updates"].steps;
  for (const [id, steps, digests] of [["sharded-sign-updates", sharded, "sharded-package"]]) {
    const sign = steps.find(s => s.name === "Sign exact final Windows bytes");
    assert.match(sign.run, /^node tools\/update-signing\.mjs sign windows-x86_64 /, id);
    assert.equal(sign.env.VAULTSPEND_UPDATE_EXPECTED_DIGESTS, `\${{ needs.${digests}.outputs.installer-digests }}`, id);
    const secretSteps = steps.filter(s => JSON.stringify(s).includes("secrets.UPDATE_SIGNING"));
    assert.deepEqual(secretSteps.map(s => s.name), ["Sign exact final Windows bytes"], id);
    assert.doesNotMatch(JSON.stringify(secretSteps[0]), /GH_TOKEN|GITHUB_TOKEN/, id);
    assert.doesNotMatch(JSON.stringify(steps), /--clobber|upload-artifact|gh release edit|--draft=false|releases\/\d+.*PATCH|publish/i, id);
    const upload = steps.find(s => /^Upload (immutable )?(Windows )?manifests and signatures to the draft$/.test(s.name));
    assert.ok(upload, id);
    assert.ok(upload.run.search(/assert-draft-release/) < upload.run.indexOf("gh release upload"), `${id}: the draft is checked before the upload`);
    assert.equal(steps.at(-1).name, "Confirm the release is still one draft", id);
    assert.match(steps.at(-1).run, ASSERT("after"), id);
    assert.match(upload.run, ASSERT("after"), id);
    assert.equal(steps.at(-1).env.MODE === undefined, false, id);
  }
  assert.match(sharded.find(s => s.name === "Download the draft's Windows installers").run, ASSERT("after"));
  assert.equal(sharded.find(s => s.uses === "actions/checkout@v4").with.ref, "${{ needs.sharded-package.outputs.source-sha }}");
});

test("the request script, run for real, accepts only the three intended shapes", { skip: !BASH && "bash is required" }, () => {
  const script = release.jobs["sharded-request"].steps[0].run, stepEnv = release.jobs["sharded-request"].steps[0].env;
  const attempt = (inputs, github = {}) => {
    const env = {};
    for (const [k, v] of Object.entries(stepEnv)) env[k] = String(evaluate(v, { inputs }));
    const out = spawnSync(BASH, ["-c", script], { env: { PATH: process.env.PATH, GITHUB_REF: `refs/tags/${inputs.tag}`, GITHUB_SHA: inputs.source_sha, ...github, ...env }, encoding: "utf8" });
    return out.status === 0;
  };
  // 1. The draft test release.
  assert.equal(attempt(dispatch()), true, "valid draft test release");
  assert.equal(attempt(dispatch({ fault: "prepare" })), true);
  assert.equal(attempt(dispatch({ fault: "rust-checks" })), true);
  assert.equal(attempt(dispatch({ fault: "other-checks" })), true);
  assert.equal(attempt(dispatch({ fault: "6" })), true);
  for (const [name, over, github] of [
    ["diagnostic", { diagnostic_only: true }], ["recovery", { recovery: true }],
    ["stable tag", { tag: "v1.3.2" }], ["next real tag", { tag: "v1.3.3" }], ["band edge", { tag: "v1.3.100" }], ["other minor", { tag: "v1.4.90" }],
    ["branch ref", {}, { GITHUB_REF: "refs/heads/test-release" }], ["other tag ref", {}, { GITHUB_REF: "refs/tags/v1.3.91" }],
    ["source differs from the tag commit", {}, { GITHUB_SHA: "b".repeat(40) }], ["short sha", { source_sha: "abc" }, { GITHUB_SHA: "abc" }], ["bad fault", { fault: "7" }], ["bad fault word", { fault: "all" }], ["near-miss fault", { fault: "rust" }],
  ]) assert.equal(attempt(dispatch(over), github), false, `test route: ${name}`);
  // 2. A sharded production release: a normal tag, on its own tag, never a fault, never recovery or diagnostic.
  assert.equal(attempt(production()), true, "valid sharded production release");
  assert.equal(attempt(production({ tag: "v2.0.0" })), true);
  for (const [name, over, github] of [
    ["reserved tag", { tag: "v1.3.90" }], ["reserved tag edge", { tag: "v1.3.99" }], ["fault", { fault: "prepare" }], ["check fault", { fault: "rust-checks" }], ["fault number", { fault: "2" }],
    ["recovery only", { recovery: true }, { GITHUB_REF: "refs/heads/release-1.3.3" }], ["diagnostic only", { diagnostic_only: true }, { GITHUB_REF: "refs/heads/release-1.3.3" }],
    ["branch ref", {}, { GITHUB_REF: "refs/heads/release-1.3.3" }], ["another tag as ref", {}, { GITHUB_REF: "refs/tags/v1.3.2" }],
    ["source differs from the tag commit", {}, { GITHUB_SHA: "b".repeat(40) }], ["no source", { source_sha: "" }, { GITHUB_SHA: "" }], ["bad tag", { tag: "1.3.3" }], ["prerelease tag", { tag: "v1.3.3-rc1" }],
  ]) assert.equal(attempt(production(over), github), false, `production route: ${name}`);
  // 3. The recovery diagnostic: unchanged.
  const diag = (over, github = { GITHUB_REF: "refs/heads/release-1.3.3" }) => attempt(diagnostic(over), github);
  assert.equal(diag({}), true);
  assert.equal(diag({ diagnostic_only: false }), false, "recovery without diagnostic_only is not a release either");
  assert.equal(diag({ recovery: false }), false);
  assert.equal(diag({ tag: "v1.3.90" }), false, "a reserved tag never runs as a plain diagnostic");
  assert.equal(diag({ fault: "prepare" }), false, "faults belong to the draft test path only");
  assert.equal(diag({ fault: "other-checks" }), false, "faults belong to the draft test path only");
  assert.equal(diag({}, { GITHUB_REF: "refs/tags/v1.3.2" }), false, "diagnostics still need a workflow branch");
});

test("macOS no longer refuses the reserved test band outright (VS-20): it joins a test draft prerelease and nothing else, as tools/build-macos-workflow.test.mjs proves", () => {
  const steps = macos.jobs["build-macos"].steps;
  assert.equal(steps[0].name, "Validate the release tag");
  assert.equal(steps.some(s => s.name === "Refuse reserved test tags"), false);
  const check = steps.find(s => s.id === "release");
  assert.match(check.run, /assert-macos-release\.mjs/);
  assert.ok(steps.indexOf(check) < steps.findIndex(s => /^tauri-apps\/tauri-action@/.test(s.uses ?? "")), "the release check runs before the packaging step");
});

test("the sharded gate runs the required contract tests, and the fault comes only from the caller", () => {
  const call = release.jobs["sharded-gate"], required = ["tools/update-signing.test.mjs", "tools/update-signing-workflow.test.mjs", "tools/verify-sharded-gate-summary.test.mjs", "tools/assert-draft-release.test.mjs", "tools/sharded-gate-workflow.test.mjs", "tools/release-windows-workflow.test.mjs", "tools/aggregate-shard-results.test.mjs", "tools/write-check-records.test.mjs", "tools/least-privilege-workflow.test.mjs", "tools/ci-tool-supply-chain.test.mjs"];
  for (const testRelease of [true, false]) assert.deepEqual(evaluate(call.with.contract_tests, { inputs: { test_release: testRelease, recovery: false } }).split(" "), required, `sharded gate, test_release=${testRelease}`);
  assert.equal(evaluate(call.with.contract_tests, { inputs: { test_release: false, recovery: true } }), "", "recovery diagnostics keep running no contract tests, as before");
  for (const file of required) assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), `${file} exists`);
  assert.equal(call.with.fault, "${{ inputs.fault }}");
  assert.equal(call.with.recovery, "${{ inputs.recovery }}");
  assert.equal(gate.on.workflow_call.inputs.fault.default, "");
  assert.ok(gate.jobs.build.steps.some(s => s.name === "Injected test fault - fail preparation"));
  assert.ok(gate.jobs["checks-rust"].steps.some(s => s.name === "Injected test fault - fail the Rust checks"));
  assert.ok(gate.jobs["checks-other"].steps.some(s => s.name === "Injected test fault - fail the other checks"));
  assert.ok(gate.jobs.shard.steps.some(s => s.name === "Injected test fault - fail this shard"));
  assert.deepEqual(gate.permissions, { contents: "read" });
});
