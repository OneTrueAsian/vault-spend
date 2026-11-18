// Hosted sharded gate: joins the shards' run records, the check records and the real job results into one verdict (see e2e/lib/shardAggregate.mjs and gateChecks.mjs).
// Usage: GITHUB_RUN_ID=<id> NEEDS_JSON='<toJSON(needs)>' node tools/aggregate-shard-results.mjs <evidenceDir> <transferManifest.json> <total> <runAttempt> <summaryOut.json> --checks <checkRecordsDir> --contracts yes|no
// evidenceDir holds one folder per shard, each with shard-meta.json and e2e-last-run.json. checkRecordsDir holds the check-records artifacts (any depth, *.json).
// NEEDS_JSON is the workflow's own `needs` context, so the verdict rests on what each job really ended with and not only on what it uploaded.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { aggregateShardResults, renderSummary } from "../e2e/lib/shardAggregate.mjs";
import { evaluateGateEvidence } from "../e2e/lib/gateChecks.mjs";

const USAGE = "Usage: node tools/aggregate-shard-results.mjs <evidenceDir> <transferManifest.json> <total> <runAttempt> <summaryOut.json> --checks <checkRecordsDir> --contracts yes|no";
const [evidenceDir, manifestPath, totalText, attemptText, out, ...flags] = process.argv.slice(2);
const total = Number(totalText), runAttempt = Number(attemptText);
const flag = name => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : undefined; };
const checksDir = flag("--checks"), contractsText = flag("--contracts");
if (!evidenceDir || !manifestPath || !out || !checksDir || !["yes", "no"].includes(contractsText) || !Number.isInteger(total) || total < 1 || !Number.isInteger(runAttempt) || runAttempt < 1) {
  console.error(USAGE); process.exit(2);
}
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; } };
const prepared = readJson(manifestPath);
if (!prepared) { console.error("The transfer manifest is missing or unreadable."); process.exit(1); }
const expected = execFileSync(process.execPath, ["e2e/run-all.mjs", "--list"], { encoding: "utf8" }).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const shards = fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
  const meta = readJson(path.join(evidenceDir, d.name, "shard-meta.json"));
  return { index: meta?.index, meta, record: readJson(path.join(evidenceDir, d.name, "e2e-last-run.json")) };
}) : [];
const jsonFiles = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? jsonFiles(path.join(dir, d.name)) : d.name.endsWith(".json") ? [path.join(dir, d.name)] : []) : [];
const records = jsonFiles(checksDir).map(file => ({ file: path.relative(checksDir, file).replaceAll("\\", "/"), record: readJson(file) }));
let jobs;
try { jobs = JSON.parse(process.env.NEEDS_JSON ?? ""); } catch { jobs = undefined; }
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const runId = process.env.GITHUB_RUN_ID ?? "";

const shardResult = aggregateShardResults({ expected, total, prepared, runAttempt, shards });
const evidence = evaluateGateEvidence({ records, jobs, contracts: contractsText === "yes", sourceSha, runId, runAttempt, preparedSourceSha: prepared.sourceSha });
if (jobs === undefined) evidence.problems.push("The workflow's job results (needs) are missing or unreadable.");
const problems = [...shardResult.problems, ...evidence.problems];
const result = { ...shardResult, ok: problems.length === 0, problems, runId: String(runId), contracts: contractsText === "yes", checks: evidence.checks, jobs: evidence.jobs };
const text = renderSummary(result, { runAttempt, prepared });
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
fs.writeFileSync(out, JSON.stringify({ ...result, runAttempt, prepared: { sourceSha: prepared.sourceSha, buildKey: prepared.buildKey, exeSha256: prepared.exeSha256, toolchain: prepared.toolchain } }, null, 2) + "\n");
process.exit(result.ok ? 0 : 1);
