import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const run = (args, env = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-records-"));
  try {
    const result = spawnSync(process.execPath, ["tools/write-check-records.mjs", path.join(dir, "out"), ...args], { encoding: "utf8", env: { ...process.env, GITHUB_RUN_ID: "88", GITHUB_RUN_ATTEMPT: "2", GITHUB_JOB: "checks-other", ...env } });
    const out = path.join(dir, "out");
    const files = fs.existsSync(out) ? fs.readdirSync(out).sort() : [];
    const contents = Object.fromEntries(files.map(name => [name, JSON.parse(fs.readFileSync(path.join(out, name), "utf8"))]));
    return { status: result.status, text: result.stdout + result.stderr, files, read: name => contents[name] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test("writes one record per check, bound to this checkout's commit, run id, attempt and job", () => {
  const r = run(["lint", "frontend-tests"]);
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(r.files, ["frontend-tests.json", "lint.json"]);
  assert.deepEqual(r.read("lint.json"), { schema: 1, check: "lint", job: "checks-other", result: "passed", sourceSha: head, runId: "88", runAttempt: 2 });
});

test("refuses an unknown check, a check the running job does not own, a missing run id or attempt, and no checks at all", () => {
  assert.notEqual(run(["benchmark"]).status, 0);
  assert.notEqual(run(["rust-tests"]).status, 0, "checks-other does not own rust-tests");
  assert.notEqual(run(["lint"], { GITHUB_RUN_ID: "" }).status, 0);
  assert.notEqual(run(["lint"], { GITHUB_RUN_ATTEMPT: "0" }).status, 0);
  assert.notEqual(run(["lint"], { GITHUB_JOB: "" }).status, 0);
  assert.notEqual(run([]).status, 0);
  assert.deepEqual(run(["rust-tests"]).files, [], "nothing is written for a refused request");
});
