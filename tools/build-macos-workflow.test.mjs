// Guards for build-macos.yml (VS-20): macOS packaging joins the shared release as a DRAFT the Windows workflow already built, and never creates,
// publishes or replaces anything. The real `run:` scripts of the workflow are executed under bash against a stand-in `gh`, so the checks are behavior,
// not source text. The tauri-action input rules below were read from the pinned action source (see docs/UPDATE-SIGNING.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { windowsAssets, macosAssets } from "./assert-macos-release.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const text = fs.readFileSync(path.join(ROOT, ".github/workflows/build-macos.yml"), "utf8");
const workflow = yaml.load(text);
const BASH = ["C:/Program Files/Git/bin/bash.exe", "/usr/bin/bash", "/bin/bash"].find(p => fs.existsSync(p));
const skip = !BASH && "bash is required";
const PINNED_ACTION = "tauri-apps/tauri-action@84b9d35b5fc46c1e45415bdb6144030364f7ebc5";
const LISTING_JQ = ".[] | {id,tag_name,draft,prerelease,target_commitish,assets:[.assets[].name]}";

const build = workflow.jobs["build-macos"], sign = workflow.jobs["sign-updates"];
const names = job => job.steps.map(s => s.name ?? s.uses);
const stepNamed = (job, name) => { const found = job.steps.find(s => s.name === name); assert.ok(found, `step "${name}" exists`); return found; };
const indexOfStep = (job, name) => { const at = job.steps.findIndex(s => s.name === name); assert.ok(at >= 0, `step "${name}" exists`); return at; };
const S = {
  tag: "Validate the release tag", source: "Validate the tag commit and version", preflight: "Check the shared release before building",
  package: "Build and attach macOS bundle to the existing release", confirm: "Confirm the release is the same private draft",
  provenance: "Record final macOS build provenance",
  signPre: "Check the release before downloading", download: "Download final macOS release artifact", signStep: "Sign exact final macOS bytes",
  publish: "Publish immutable macOS manifest and signature", signed: "Confirm the release holds the signed set and is unchanged",
};

test("the workflow is manual only and its jobs keep their order: build then protected signing", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.jobs), ["build-macos", "sign-updates"]);
  assert.equal(sign.needs, "build-macos");
  assert.equal(sign.environment, "release-signing", "the owner's signing approval is kept");
  assert.equal(sign.if, undefined, "no status function lets signing run after a failed or skipped build");
});

test("every script runs under bash with pipefail (GitHub adds it for an explicit bash shell), so a failed listing cannot be hidden by the checker that reads it", () => {
  for (const job of Object.values(workflow.jobs)) assert.equal(job.defaults?.run?.shell, "bash");
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) assert.ok(step.shell === undefined || step.shell === "bash", step.name);
});

test("no step can run past a failure, and nothing in the workflow can publish, un-draft, overwrite or delete a release", () => {
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) {
    assert.equal(step["continue-on-error"], undefined, step.name);
    // The one exception is evidence retention, which only uploads a build artifact and cannot touch a release.
    if (step.name === "Retain dependency audit evidence") { assert.equal(step.uses, "actions/upload-artifact@v4"); continue; }
    assert.doesNotMatch(String(step.if ?? ""), /always\(\)|failure\(\)|cancelled\(\)/, `${step.name}: ${step.if}`);
  }
  assert.doesNotMatch(text, /releaseDraft:\s*false/);
  assert.doesNotMatch(text, /gh release (edit|create|delete)|--draft=false|--latest|--clobber|-X\s*(PATCH|POST|DELETE|PUT)|--method\s*(PATCH|POST|DELETE|PUT)/i);
  assert.doesNotMatch(text, /draft"?\s*[:=]\s*false/i);
});

test("tauri-action is pinned to the reviewed commit and given the existing release by id, as a draft, with the route's prerelease flag", () => {
  const step = stepNamed(build, S.package);
  assert.equal(step.uses, PINNED_ACTION);
  assert.equal(step.id, "package");
  // With releaseId the action uploads straight to that release: it neither looks a release up by tag (which cannot see drafts) nor creates one.
  assert.equal(step.with.releaseId, "${{ steps.release.outputs.release_id }}");
  assert.equal(step.with.releaseDraft, true, "never a published release, whatever the action does");
  assert.ok(!("releaseName" in step.with), "without a release name the action cannot create a release if the id were ever empty");
  assert.equal(step.with.prerelease, "${{ steps.release.outputs.prerelease }}");
  assert.equal(step.with.args, "--target universal-apple-darwin");
  assert.ok(!("releaseBody" in step.with));
});

test("the order inside the build job: tag, source, version, then the release check, all before anything is built or uploaded", () => {
  const at = Object.fromEntries(Object.entries(S).map(([key, name]) => [key, build.steps.findIndex(s => s.name === name)]));
  assert.equal(at.tag, 0, "the tag check is the first step");
  const checkout = build.steps.findIndex(s => s.uses === "actions/checkout@v4");
  assert.ok(at.tag < checkout && checkout < at.source && at.source < at.preflight);
  const firstBuild = build.steps.findIndex(s => /npm ci|cargo install|audit-dependencies/.test(s.run ?? ""));
  assert.ok(at.preflight < firstBuild, "a missing Windows draft fails before the long macOS build starts");
  assert.ok(at.preflight < at.package && at.package < at.confirm && at.confirm < at.provenance);
  assert.deepEqual(build.outputs, {
    "source-sha": "${{ steps.provenance.outputs.source_sha }}",
    "installer-digests": "${{ steps.provenance.outputs.digests }}",
    "release-id": "${{ steps.release.outputs.release_id }}",
    "release-state": "${{ steps.release.outputs.state }}",
    previous: "${{ steps.release.outputs.previous }}",
  });
});

test("the order inside the signing job: check, download, sign, check-then-upload without overwriting, check", () => {
  const order = [S.signPre, S.download, S.signStep, S.publish, S.signed].map(name => indexOfStep(sign, name));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const secrets = sign.steps.filter(s => /UPDATE_SIGNING_PRIVATE_KEY|UPDATE_SIGNING_PASSWORD/.test(JSON.stringify(s.env ?? {})));
  assert.deepEqual(secrets.map(s => s.name), [S.signStep], "only the signing step can see the private key");
  const publish = stepNamed(sign, S.publish).run;
  assert.match(publish, /gh release upload "\$RELEASE_TAG" --repo OneTrueAsian\/vault-spend/);
  assert.ok(publish.indexOf("assert-macos-release.mjs") < publish.indexOf("gh release upload"), "the upload only follows a passing check");
});

test("every release check reads the release list the same way and states what it expects", () => {
  for (const [job, name, stage] of [[build, S.preflight, "before"], [build, S.confirm, "packaged"], [sign, S.signPre, "packaged"], [sign, S.publish, "packaged"], [sign, S.signed, "signed"]]) {
    const run = stepNamed(job, name).run;
    assert.ok(run.includes(`'${LISTING_JQ}'`), name);
    assert.match(run, new RegExp(`node tools/assert-macos-release\\.mjs "\\$RELEASE_TAG" --stage ${stage}\\b`), name);
    if (stage !== "before") assert.match(run, /--release-id "\$RELEASE_ID" --state "\$RELEASE_STATE"/, name);
    else assert.match(run, /--source-sha "\$source_sha"/, name);
    assert.match(run, /--previous "\$(PREVIOUS|previous)"/, name);
  }
});

// ---- behavior: the real scripts, run against a stand-in gh ----
/** Runs a step's script the way GitHub does: bash with -e and pipefail, from a script file (quoting through a command line differs between hosts). */
function bashScript(script, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "macos-step-")), file = path.join(dir, "step.sh");
  try {
    fs.writeFileSync(file, script);
    return spawnSync(BASH, ["-eo", "pipefail", file.split(path.sep).join("/")], options);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function resolve(value, context) {
  return String(value).replace(/\$\{\{\s*([\w.\-]+)\s*\}\}/g, (_, dotted) => {
    const found = dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), context);
    assert.notEqual(found, undefined, `unresolved expression ${dotted}`);
    return String(found);
  });
}
function station({ listing = "", latest = "v1.3.2" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "macos-flow-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const gh = path.join(bin, "gh");
  fs.writeFileSync(gh, [
    "#!/usr/bin/env bash",
    'echo "$*" >> "$GH_LOG"',
    'case "$*" in',
    '  *releases/latest*) echo "$GH_LATEST" ;;',
    '  *--paginate*) cat "$GH_LISTING"; [[ -z "${GH_FAIL_LISTING:-}" ]] || exit 1 ;;',
    '  "release upload"*) ;;',
    '  *) echo "unexpected gh call: $*" >&2; exit 9 ;;',
    "esac", "",
  ].join("\n"), { mode: 0o755 });
  const files = { listing: path.join(dir, "listing.jsonl"), log: path.join(dir, "gh.log"), output: path.join(dir, "output.txt") };
  fs.writeFileSync(files.listing, listing);
  const self = {
    dir, files, latest,
    set(next) { fs.writeFileSync(files.listing, next); },
    calls: () => (fs.existsSync(files.log) ? fs.readFileSync(files.log, "utf8").trim().split("\n") : []),
    outputs: () => Object.fromEntries((fs.existsSync(files.output) ? fs.readFileSync(files.output, "utf8") : "").split("\n").filter(Boolean).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])),
    run(step, context, extra = {}) {
      const env = {};
      for (const [key, value] of Object.entries(step.env ?? {})) env[key] = resolve(value, { secrets: { GITHUB_TOKEN: "test-token" }, ...context });
      return bashScript(step.run, {
        cwd: ROOT, encoding: "utf8",
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_LOG: files.log, GH_LISTING: files.listing, GH_LATEST: self.latest, GITHUB_OUTPUT: files.output, ...env, ...extra },
      });
    },
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
  return self;
}
const lines = (...rows) => rows.join("\n") + "\n";
// The commit this checkout is at: the Windows draft is built from the tag commit, and tauri-action records it as the release's target.
const HEAD = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const release = (over = {}) => JSON.stringify({ id: 10, tag_name: "v1.3.3", draft: true, prerelease: false, target_commitish: HEAD, assets: windowsAssets("1.3.3"), ...over });
const published = (tag, id = 2, assets = ["Vault.Spend.exe"]) => JSON.stringify({ id, tag_name: tag, draft: false, prerelease: false, target_commitish: "main", assets });
const flow = tag => ({ inputs: { tag } });

test("an existing Windows draft is joined, kept private, and ends with the signed macOS set beside Windows' files", { skip }, () => {
  const st = station({ listing: lines(release(), published("v1.3.2")) });
  try {
    const first = st.run(stepNamed(build, S.preflight), flow("v1.3.3"));
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(st.outputs(), { release_id: "10", state: "draft", prerelease: "false", previous: "v1.3.2" });
    const facts = st.outputs();
    const ctx = { inputs: { tag: "v1.3.3" }, steps: { release: { outputs: facts } }, needs: { "build-macos": { outputs: { "release-id": facts.release_id, "release-state": facts.state, previous: facts.previous } } } };
    // tauri-action attaches the DMG
    st.set(lines(release({ assets: [...windowsAssets("1.3.3"), macosAssets("1.3.3")[0]] }), published("v1.3.2")));
    assert.equal(st.run(stepNamed(build, S.confirm), ctx).status, 0);
    assert.equal(st.run(stepNamed(sign, S.signPre), ctx).status, 0);
    // the signing job checks again, then uploads the manifest and signature (the only write in the whole flow)
    const upload = st.run(stepNamed(sign, S.publish), ctx, { RUNNER_TEMP: st.dir });
    assert.equal(upload.status, 0, upload.stderr);
    st.set(lines(release({ assets: [...windowsAssets("1.3.3"), ...macosAssets("1.3.3")] }), published("v1.3.2")));
    const done = st.run(stepNamed(sign, S.signed), ctx);
    assert.equal(done.status, 0, done.stderr);
    const writes = st.calls().filter(call => !/^api /.test(call));
    assert.equal(writes.length, 1, writes.join("; "));
    assert.ok(writes[0].startsWith("release upload v1.3.3 --repo OneTrueAsian/vault-spend "), writes[0]);
    assert.doesNotMatch(writes[0], /--clobber/);
  } finally { st.done(); }
});

test("with no release for the tag, macOS creates nothing and stops before building", { skip }, () => {
  const st = station({ listing: lines(published("v1.3.2")) });
  try {
    const result = st.run(stepNamed(build, S.preflight), flow("v1.3.3"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no release.*Windows draft/i);
    assert.equal(st.outputs().release_id, undefined, "no release id is handed to the packaging step");
    assert.ok(st.calls().every(call => /^api /.test(call)));
  } finally { st.done(); }
});

test("what tauri-action really uploads for macOS (the DMG and the unversioned app archive, as in v1.3.2) passes both later checks", { skip }, () => {
  const facts = { release_id: "10", state: "draft", prerelease: "false", previous: "v1.3.2" };
  const ctx = { inputs: { tag: "v1.3.3" }, steps: { release: { outputs: facts } }, needs: { "build-macos": { outputs: { "release-id": "10", "release-state": "draft", previous: "v1.3.2" } } } };
  const st = station({ listing: lines(release({ assets: [...windowsAssets("1.3.3"), macosAssets("1.3.3")[0], "Vault.Spend_universal.app.tar.gz"] }), published("v1.3.2")) });
  try {
    assert.equal(st.run(stepNamed(build, S.confirm), ctx).status, 0);
    st.set(lines(release({ assets: [...windowsAssets("1.3.3"), ...macosAssets("1.3.3"), "Vault.Spend_universal.app.tar.gz"] }), published("v1.3.2")));
    assert.equal(st.run(stepNamed(sign, S.signed), ctx).status, 0);
  } finally { st.done(); }
});

test("a listing that fails partway cannot pass: the check fails even when the part that arrived looks fine", { skip }, () => {
  const st = station({ listing: lines(release(), published("v1.3.2")) });
  try {
    const result = st.run(stepNamed(build, S.preflight), flow("v1.3.3"), { GH_FAIL_LISTING: "1" });
    assert.notEqual(result.status, 0, "the step fails, so no later step runs and the job (and signing) never proceed");
  } finally { st.done(); }
});

test("a Windows draft built from a different commit than this checkout is refused (the tag moved between the two builds)", { skip }, () => {
  const st = station({ listing: lines(release({ target_commitish: "c".repeat(40) }), published("v1.3.2")) });
  try {
    const result = st.run(stepNamed(build, S.preflight), flow("v1.3.3"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /commit/i);
  } finally { st.done(); }
});

test("an unfinished or unsigned Windows draft, a draft already holding macOS files, and a duplicate release are all refused", { skip }, () => {
  const refuse = (listing, pattern) => {
    const st = station({ listing });
    try {
      const result = st.run(stepNamed(build, S.preflight), flow("v1.3.3"));
      assert.notEqual(result.status, 0, listing);
      assert.match(result.stderr, pattern);
    } finally { st.done(); }
  };
  refuse(lines(release({ assets: [] }), published("v1.3.2")), /Windows/);
  refuse(lines(release({ assets: windowsAssets("1.3.3").filter(n => !n.endsWith(".signature.json")) }), published("v1.3.2")), /signature\.json/);
  refuse(lines(release({ assets: [...windowsAssets("1.3.3"), macosAssets("1.3.3")[0]] }), published("v1.3.2")), /already holds.*macOS/i);
  refuse(lines(release(), release({ id: 11 }), published("v1.3.2")), /more than one/);
  refuse(lines(release({ prerelease: true }), published("v1.3.2")), /prerelease/);
});

test("a race that makes the release public, creates a second one, or adds an unexpected file is caught after packaging", { skip }, () => {
  const ctx = { inputs: { tag: "v1.3.3" }, steps: { release: { outputs: { release_id: "10", state: "draft", prerelease: "false", previous: "v1.3.2" } } } };
  const withDmg = [...windowsAssets("1.3.3"), macosAssets("1.3.3")[0]];
  const attempt = listing => { const st = station({ listing }); try { return st.run(stepNamed(build, S.confirm), ctx); } finally { st.done(); } };
  assert.equal(attempt(lines(release({ assets: withDmg }), published("v1.3.2"))).status, 0);
  assert.notEqual(attempt(lines(release({ assets: withDmg, draft: false }), published("v1.3.2"))).status, 0, "published during the run");
  assert.notEqual(attempt(lines(release({ assets: withDmg }), release({ id: 12, draft: false, assets: [macosAssets("1.3.3")[0]] }), published("v1.3.2"))).status, 0, "a second public release");
  assert.notEqual(attempt(lines(release({ id: 12, assets: withDmg }), published("v1.3.2"))).status, 0, "a different release");
  assert.notEqual(attempt(lines(release({ assets: [...withDmg, "latest.json"] }), published("v1.3.2"))).status, 0, "an unexpected file");
  assert.notEqual(attempt(lines(release({ assets: windowsAssets("1.3.3") }), published("v1.3.2"))).status, 0, "the DMG never arrived");
  assert.notEqual(attempt(lines(release({ assets: withDmg }), published("v1.3.2"), published("v1.3.4", 20))).status, 0, "someone published a newer release");
});

test("the signing job refuses to add manifests to a release that became public or changed since the build", { skip }, () => {
  const ctx = { inputs: { tag: "v1.3.3" }, needs: { "build-macos": { outputs: { "release-id": "10", "release-state": "draft", previous: "v1.3.2" } } } };
  const withDmg = [...windowsAssets("1.3.3"), macosAssets("1.3.3")[0]];
  const attempt = (listing, name) => { const st = station({ listing }); try { const result = st.run(stepNamed(sign, name), ctx, { RUNNER_TEMP: st.dir }); return { status: result.status, uploads: st.calls().filter(c => c.startsWith("release upload")).length }; } finally { st.done(); } };
  for (const name of [S.signPre, S.publish]) {
    assert.equal(attempt(lines(release({ assets: withDmg }), published("v1.3.2")), name).status, 0, name);
    for (const refused of [lines(release({ assets: withDmg, draft: false }), published("v1.3.2")), lines(release({ id: 12, assets: withDmg }), published("v1.3.2")), lines(release({ assets: withDmg }), release({ id: 13, assets: [] }), published("v1.3.2"))]) {
      const result = attempt(refused, name);
      assert.notEqual(result.status, 0, name);
      assert.equal(result.uploads, 0, "a refused check uploads nothing");
    }
  }
  assert.notEqual(attempt(lines(release({ assets: withDmg }), published("v1.3.2")), S.signed).status, 0, "the manifest and signature must be there at the end");
});

test("a reserved test tag is joined only as a draft prerelease; it is never published or released by this route", { skip }, () => {
  const testAssets = windowsAssets("1.3.92");
  const draft = release({ tag_name: "v1.3.92", prerelease: true, assets: testAssets });
  const st = station({ listing: lines(draft, published("v1.3.2")) });
  try {
    const ok = st.run(stepNamed(build, S.preflight), flow("v1.3.92"));
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(st.outputs().prerelease, "true", "tauri-action is told prerelease for the test route");
  } finally { st.done(); }
  for (const listing of [lines(release({ tag_name: "v1.3.92", prerelease: false, assets: testAssets }), published("v1.3.2")), lines(release({ tag_name: "v1.3.92", draft: false, prerelease: true, assets: testAssets }), published("v1.3.2")), lines(published("v1.3.2"))]) {
    const other = station({ listing });
    try { assert.notEqual(other.run(stepNamed(build, S.preflight), flow("v1.3.92")).status, 0, listing); } finally { other.done(); }
  }
});

test("a published release is still joined as before (the existing rerun case), without creating or changing anything", { skip }, () => {
  const st = station({ listing: lines(published("v1.3.3", 10), published("v1.3.2")), latest: "v1.3.3" });
  try {
    const result = st.run(stepNamed(build, S.preflight), flow("v1.3.3"));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(st.outputs(), { release_id: "10", state: "published", prerelease: "false", previous: "v1.3.3" });
  } finally { st.done(); }
});

test("a published release that already holds a macOS file is refused: nothing public is ever replaced", { skip }, () => {
  for (const name of [macosAssets("1.3.3")[0], "Vault.Spend_universal.app.tar.gz"]) {
    const st = station({ listing: lines(published("v1.3.3", 10, ["Vault.Spend.exe", name]), published("v1.3.2")), latest: "v1.3.3" });
    try {
      const result = st.run(stepNamed(build, S.preflight), flow("v1.3.3"));
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, /already holds.*macOS/i);
    } finally { st.done(); }
  }
});

// ---- the tag, source and version checks, run for real in a throwaway repository ----
function sourceRepo({ version = "1.3.3", tagged = true, drift = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "macos-source-"));
  const git = (...args) => { const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git("init", "-q"); git("config", "user.email", "t@example.com"); git("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "src-tauri"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "vault-spend", version }));
  fs.writeFileSync(path.join(dir, "src-tauri/tauri.conf.json"), JSON.stringify({ version }));
  fs.writeFileSync(path.join(dir, "src-tauri/Cargo.toml"), `[package]\nname = "vaultspend"\nversion = "${version}"\n`);
  git("add", "-A"); git("commit", "-q", "-m", "release");
  if (tagged) git("tag", "v1.3.3");
  if (drift) { fs.writeFileSync(path.join(dir, "later.txt"), "x"); git("add", "-A"); git("commit", "-q", "-m", "later"); }
  return dir;
}
const runIn = (dir, step, tag) => bashScript(step.run, { cwd: dir, encoding: "utf8", env: { ...process.env, RELEASE_TAG: tag } });

test("the tag check accepts only exact stable tags and runs first, before anything is fetched", { skip }, () => {
  const step = stepNamed(build, S.tag);
  const run = tag => bashScript(step.run, { env: { ...process.env, RELEASE_TAG: tag }, encoding: "utf8" }).status;
  for (const tag of ["v1.3.3", "v1.3.92", "v0.0.1", "v10.20.30"]) assert.equal(run(tag), 0, tag);
  for (const tag of ["latest", "v1.3", "1.3.3", "v1.3.3-rc1", "v01.3.3", "v1.3.3 ", "", "refs/tags/v1.3.3"]) assert.notEqual(run(tag), 0, JSON.stringify(tag));
});

test("the source check: the checked-out commit is the tag's commit and every version file agrees with the tag", { skip }, () => {
  const step = stepNamed(build, S.source);
  const check = (options, tag = "v1.3.3") => { const dir = sourceRepo(options); try { return runIn(dir, step, tag); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };
  const happy = check({});
  assert.equal(happy.status, 0, happy.stderr);
  assert.notEqual(check({ drift: true }).status, 0, "HEAD moved past the tag");
  assert.notEqual(check({ tagged: false }).status, 0, "no such tag");
  assert.match(check({ version: "1.3.4" }).stderr, /version/i);
  const dir = sourceRepo();
  try {
    fs.writeFileSync(path.join(dir, "src-tauri/Cargo.toml"), `[package]\nname = "vaultspend"\nversion = "1.3.9"\n`);
    spawnSync("git", ["commit", "-qam", "cargo"], { cwd: dir }); spawnSync("git", ["tag", "-f", "v1.3.3"], { cwd: dir });
    assert.match(runIn(dir, step, "v1.3.3").stderr, /Rust package version/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
