// node e2e/select-specs.mjs [--since=<git ref>] [--json]
// Prints which desktop specs the current changes can affect (against HEAD by default, or the ref given), why, and which checks are still
// required. Unknown files and shared infrastructure select every spec. See e2e/affected-map.json.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectChanges, loadMap, selectAffected, validateMap } from "./lib/affected.mjs";
import { discoverSpecs } from "./lib/specAudit.mjs";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(e2eDir);
const since = process.argv.find(a => a.startsWith("--since="))?.split("=")[1] ?? "HEAD";
const specs = discoverSpecs(e2eDir);
const map = loadMap(path.join(e2eDir, "affected-map.json"));
const problems = validateMap(map, specs);
if (problems.length) { console.error(`e2e/affected-map.json is invalid:\n  ${problems.join("\n  ")}`); process.exit(1); }
let selection;
try { selection = selectAffected({ changes: collectChanges(repoRoot, since), specs, map, e2eDir }); } catch (error) { console.error(`Could not compare against "${since}": ${error.message}`); process.exit(1); }
if (process.argv.includes("--json")) { console.log(JSON.stringify({ since, ...selection }, null, 2)); process.exit(0); }
console.log(`Comparison baseline: ${since}`);
selection.notes.forEach(note => console.log(note));
for (const entry of selection.entries) console.log(`  ${entry.path}  [${entry.verdict}]  ${entry.reason}`);
console.log(selection.specs.length ? `\n${selection.specs.length} desktop spec(s)${selection.broad ? " (broad: every spec)" : ""}:\n${selection.specs.map(name => `  ${name}`).join("\n")}` : "\nNo desktop spec is selected.");
console.log(`\nStill required:\n${selection.required.map(item => `  ${item}`).join("\n") || "  (nothing)"}`);
console.log(`\nOutstanding for acceptance:\n${selection.outstanding.map(item => `  ${item}`).join("\n") || "  (nothing)"}`);
