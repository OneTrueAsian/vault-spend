// The aggregate command, run for real: shard evidence, check records and the real job results are all joined into the one verdict and one summary file.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { shardSpecs } from "../e2e/lib/specShard.mjs";
import { GATE_JOBS, makeCheckRecord, requiredChecks, checkOwner } from "../e2e/lib/gateChecks.mjs";

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const specs = execFileSync(process.execPath, ["e2e/run-all.mjs", "--list"], { encoding: "utf8" }).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const weights = JSON.parse(fs.readFileSync(new URL("../e2e/spec-weights.json", import.meta.url), "utf8")).weights;
const RUN = "4242", prepared = { sourceSha: head, buildKey: "k".repeat(64), exeSha256: "E".repeat(64), toolchain: {} };
const json = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

/** Builds a complete, clean set of inputs; `change` may damage them before the command runs. */
function fixture(change = () => {}, { contracts = true, attempt = 1 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aggregate-"));
  const state = {
    shards: [1, 2, 3, 4, 5, 6].map(index => {
      const names = shardSpecs(specs, weights, { index, total: 6 });
      return { index, meta: { index, total: 6, runAttempt: attempt, outcome: "success" },
        record: { sourceValid: true, valid: true, concurrency: 1, elapsedSeconds: 5, identity: { artifactStatus: "fresh", exeSha256: prepared.exeSha256, buildKey: prepared.buildKey, testKey: "t" }, selected: names, executed: names.map(name => ({ name, code: 0 })) } };
    }),
    records: requiredChecks({ contracts }).map(check => makeCheckRecord({ check, job: checkOwner(check), sourceSha: head, runId: RUN, runAttempt: attempt })),
    needs: Object.fromEntries(GATE_JOBS.map(j => [j, { result: "success" }])),
    manifest: prepared, env: {},
  };
  change(state);
  state.shards.forEach(s => { json(path.join(dir, "evidence", `shard-evidence-${s.index}`, "shard-meta.json"), s.meta); if (s.record) json(path.join(dir, "evidence", `shard-evidence-${s.index}`, "e2e-last-run.json"), s.record); });
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  state.records.forEach((r, i) => json(path.join(dir, "checks", `check-records-${r.job ?? "x"}-attempt-${attempt}`, `${r.check ?? "unnamed"}-${i}.json`), r));
  fs.mkdirSync(path.join(dir, "checks"), { recursive: true });
  json(path.join(dir, "manifest.json"), state.manifest);
  const out = path.join(dir, "summary.json");
  const args = ["tools/aggregate-shard-results.mjs", path.join(dir, "evidence"), path.join(dir, "manifest.json"), "6", String(attempt), out, "--checks", path.join(dir, "checks"), "--contracts", contracts ? "yes" : "no"];
  const result = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, GITHUB_RUN_ID: RUN, NEEDS_JSON: JSON.stringify(state.needs), ...state.env } });
  const summary = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : undefined;
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, text: result.stdout + result.stderr, summary };
}
const refuses = (change, pattern, options) => { const r = fixture(change, options); assert.notEqual(r.status, 0, "must fail"); assert.match(r.text, pattern); assert.equal(r.summary?.ok, false); return r; };

test("a clean gate passes and records the run id, every check record and every job result in the summary", () => {
  const r = fixture();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.summary.ok, true);
  assert.equal(r.summary.runId, RUN);
  assert.equal(r.summary.contracts, true);
  assert.deepEqual(r.summary.checks.map(c => c.check).sort(), requiredChecks({ contracts: true }).sort());
  assert.deepEqual(r.summary.jobs, { build: "success", "checks-rust": "success", "checks-other": "success", shard: "success" });
  assert.equal(r.summary.prepared.sourceSha, head);
});

test("without contract tests requested the contract record is not required", () => {
  assert.equal(fixture(() => {}, { contracts: false }).status, 0);
});

test("every required check missing, duplicated, extra, wrong run, wrong attempt or wrong source fails the gate", () => {
  for (const check of requiredChecks({ contracts: true })) refuses(s => { s.records = s.records.filter(r => r.check !== check); }, new RegExp(`${check}.*missing`));
  refuses(s => { s.records.push({ ...s.records[0] }); }, /2 records/);
  refuses(s => { s.records.push({ ...s.records[0], check: "benchmark" }); }, /benchmark.*not expected/);
  refuses(s => { s.records[0].runId = "1"; }, /run id/);
  refuses(s => { s.records[1].runAttempt = 2; }, /attempt/);
  refuses(s => { s.records[2].sourceSha = "d".repeat(40); }, /source/);
  refuses(s => { s.records[3].result = "failed"; }, /not passed/);
});

test("every required job that failed, was cancelled or skipped fails the gate, whatever its records say", () => {
  for (const job of GATE_JOBS) for (const result of ["failure", "cancelled", "skipped"]) refuses(s => { s.needs[job].result = result; }, new RegExp(`job ${job}`));
  refuses(s => { delete s.needs["checks-rust"]; }, /job checks-rust/);
  refuses(s => { s.needs.extra = { result: "success" }; }, /extra/);
});

test("the results of a different workflow run, or no job results at all, fail the gate", () => {
  refuses(s => { s.env.GITHUB_RUN_ID = "999"; }, /run id/);
  refuses(s => { s.env.GITHUB_RUN_ID = ""; }, /run id/);
  refuses(s => { s.env.NEEDS_JSON = "{not json"; }, /job/);
});

test("a build for another source commit fails the gate", () => {
  refuses(s => { s.manifest = { ...prepared, sourceSha: "e".repeat(40) }; }, /prepared build/);
});

test("a rerun of only some jobs (shards from another attempt) still fails", () => {
  refuses(s => { s.shards[2].meta.runAttempt = 2; }, /attempt/);
});

test("the shard checks still apply: a failed spec, and retries beyond the gate-wide budget, fail the gate", () => {
  refuses(s => { s.shards[0].record.executed[0].code = 1; }, /failed/);
  refuses(s => {
    for (const shard of s.shards.slice(0, 4)) { const e = shard.record.executed[0]; e.attempts = [{ ...e, code: 1 }, { ...e, code: 0 }]; }
  }, /budget of 3/);
});
