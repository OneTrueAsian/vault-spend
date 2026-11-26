// npm run verify:fast [-- --since=<ref>] [--concurrency=N]   the full unit suite + tsc + lint + only the native checks and desktop specs the change reaches
// npm run verify:full [-- --concurrency=N]                    everything: unit, Rust, build, smoke and the whole desktop suite
// npm run verify:targeted -- --since=<ref> [--plan]         reviewed development checks for the changes since an explicit baseline
// Neither is milestone or release acceptance (mutation, performance and the hosted release gate are separate). The report keeps
// executed, reused, skipped and outstanding checks apart. A desktop run that is refused or whose evidence is invalid exits 2 or 3.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectChanges, loadMap, resolveBaseline, selectAffected, validateMap } from "./lib/affected.mjs";
import { discoverSpecs } from "./lib/specAudit.mjs";
import { formatPreview, formatReport, planVerification, runPlan } from "./lib/verifyPlan.mjs";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(e2eDir);
const mode = process.argv[2];
const options = process.argv.slice(3);
if (!["fast", "full", "targeted"].includes(mode) || options.some(arg => !/^(?:--(?:since|concurrency)=.+|--plan|--allow-long)$/.test(arg))) {
  console.error("Usage: node e2e/verify.mjs <targeted|fast|full> [--since=<ref>] [--concurrency=N] [--plan] [--allow-long]");
  process.exit(64);
}
const arg = name => options.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const concurrency = arg("concurrency") === undefined ? undefined : Number(arg("concurrency"));
if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) { console.error("--concurrency must be a positive integer"); process.exit(64); }
const ref = arg("since") ?? (mode === "fast" ? "HEAD" : undefined);
if (mode === "targeted" && !ref) {
  console.error("Targeted verification requires --since=<ref>. Use the last validated commit or HEAD for uncommitted edits only.");
  process.exit(64);
}

const allSpecs = discoverSpecs(e2eDir);
let selection = { broad: true, specs: allSpecs, entries: [], required: [], outstanding: [], notes: [] };
if (mode !== "full") {
  const map = loadMap(path.join(e2eDir, "affected-map.json"));
  const problems = validateMap(map, allSpecs);
  if (problems.length) { console.error(`e2e/affected-map.json is invalid:\n  ${problems.join("\n  ")}`); process.exit(1); }
  try {
    const commit = resolveBaseline(repoRoot, ref);
    selection = { baseline: { ref, commit }, ...selectAffected({ changes: collectChanges(repoRoot, commit), specs: allSpecs, map, e2eDir }) };
  } catch (error) {
    console.error(`Could not compare against "${ref}": ${error.message}`);
    process.exit(1);
  }
}

function estimateDesktopSeconds(specs) {
  if (!specs.length) return undefined;
  const file = path.join(e2eDir, "spec-weights.json");
  if (!fs.existsSync(file)) return undefined;
  const { weights = {} } = JSON.parse(fs.readFileSync(file, "utf8"));
  const known = Object.values(weights).filter(ms => Number.isFinite(ms) && ms > 0).sort((a, b) => a - b);
  if (!known.length) return undefined;
  const typical = known[Math.floor(known.length / 2)];
  return specs.reduce((sum, spec) => {
    const weight = weights[spec];
    return sum + (Number.isFinite(weight) && weight > 0 ? weight : typical);
  }, 0) / 1000;
}

const plan = planVerification({ mode, selection, allSpecs, concurrency, desktopSeconds: mode === "targeted" ? estimateDesktopSeconds(selection.specs) : undefined });
console.log(formatPreview({ plan, selection }));
if (options.includes("--plan")) process.exit(0);
if (plan.requiresApproval && !options.includes("--allow-long")) {
  console.error("No checks started. After the owner approves this scope, run again with --allow-long.");
  process.exit(2);
}

const exec = step => new Promise(resolve => {
  console.log(`\n=== ${step.id}: ${step.label} ===`);
  const capture = step.id === "build" || step.requiresRustPass;
  const [executable, ...args] = step.command;
  const stdio = ["inherit", capture ? "pipe" : "inherit", "inherit"];
  // Steps with selected filenames run directly so arguments are not interpreted by the shell.
  const child = executable === "node"
    ? spawn(process.execPath, args, { cwd: repoRoot, stdio })
    : spawn(step.command.join(" "), { cwd: repoRoot, shell: true, stdio });
  let text = "";
  child.stdout?.on("data", d => { text += d; process.stdout.write(d); });
  child.on("error", () => resolve({ code: 127 }));
  child.on("close", code => resolve({
    code: code ?? 1,
    reused: step.id === "build" && /^Reused /m.test(text),
    rustTestsPassed: step.requiresRustPass && /^test result: ok\. [1-9]\d* passed;/m.test(text),
  }));
});
const result = await runPlan({ plan, exec });
console.log(`\n${formatReport({ plan, result, selection })}`);
process.exit(result.code);
