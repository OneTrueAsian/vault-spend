// npm run verify:fast [-- --since=<ref>] [--concurrency=N]   the full unit suite + tsc + lint + only the native checks and desktop specs the change reaches
// npm run verify:full [-- --concurrency=N]                    everything: unit, Rust, build, smoke and the whole desktop suite
// Neither is milestone or release acceptance (mutation, performance and the hosted release gate are separate). The report keeps
// executed, reused, skipped and outstanding checks apart. A desktop run that is refused or whose evidence is invalid exits 2 or 3.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectChanges, loadMap, selectAffected, validateMap } from "./lib/affected.mjs";
import { discoverSpecs } from "./lib/specAudit.mjs";
import { formatReport, planVerification, runPlan } from "./lib/verifyPlan.mjs";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(e2eDir);
const mode = process.argv[2];
if (!["fast", "full"].includes(mode)) { console.error("Usage: node e2e/verify.mjs <fast|full> [--since=<ref>] [--concurrency=N] [--plan]"); process.exit(64); }
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1];
const concurrency = arg("concurrency") ? Number(arg("concurrency")) : undefined;
if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) { console.error("--concurrency must be a positive integer"); process.exit(64); }

const allSpecs = discoverSpecs(e2eDir);
let selection = { broad: false, specs: [], entries: [], required: [], outstanding: [], notes: [] };
if (mode === "fast") {
  const map = loadMap(path.join(e2eDir, "affected-map.json"));
  const problems = validateMap(map, allSpecs);
  if (problems.length) { console.error(`e2e/affected-map.json is invalid:\n  ${problems.join("\n  ")}`); process.exit(1); }
  try { selection = selectAffected({ changes: collectChanges(repoRoot, arg("since") ?? "HEAD"), specs: allSpecs, map, e2eDir }); } catch (error) { console.error(`Could not compare against "${arg("since") ?? "HEAD"}": ${error.message}`); process.exit(1); }
}
const plan = planVerification({ mode, selection, allSpecs, concurrency });
if (process.argv.includes("--plan")) {
  console.log(plan.disclaimer); plan.steps.forEach(step => console.log(`  ${step.id}: ${step.command.join(" ")}`)); plan.skipped.forEach(s => console.log(`  (skipped) ${s.id}: ${s.reason}`)); process.exit(0);
}

const exec = step => new Promise(resolve => {
  console.log(`\n=== ${step.id}: ${step.label} ===`);
  const capture = step.id === "build";
  const child = spawn(step.command.join(" "), { cwd: repoRoot, shell: true, stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"] });
  let text = "";
  child.stdout?.on("data", d => { text += d; process.stdout.write(d); });
  child.on("error", () => resolve({ code: 127 }));
  child.on("close", code => resolve({ code: code ?? 1, reused: capture && /^Reused /m.test(text) }));
});
const result = await runPlan({ plan, exec });
console.log(`\n${formatReport({ plan, result, selection })}`);
process.exit(result.code);
