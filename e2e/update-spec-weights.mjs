// Writes e2e/spec-weights.json from the run times recorded on this machine (e2e/.e2e-durations.json).
// run-all.mjs --shard=i/N uses these weights to split the specs into slices of about equal length. They are committed so
// every hosted shard computes the same split (the timings file is local and ignored by git). Refresh them after a full run:
//   node e2e/update-spec-weights.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const durations = JSON.parse(fs.readFileSync(path.join(e2eDir, ".e2e-durations.json"), "utf8"));
const specs = ["smoke.mjs", ...fs.readdirSync(e2eDir).filter((f) => /^feature\d+.*\.mjs$/.test(f))];
const weights = {};
for (const name of specs.sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
  const ms = durations[name];
  if (Number.isFinite(ms) && ms > 0) weights[name] = Math.round(ms / 100) * 100;
}
const missing = specs.filter((name) => !(name in weights));
fs.writeFileSync(
  path.join(e2eDir, "spec-weights.json"),
  JSON.stringify({ note: "Last recorded run time in ms per spec, for run-all.mjs --shard. Refresh with: node e2e/update-spec-weights.mjs", weights }, null, 2) + "\n",
);
console.log(`${Object.keys(weights).length} spec weights written${missing.length ? `; no recorded time yet for ${missing.length}: ${missing.join(", ")}` : ""}`);
