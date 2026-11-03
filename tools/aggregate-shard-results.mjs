// Hosted sharded gate: joins the shards' run records into one verdict (see e2e/lib/shardAggregate.mjs).
// Usage: node tools/aggregate-shard-results.mjs <evidenceDir> <transferManifest.json> <total> <runAttempt> [summaryOut.json]
// evidenceDir holds one folder per shard, each with shard-meta.json and e2e-last-run.json.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { aggregateShardResults, renderSummary } from "../e2e/lib/shardAggregate.mjs";

const [evidenceDir, manifestPath, totalText, attemptText, out] = process.argv.slice(2);
const total = Number(totalText), runAttempt = Number(attemptText);
if (!evidenceDir || !manifestPath || !Number.isInteger(total) || total < 1 || !Number.isInteger(runAttempt) || runAttempt < 1) {
  console.error("Usage: node tools/aggregate-shard-results.mjs <evidenceDir> <transferManifest.json> <total> <runAttempt> [summaryOut.json]"); process.exit(2);
}
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; } };
const prepared = readJson(manifestPath);
if (!prepared) { console.error("The transfer manifest is missing or unreadable."); process.exit(1); }
const expected = execFileSync(process.execPath, ["e2e/run-all.mjs", "--list"], { encoding: "utf8" }).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const shards = fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
  const meta = readJson(path.join(evidenceDir, d.name, "shard-meta.json"));
  return { index: meta?.index, meta, record: readJson(path.join(evidenceDir, d.name, "e2e-last-run.json")) };
}) : [];
const result = aggregateShardResults({ expected, total, prepared, runAttempt, shards });
const text = renderSummary(result, { runAttempt, prepared });
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
if (out) fs.writeFileSync(out, JSON.stringify({ ...result, runAttempt, prepared: { sourceSha: prepared.sourceSha, buildKey: prepared.buildKey, exeSha256: prepared.exeSha256, toolchain: prepared.toolchain } }, null, 2) + "\n");
process.exit(result.ok ? 0 : 1);
