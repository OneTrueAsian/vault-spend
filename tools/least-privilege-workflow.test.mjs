// Guards for VS-41: every workflow runs with a read-only token by default, only the jobs that publish to a release hold contents: write,
// no checkout leaves a token in .git/config, the macOS check can no longer sign or run on push, and Ubuntu steps that pipe use bash (pipefail).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";

const DIR = new URL("../.github/workflows/", import.meta.url);
const names = fs.readdirSync(DIR).filter(n => n.endsWith(".yml"));
const workflows = Object.fromEntries(names.map(n => [n, yaml.load(fs.readFileSync(new URL(n, DIR), "utf8"))]));

// The only jobs allowed to hold contents: write: they run gh release upload or tauri-action against the release.
const WRITERS = {
  "release-windows.yml": ["release", "sharded-package", "sharded-sign-updates", "sign-updates"],
  "build-macos.yml": ["build-macos", "sign-updates"],
};
// Checkouts allowed to keep the token. None: no job pushes or fetches with the persisted credential.
const KEEP_CREDENTIALS = [];

test("the old 1.3.1 signing workflow and its macOS check entry points are gone", () => {
  assert.equal(names.includes("prepare-signed-installers.yml"), false);
  const check = workflows["build-macos-check.yml"], text = fs.readFileSync(new URL("build-macos-check.yml", DIR), "utf8");
  assert.equal(check.on.push, undefined, "no push trigger");
  assert.deepEqual(Object.keys(check.on.workflow_dispatch?.inputs ?? {}), []);
  assert.doesNotMatch(text, /release-signing|prepare_signed|sign_prepared_run|prepare-signed-installers/);
  assert.deepEqual(Object.keys(check.jobs), ["macos-check"]);
});

test("every workflow defaults to a read-only token", () => {
  for (const [name, wf] of Object.entries(workflows)) assert.equal(wf.permissions?.contents, "read", name);
});

test("only the allow-listed publishing jobs hold contents: write", () => {
  for (const [name, wf] of Object.entries(workflows)) {
    const writers = Object.entries(wf.jobs).filter(([, job]) => job.permissions?.contents === "write").map(([id]) => id).sort();
    assert.deepEqual(writers, [...(WRITERS[name] ?? [])].sort(), name);
  }
});

test("every job that publishes states its permissions itself", () => {
  for (const [name, ids] of Object.entries(WRITERS)) for (const id of ids) assert.ok(workflows[name].jobs[id].permissions, `${name} ${id}`);
});

test("every checkout drops the persisted token", () => {
  for (const [name, wf] of Object.entries(workflows)) for (const [id, job] of Object.entries(wf.jobs)) for (const step of job.steps ?? []) {
    if (!String(step.uses ?? "").startsWith("actions/checkout@")) continue;
    if (KEEP_CREDENTIALS.includes(`${name}:${id}`)) continue;
    assert.equal(step.with?.["persist-credentials"], false, `${name} ${id}`);
  }
});

test("Ubuntu steps that pipe run under an explicit bash shell", () => {
  const pipes = run => /\s\|\s/.test(String(run));
  for (const [name, wf] of Object.entries(workflows)) for (const [id, job] of Object.entries(wf.jobs)) {
    if (!String(job["runs-on"] ?? "").startsWith("ubuntu")) continue;
    for (const step of job.steps ?? []) {
      if (!step.run || !pipes(step.run)) continue;
      assert.equal(step.shell ?? job.defaults?.run?.shell ?? wf.defaults?.run?.shell, "bash", `${name} ${id} ${step.name ?? step.run.slice(0, 40)}`);
    }
  }
});
