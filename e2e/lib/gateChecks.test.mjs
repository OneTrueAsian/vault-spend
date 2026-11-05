import { describe, expect, it } from "vitest";
import { GATE_JOBS, makeCheckRecord, requiredChecks, evaluateGateEvidence } from "./gateChecks.mjs";

const SHA = "a".repeat(40), RUN = "12345", ATTEMPT = 1;
const JOB_OF = { "desktop-build": "build", "rust-tests": "checks-rust", "frontend-tests": "checks-other", lint: "checks-other", "dependency-security": "checks-other", "contract-tests": "checks-other" };
const rec = (check, over = {}) => ({ file: `${check}.json`, record: { ...makeCheckRecord({ check, job: JOB_OF[check], sourceSha: SHA, runId: RUN, runAttempt: ATTEMPT }), ...over } });
const allRecords = (contracts = true) => requiredChecks({ contracts }).map(c => rec(c));
const goodJobs = () => Object.fromEntries(GATE_JOBS.map(j => [j, { result: "success" }]));
const evaluate = (over = {}) => evaluateGateEvidence({ records: allRecords(), jobs: goodJobs(), contracts: true, sourceSha: SHA, runId: RUN, runAttempt: ATTEMPT, ...over });
const problemsOf = over => evaluate(over).problems.join("\n");

describe("required checks", () => {
  it("lists the build, Rust, frontend, lint and dependency checks, plus the contract tests only when requested", () => {
    expect(requiredChecks({ contracts: true }).sort()).toEqual(["contract-tests", "dependency-security", "desktop-build", "frontend-tests", "lint", "rust-tests"]);
    expect(requiredChecks({ contracts: false }).sort()).toEqual(["dependency-security", "desktop-build", "frontend-tests", "lint", "rust-tests"]);
  });
  it("the gate has exactly four real jobs whose results are verified", () => { expect([...GATE_JOBS].sort()).toEqual(["build", "checks-other", "checks-rust", "shard"]); });
});

describe("check records and job results", () => {
  it("accepts exactly the expected records, bound to this source, run id and attempt, with every job successful", () => {
    const r = evaluate();
    expect(r.problems).toEqual([]);
    expect(r.checks.map(c => c.check).sort()).toEqual(requiredChecks({ contracts: true }).sort());
    expect(r.jobs).toEqual({ build: "success", "checks-rust": "success", "checks-other": "success", shard: "success" });
  });
  it("accepts the smaller set when contract tests were not requested, and refuses a contract record that was not expected", () => {
    expect(evaluate({ contracts: false, records: allRecords(false) }).problems).toEqual([]);
    expect(problemsOf({ contracts: false, records: allRecords(true) })).toMatch(/contract-tests.*not expected/);
  });
  it("refuses a missing record for every required check", () => {
    for (const check of requiredChecks({ contracts: true })) expect(problemsOf({ records: allRecords().filter(r => r.record.check !== check) })).toMatch(new RegExp(`${check}.*missing`));
  });
  it("refuses a duplicate record, an extra record and an unreadable record", () => {
    expect(problemsOf({ records: [...allRecords(), rec("lint")] })).toMatch(/lint.*2 records/);
    expect(problemsOf({ records: [...allRecords(), rec("lint", { check: "benchmark" })] })).toMatch(/benchmark.*not expected/);
    expect(problemsOf({ records: [...allRecords(), { file: "junk.json", record: undefined }] })).toMatch(/junk\.json.*unreadable/);
  });
  it("refuses a record from another source commit, run id or run attempt", () => {
    for (const [field, value, pattern] of [["sourceSha", "b".repeat(40), /source/], ["runId", "999", /run id/], ["runAttempt", 2, /attempt/]]) {
      const records = allRecords().map(r => r.record.check === "rust-tests" ? rec("rust-tests", { [field]: value }) : r);
      expect(problemsOf({ records })).toMatch(pattern);
    }
  });
  it("refuses a record written by another job than the one that owns the check", () => {
    expect(problemsOf({ records: allRecords().map(r => r.record.check === "lint" ? rec("lint", { job: "checks-rust" }) : r) })).toMatch(/lint.*job/);
  });
  it("refuses any result other than passed, and a record with an unknown schema", () => {
    for (const result of ["failed", "skipped", "", undefined]) expect(problemsOf({ records: allRecords().map(r => r.record.check === "lint" ? rec("lint", { result }) : r) })).toMatch(/lint.*not passed/);
    expect(problemsOf({ records: allRecords().map(r => r.record.check === "lint" ? rec("lint", { schema: 2 }) : r) })).toMatch(/lint.*schema/);
  });
  it("refuses a record that is not bound to the prepared build's source commit", () => {
    expect(problemsOf({ preparedSourceSha: "c".repeat(40) })).toMatch(/prepared build/);
  });
  it("a record that says passed cannot override a failed, cancelled, skipped or missing job", () => {
    for (const job of GATE_JOBS) for (const result of ["failure", "cancelled", "skipped", undefined]) {
      const jobs = goodJobs(); if (result === undefined) delete jobs[job]; else jobs[job] = { result };
      expect(problemsOf({ jobs })).toMatch(new RegExp(`job ${job}`));
    }
  });
  it("a successful job whose records are missing is a problem, naming the job", () => {
    const text = problemsOf({ records: allRecords().filter(r => r.record.job !== "checks-other") });
    expect(text).toMatch(/lint.*missing/); expect(text).toMatch(/frontend-tests.*missing/);
  });
  it("refuses an unexpected extra job in the results", () => {
    expect(problemsOf({ jobs: { ...goodJobs(), extra: { result: "success" } } })).toMatch(/extra/);
  });
  it("requires a run id, attempt and source to bind to", () => {
    expect(problemsOf({ runId: "" })).toMatch(/run id/);
    expect(problemsOf({ runAttempt: 0 })).toMatch(/attempt/);
    expect(problemsOf({ sourceSha: "nope" })).toMatch(/source/);
  });
});
