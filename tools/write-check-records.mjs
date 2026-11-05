// Hosted sharded gate: the LAST step of a check job writes one record per check the job ran. The step has no status function, so it only runs when every earlier
// step of the job passed; a failed or cancelled job therefore leaves no record. The aggregate separately reads the job's real result.
// Usage: GITHUB_RUN_ID=<id> GITHUB_RUN_ATTEMPT=<n> GITHUB_JOB=<job> node tools/write-check-records.mjs <outDir> <check>...
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkOwner, makeCheckRecord } from "../e2e/lib/gateChecks.mjs";

const [outDir, ...checks] = process.argv.slice(2);
const runId = process.env.GITHUB_RUN_ID ?? "", runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT), job = process.env.GITHUB_JOB ?? "";
const fail = message => { console.error(message); process.exit(1); };
if (!outDir || checks.length === 0) fail("Usage: node tools/write-check-records.mjs <outDir> <check>...");
if (!runId.trim() || !Number.isInteger(runAttempt) || runAttempt < 1 || !job) fail("GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT and GITHUB_JOB are required.");
for (const check of checks) {
  if (!checkOwner(check)) fail(`Unknown check ${check}.`);
  if (checkOwner(check) !== job) fail(`Check ${check} belongs to job ${checkOwner(check)}, not ${job}.`);
}
if (new Set(checks).size !== checks.length) fail("A check was named twice.");
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
fs.mkdirSync(outDir, { recursive: true });
for (const check of checks) {
  fs.writeFileSync(path.join(outDir, `${check}.json`), JSON.stringify(makeCheckRecord({ check, job, sourceSha, runId, runAttempt }), null, 2) + "\n");
  console.log(`Recorded ${check}: passed, source ${sourceSha}, run ${runId}, attempt ${runAttempt}.`);
}
