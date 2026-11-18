// Draft test-release path: the packaging job runs this before any installer is built. A green job status is not enough evidence; the
// aggregate's own summary must show every discovered spec ran once and passed, in all six shards, against this source and attempt.
// It also requires the exact set of check records and the real job results the aggregate recorded, bound to this run id, attempt and source.
// Usage: SOURCE_SHA=<commit> GITHUB_RUN_ID=<id> node tools/verify-sharded-gate-summary.mjs <gate-summary.json> <runAttempt> --contracts yes|no
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_RETRY_BUDGET } from "../e2e/lib/shardAggregate.mjs";
import { evaluateGateEvidence } from "../e2e/lib/gateChecks.mjs";

const HEX40 = /^[0-9a-f]{40}$/, HEX64 = /^[0-9a-fA-F]{64}$/;

/** Returns the reasons to refuse; an empty list means the evidence is complete and clean. */
export function verifyGateSummary(summary, { sourceSha, runAttempt, runId, contracts, specCount, total }) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return ["The gate summary is missing or unreadable."];
  const problems = [], t = summary.totals ?? {};
  if (summary.ok !== true) problems.push("The gate verdict is not ok.");
  if (!Array.isArray(summary.problems) || summary.problems.length) problems.push("The gate summary lists problems.");
  if (!Array.isArray(summary.failures) || summary.failures.length) problems.push("The gate summary lists failures.");
  if (t.failed !== 0) problems.push(`The gate summary counts ${t.failed} failed specs.`);
  if (t.expected !== specCount) problems.push(`The summary discovered ${t.expected} specs, but this checkout has ${specCount}.`);
  if (t.ran !== specCount) problems.push(`Only ${t.ran} of ${specCount} specs ran as primary runs.`);
  if (t.passed !== specCount) problems.push(`Only ${t.passed} of ${specCount} specs passed.`);
  const shards = Array.isArray(summary.shards) ? summary.shards : [];
  if (shards.map(s => s.shard).sort((a, b) => a - b).join() !== Array.from({ length: total }, (_, i) => i + 1).join()) problems.push(`The summary does not hold exactly shards 1 to ${total}.`);
  else {
    shards.forEach(s => { if (s.failed !== 0 || s.passed !== s.specs || !(s.specs > 0)) problems.push(`Shard ${s.shard} did not pass all of its specs.`); });
    if (shards.reduce((n, s) => n + s.specs, 0) !== specCount) problems.push("The shard specs do not add up to the discovered specs.");
  }
  const retries = Array.isArray(summary.retries) ? summary.retries : [];
  if (retries.length > GATE_RETRY_BUDGET) problems.push(`${retries.length} retries exceed the gate-wide budget of ${GATE_RETRY_BUDGET}.`);
  if (retries.some(r => r.passedOnRetry !== true)) problems.push("A retried spec did not pass on its retry.");
  if (summary.runAttempt !== runAttempt) problems.push(`The summary is from attempt ${summary.runAttempt}, this is attempt ${runAttempt}.`);
  const prepared = summary.prepared ?? {};
  if (!HEX40.test(sourceSha ?? "") || prepared.sourceSha !== sourceSha) problems.push("The gate tested a different source commit than the one being packaged.");
  if (typeof prepared.buildKey !== "string" || !prepared.buildKey) problems.push("The summary records no build key.");
  if (!HEX64.test(prepared.exeSha256 ?? "")) problems.push("The summary records no valid executable SHA-256.");
  if (String(summary.runId ?? "") !== String(runId ?? "") || !String(runId ?? "").trim()) problems.push(`The summary is from run id ${summary.runId}, this is run id ${runId}.`);
  // The records and job results are re-checked here, not trusted from the aggregate's own verdict.
  const records = Array.isArray(summary.checks) ? summary.checks.map((record, i) => ({ file: `summary check ${i + 1}`, record })) : [];
  if (!Array.isArray(summary.checks)) problems.push("The summary holds no check records.");
  if (!summary.jobs || typeof summary.jobs !== "object" || Array.isArray(summary.jobs)) problems.push("The summary holds no job results.");
  const jobs = Object.fromEntries(Object.entries(summary.jobs && typeof summary.jobs === "object" && !Array.isArray(summary.jobs) ? summary.jobs : {}).map(([id, result]) => [id, { result }]));
  problems.push(...evaluateGateEvidence({ records, jobs, contracts, sourceSha, runId, runAttempt, preparedSourceSha: prepared.sourceSha }).problems);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, attemptText, flag, contractsText] = process.argv.slice(2);
  const runAttempt = Number(attemptText), sourceSha = process.env.SOURCE_SHA ?? "", runId = process.env.GITHUB_RUN_ID ?? "";
  if (flag !== "--contracts" || !["yes", "no"].includes(contractsText)) { console.error("Usage: node tools/verify-sharded-gate-summary.mjs <gate-summary.json> <runAttempt> --contracts yes|no"); process.exit(2); }
  let summary;
  try { summary = JSON.parse(fs.readFileSync(file, "utf8")); } catch { summary = undefined; }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const specCount = execFileSync(process.execPath, ["e2e/run-all.mjs", "--list"], { encoding: "utf8" }).split(/\r?\n/).filter(s => s.trim()).length;
  const problems = verifyGateSummary(summary, { sourceSha, runAttempt, runId, contracts: contractsText === "yes", specCount, total: 6 });
  if (head !== sourceSha) problems.push("The checked-out commit differs from the commit being packaged.");
  if (!Number.isInteger(runAttempt) || runAttempt < 1) problems.push("A run attempt number is required.");
  if (problems.length) { for (const p of problems) console.error(`Refusing to package: ${p}`); process.exit(1); }
  console.log(`Gate evidence accepted: ${specCount} specs ran once and passed in 6 shards, ${summary.retries.length} retried, ${summary.checks.length} check records and ${Object.keys(summary.jobs).length} job results, source ${sourceSha}, run ${runId}, attempt ${runAttempt}.`);
}
