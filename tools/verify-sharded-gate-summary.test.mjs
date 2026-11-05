import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { verifyGateSummary } from "./verify-sharded-gate-summary.mjs";

const SHA = "a".repeat(40), SPECS = 12;
const good = () => ({
  ok: true, problems: [], runAttempt: 1,
  totals: { expected: SPECS, ran: SPECS, passed: SPECS, failed: 0, retried: 1, passedOnRetry: 1 },
  failures: [], retries: [{ shard: 2, name: "feature9.mjs", firstExit: 1, finalExit: 0, passedOnRetry: true }],
  shards: [1, 2, 3, 4, 5, 6].map(shard => ({ shard, specs: 2, passed: 2, failed: 0, seconds: 10 })),
  prepared: { sourceSha: SHA, buildKey: "b".repeat(64), exeSha256: "c".repeat(64), toolchain: {} },
});
const expected = { sourceSha: SHA, runAttempt: 1, specCount: SPECS, total: 6 };
const refuses = (change, pattern) => {
  const summary = good(); change(summary);
  const problems = verifyGateSummary(summary, expected);
  assert.ok(problems.length > 0, "must refuse");
  if (pattern) assert.match(problems.join("\n"), pattern);
};

test("the executable hash is accepted in the upper case the hosted build records it in", () => {
  const s = good(); s.prepared.exeSha256 = "4DB625EB3782DBE28237500F2428DC3B5B09380F958769FB3FBBD3055583432A";
  assert.deepEqual(verifyGateSummary(s, expected), []);
});

test("a complete, clean sharded verdict for exactly this source and attempt is accepted", () => {
  assert.deepEqual(verifyGateSummary(good(), expected), []);
});

test("missing, unreadable or non-object evidence is refused", () => {
  for (const bad of [undefined, null, "ok", 7, []]) assert.ok(verifyGateSummary(bad, expected).length > 0);
});

test("a verdict that is not ok, or that lists problems, failures or a failed count, is refused", () => {
  refuses(s => { s.ok = false; }, /not ok/);
  refuses(s => { s.ok = "true"; }, /not ok/);
  refuses(s => { s.problems = ["Shard 3/6: no run record"]; }, /problems/);
  refuses(s => { s.failures = [{ shard: 1, name: "feature1.mjs", code: 1, attempts: 2 }]; }, /failure/);
  refuses(s => { s.totals.failed = 1; }, /failed/);
});

test("every discovered spec must have run once and passed", () => {
  refuses(s => { s.totals.ran = SPECS - 1; }, /ran/);
  refuses(s => { s.totals.passed = SPECS - 1; }, /passed/);
  refuses(s => { s.totals.expected = SPECS + 1; }, /discovered/);
  refuses(s => { s.shards[0].specs = 3; }, /shard specs/);
  refuses(s => { s.shards[0].failed = 1; }, /Shard 1/);
});

test("all six shards must be present, once each", () => {
  refuses(s => { s.shards.pop(); }, /shards/);
  refuses(s => { s.shards[5].shard = 5; }, /shards/);
  refuses(s => { s.shards = []; }, /shards/);
});

test("retries stay inside the gate-wide budget and must all have passed", () => {
  refuses(s => { s.retries = [1, 2, 3, 4].map(n => ({ shard: n, name: `f${n}.mjs`, passedOnRetry: true })); s.totals.retried = 4; }, /budget/);
  refuses(s => { s.retries[0].passedOnRetry = false; }, /retry/);
});

test("evidence from another attempt or another source commit is refused", () => {
  refuses(s => { s.runAttempt = 2; }, /attempt/);
  refuses(s => { s.prepared.sourceSha = "d".repeat(40); }, /source/);
  refuses(s => { delete s.prepared; }, /source|prepared/);
  refuses(s => { s.prepared.buildKey = ""; }, /build key/);
  refuses(s => { s.prepared.exeSha256 = "xyz"; }, /executable/);
});

test("the command line reads the summary file and checks the checked-out commit and spec list", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-summary-"));
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const specs = execFileSync(process.execPath, ["e2e/run-all.mjs", "--list"], { encoding: "utf8" }).split(/\r?\n/).filter(s => s.trim()).length;
    const summary = good();
    summary.prepared.sourceSha = head;
    summary.totals = { expected: specs, ran: specs, passed: specs, failed: 0, retried: 0, passedOnRetry: 0 };
    summary.retries = [];
    summary.shards = [1, 2, 3, 4, 5, 6].map(shard => ({ shard, specs: shard === 1 ? specs - 5 : 1, passed: shard === 1 ? specs - 5 : 1, failed: 0, seconds: 1 }));
    const file = path.join(dir, "gate-summary.json");
    fs.writeFileSync(file, JSON.stringify(summary));
    const run = (args, env = {}) => spawnSync(process.execPath, ["tools/verify-sharded-gate-summary.mjs", ...args], { encoding: "utf8", env: { ...process.env, SOURCE_SHA: head, ...env } });
    assert.equal(run([file, "1"]).status, 0);
    assert.notEqual(run([path.join(dir, "missing.json"), "1"]).status, 0, "missing evidence");
    fs.writeFileSync(path.join(dir, "bad.json"), "{not json");
    assert.notEqual(run([path.join(dir, "bad.json"), "1"]).status, 0, "unreadable evidence");
    assert.notEqual(run([file, "2"]).status, 0, "wrong attempt");
    assert.notEqual(run([file, "1"], { SOURCE_SHA: "e".repeat(40) }).status, 0, "source differs from the checkout");
    assert.notEqual(run([file, "1"], { SOURCE_SHA: "" }).status, 0, "no source commit given");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
