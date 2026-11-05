// Evidence for the non-shard parts of the sharded Windows gate. The gate has four kinds of job (the desktop build, the Rust checks, the other checks and the
// shards). Acceptance needs BOTH facts for each: the real result of the job (read from the workflow's `needs` context) and the check records that job wrote.
// A record never overrides a job result, and a successful job without its records is refused. Every record is bound to the source commit, the workflow run id
// and the run attempt, and the set of records must be exactly the expected set: nothing missing, duplicated or extra.

export const GATE_JOBS = ["build", "checks-rust", "checks-other", "shard"];
const RECORD_SCHEMA = 1;
/** check name -> the job that owns it */
const OWNER = { "desktop-build": "build", "rust-tests": "checks-rust", "dependency-security": "checks-other", "contract-tests": "checks-other", "frontend-tests": "checks-other", lint: "checks-other" };
const HEX40 = /^[0-9a-f]{40}$/;

export function requiredChecks({ contracts }) {
  return Object.keys(OWNER).filter(check => contracts || check !== "contract-tests");
}
export const checkOwner = check => OWNER[check];

export function makeCheckRecord({ check, job, sourceSha, runId, runAttempt }) {
  return { schema: RECORD_SCHEMA, check, job, result: "passed", sourceSha, runId: String(runId), runAttempt: Number(runAttempt) };
}

/**
 * records: [{ file, record }] where record is the parsed JSON (undefined when unreadable). jobs: the workflow `needs` object ({ id: { result } }).
 * Returns { problems, checks, jobs }; an empty problem list means every required job succeeded and every required check has its one valid record.
 */
export function evaluateGateEvidence({ records, jobs, contracts, sourceSha, runId, runAttempt, preparedSourceSha }) {
  const problems = [];
  if (!HEX40.test(sourceSha ?? "")) problems.push("No valid source commit to bind the check records to.");
  if (!String(runId ?? "").trim()) problems.push("No workflow run id to bind the check records to.");
  if (!Number.isInteger(runAttempt) || runAttempt < 1) problems.push("No valid run attempt to bind the check records to.");
  if (preparedSourceSha !== undefined && preparedSourceSha !== sourceSha) problems.push(`The prepared build is for source ${preparedSourceSha}, but the gate checks ${sourceSha}.`);

  const resultsOfJobs = {};
  const supplied = jobs && typeof jobs === "object" ? jobs : {};
  for (const id of GATE_JOBS) {
    const result = supplied[id]?.result;
    resultsOfJobs[id] = result ?? "missing";
    if (result !== "success") problems.push(`Required job ${id} did not succeed (result: ${result ?? "missing"}).`);
  }
  for (const id of Object.keys(supplied)) if (!GATE_JOBS.includes(id)) problems.push(`Unexpected job ${id} in the gate results.`);

  const expected = requiredChecks({ contracts }), seen = new Map(), checks = [];
  for (const { file, record } of records ?? []) {
    if (!record || typeof record !== "object" || Array.isArray(record)) { problems.push(`Check record ${file} is unreadable.`); continue; }
    const name = record.check;
    if (!expected.includes(name)) { problems.push(`Check record ${file} names ${JSON.stringify(name)}, which is not expected.`); continue; }
    if (!seen.has(name)) seen.set(name, []);
    seen.get(name).push(record);
  }
  for (const check of expected) {
    const found = seen.get(check) ?? [];
    if (found.length === 0) { problems.push(`Check record for ${check} is missing.`); continue; }
    if (found.length > 1) { problems.push(`Check ${check} has ${found.length} records; exactly one is allowed.`); continue; }
    const r = found[0];
    if (r.schema !== RECORD_SCHEMA) problems.push(`Check ${check}: record has schema ${r.schema}, expected ${RECORD_SCHEMA}.`);
    if (r.result !== "passed") problems.push(`Check ${check}: result is ${JSON.stringify(r.result)}, not passed.`);
    if (r.job !== OWNER[check]) problems.push(`Check ${check}: written by job ${r.job}, but ${OWNER[check]} owns it.`);
    if (r.sourceSha !== sourceSha) problems.push(`Check ${check}: record is for source ${r.sourceSha}, not ${sourceSha}.`);
    if (String(r.runId) !== String(runId)) problems.push(`Check ${check}: record is for run id ${r.runId}, not ${runId}.`);
    if (r.runAttempt !== runAttempt) problems.push(`Check ${check}: record is for attempt ${r.runAttempt}, not ${runAttempt}.`);
    checks.push({ schema: r.schema, check, job: r.job, result: r.result, sourceSha: r.sourceSha, runId: String(r.runId), runAttempt: r.runAttempt });
  }
  return { problems, checks, jobs: resultsOfJobs };
}
