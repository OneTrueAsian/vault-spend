// Planning, running and reporting verification. The executor is injected so the logic is testable without running anything.
// The fast path keeps every cheap required check (tsc, lint, the FULL unit suite) and adds only the native checks and desktop specs the
// selected change reaches. Neither path is milestone or release acceptance, and the report never blurs executed, reused, skipped and outstanding.
import { isVitestFile } from "./affected.mjs";

const access = (operation, ...command) => ["node", "e2e/with-access.mjs", operation, "--", ...command];
const focusedRust = (label, crate, ...args) => ({
  label,
  requiresRustPass: true,
  command: access("cargo-test", "cargo", "test", "-p", crate, ...args, "--", "--test-threads=1"),
});
const STEP = {
  tsc: { label: "TypeScript (tsc --noEmit)", command: ["npx", "tsc", "--noEmit"] },
  lint: { label: "Lint", command: ["npm", "run", "lint"] },
  "npm-test": { label: "Full unit suite (npm test)", command: ["npm", "test"] },
  "cargo-fmt": { label: "Rust formatting", command: access("cargo-fmt", "cargo", "fmt", "--all", "--", "--check") },
  "cargo-clippy": { label: "Rust Clippy (strict, all workspace targets)", command: access("cargo-clippy", "cargo", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings") },
  "cargo-test-core": { label: "Rust tests: budget_core", command: access("cargo-test", "cargo", "test", "-p", "budget_core", "--", "--test-threads=1") },
  "cargo-test-commands": { label: "Rust tests: app commands", command: access("cargo-test", "cargo", "test", "-p", "vaultspend", "--lib", "commands::", "--", "--test-threads=1") },
  "cargo-test-workspace": { label: "Rust tests: full workspace", command: access("cargo-test", "cargo", "test", "--workspace", "--", "--test-threads=1") },
  "cargo-test-backups": focusedRust("Rust tests for desktop backups", "vaultspend", "--lib", "backups::tests::"),
  "cargo-test-files": focusedRust("Rust tests for file commands", "vaultspend", "--lib", "commands::files::tests::"),
  "cargo-test-folder-imports": focusedRust("Rust tests for folder import commands", "vaultspend", "--lib", "commands::folder_imports::tests::"),
  "cargo-test-comparisons": focusedRust("Rust comparisons integration tests", "budget_core", "--test", "comparisons"),
  build: { label: "Debug Tauri build (reused when every input matches)", command: ["npm", "run", "build:app"] },
};
const DISCLAIMER = {
  fast: "FAST VERIFICATION — not milestone or release acceptance. It runs the full unit suite plus only the native checks and desktop specs this change can reach.",
  full: "FULL VERIFICATION — not milestone or release acceptance by itself: mutation checks, performance and memory measurements and the hosted release gate are separate gates.",
  targeted: "TARGETED VERIFICATION — development coverage for the selected changes. Milestone and release acceptance use their own gates.",
};

function nativeStep(id) {
  if (Object.hasOwn(STEP, id)) return STEP[id];
  const match = /^cargo-test-(store|integration):(\w+)$/.exec(id);
  if (!match) throw new Error(`Unknown native check ${id}`);
  const [, kind, name] = match;
  const args = kind === "store" ? ["--lib", `store::tests::${name}::`] : ["--test", name];
  return focusedRust(`Rust ${name} tests`, "budget_core", ...args);
}

export function planVerification({ mode, selection, allSpecs, concurrency, desktopSeconds }) {
  if (!Object.hasOwn(DISCLAIMER, mode)) throw new Error(`Unknown verification mode ${JSON.stringify(mode)}`);
  const steps = [], skipped = [];
  const add = id => steps.push({ id, ...nativeStep(id) });
  const targeted = mode === "targeted";
  if (targeted) {
    const entries = selection.entries ?? [];
    const unitTargets = [...new Set(entries.flatMap(entry => entry.unitTargets ?? []))];
    const fullUnit = selection.broad || entries.some(entry =>
      entry.unitCoverageUnknown || (entry.verdict === "area" && !entry.unitTargets) || (isVitestFile(entry.path) && entry.status === "D"));
    const sourceEntries = entries.filter(entry => /^src\/.*\.tsx?$/.test(entry.path));
    if (selection.broad || sourceEntries.length || unitTargets.some(target => target.startsWith("src/"))) add("tsc");
    const lintFiles = sourceEntries.filter(entry => entry.status !== "D" && !isVitestFile(entry.path)).map(entry => entry.path);
    if (selection.broad) add("lint");
    else if (lintFiles.length) steps.push({ id: "lint-focused", label: "Lint changed source files", command: ["node", "node_modules/eslint/bin/eslint.js", "--", ...new Set(lintFiles)] });
    if (fullUnit) add("npm-test");
    else if (unitTargets.length) steps.push({ id: "vitest-focused", label: "Selected Vitest files or directories", command: ["node", "node_modules/vitest/vitest.mjs", "run", ...unitTargets] });
    else skipped.push({ id: "npm-test", label: "Vitest", reason: "The selection reaches no known Vitest consumer." });
  } else {
    for (const id of ["tsc", "lint", "npm-test"]) add(id);
  }
  // Desktop specs use the classified schedule: exclusive or unapproved specs run alone.
  const concurrencyArgs = ["--schedule=classified", ...(concurrency ? [`--concurrency=${concurrency}`] : [])];

  if (mode === "full") {
    for (const id of ["cargo-fmt", "cargo-clippy", "cargo-test-workspace", "build"]) add(id);
    steps.push({ id: "smoke", label: "Smoke (desktop launch check)", command: ["node", "e2e/run-all.mjs", "--spec=smoke"] });
    steps.push({ id: "desktop-full", label: "Full desktop suite", command: ["node", "e2e/run-all.mjs", ...concurrencyArgs] });
    return { mode, steps, skipped, disclaimer: DISCLAIMER.full };
  }

  const required = (selection.required ?? []).join("\n");
  // Structured native obligations cannot be lost when a broad desktop rule bypasses the map's explanatory strings.
  // Retain older area-map `requires` declarations for existing cross-language boundaries.
  const structured = new Set(selection.nativeChecks ?? []);
  const rust = [["cargo-fmt", /cargo fmt/], ["cargo-clippy", /clippy/], ["cargo-test-core", /budget_core/], ["cargo-test-commands", /vaultspend/]]
    .filter(([id, pattern]) => structured.has(id) || pattern.test(required)).map(([id]) => id);
  for (const id of structured) {
    if (id !== "cargo-test-workspace" && !rust.includes(id)) rust.push(id);
  }
  if (structured.has("cargo-test-workspace")) {
    for (const id of rust.filter(id => !id.startsWith("cargo-test"))) add(id);
    add("cargo-test-workspace");
  } else if (rust.length) rust.forEach(add);
  else skipped.push({ id: "cargo", label: "Rust checks", reason: "No native (Rust) file changed or reached by this selection." });

  if (selection.specs.length) {
    add("build");
    // A broad selection is "everything": no filter, so a spec added after the selection was made cannot be missed.
    if (selection.broad) steps.push({ id: "desktop", label: `Desktop specs (every spec, ${allSpecs.length}: broad selection)`, command: ["node", "e2e/run-all.mjs", ...concurrencyArgs] });
    else steps.push({ id: "desktop", label: `Desktop specs (${selection.specs.length} selected)`, command: ["node", "e2e/run-all.mjs", `--spec=${selection.specs.join(",")}`, ...concurrencyArgs] });
  } else {
    skipped.push({ id: "build", label: "Debug Tauri build", reason: "No desktop spec is selected, so no executable is needed." });
    skipped.push({ id: "desktop", label: "Selected desktop specs", reason: "This change reaches no desktop spec (no desktop spec is affected)." });
  }
  skipped.push({ id: "desktop-full", label: "Full desktop suite", reason: selection.broad ? "The selection already covers every spec; milestone or release acceptance still needs the final-tree run at its approved concurrency." : "Not part of the fast path." });
  const requiresApproval = targeted && (selection.broad || desktopSeconds >= 300 || steps.some(step =>
    ["npm-test", "cargo-clippy", "cargo-test-core", "cargo-test-workspace"].includes(step.id)));
  return { mode, steps, skipped, requiresApproval, desktopSeconds, disclaimer: DISCLAIMER[mode] };
}

export async function runPlan({ plan, exec }) {
  const executed = [], reused = [], failed = [], notRun = [];
  let code = 0;
  for (const step of plan.steps) {
    if (code !== 0) { notRun.push(step); continue; }
    const started = Date.now();
    let outcome;
    try { outcome = await exec(step); } catch (error) { outcome = { code: 1, error: String(error?.message ?? error) }; }
    if (step.requiresRustPass && outcome.code === 0 && !outcome.rustTestsPassed) {
      outcome = { code: 1, error: "The selected Rust check reported no passing tests. Verify the target or module filter." };
    }
    const record = { ...step, code: outcome.code, seconds: (Date.now() - started) / 1000, ...(outcome.error ? { error: outcome.error } : {}) };
    if (outcome.code !== 0) { failed.push(record); executed.push(record); code = outcome.code; } else if (outcome.reused) reused.push(record);
    else executed.push(record);
  }
  return { code, executed, reused, failed, notRun };
}

function selectionLines(plan, selection) {
  const lines = [plan.disclaimer, ""];
  lines.push("SELECTION");
  if (selection.baseline) lines.push(`  Baseline: ${selection.baseline.ref} (${selection.baseline.commit})`);
  if (selection.notes?.length) selection.notes.forEach(note => lines.push(`  ${note}`));
  for (const entry of selection.entries ?? []) lines.push(`  ${entry.path}  [${entry.verdict}]  ${entry.reason}`);
  lines.push(selection.specs.length ? `  Desktop specs: ${selection.specs.length}${selection.broad ? " (broad: every spec)" : ""}` : "  Desktop specs: none");
  for (const name of selection.specs.slice(0, 40)) lines.push(`    ${name}`);
  if (selection.specs.length > 40) lines.push(`    ... and ${selection.specs.length - 40} more`);
  return lines;
}

const outstandingChecks = selection => [...(selection.outstanding ?? []), ...(selection.required ?? []).filter(r => /^Review the hosted/.test(r))];

export function formatPreview({ plan, selection }) {
  const lines = selectionLines(plan, selection);
  lines.push("", "PLANNED COMMANDS");
  for (const step of plan.steps) lines.push(`  ${step.id}: ${step.command.map(arg => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(" ")}`);
  if (!plan.steps.length) lines.push("  (none)");
  if (plan.desktopSeconds !== undefined) lines.push(`  Desktop time estimate: about ${Math.ceil(plan.desktopSeconds / 60)} min from shard weights, before build or setup.`);
  for (const s of plan.skipped) lines.push(`  (skipped) ${s.id}: ${s.reason}`);
  for (const check of outstandingChecks(selection)) lines.push(`  (outstanding) ${check}`);
  if (plan.requiresApproval) lines.push("  Owner approval is required for the planned full or long checks.");
  return lines.join("\n");
}

export function formatReport({ plan, result, selection }) {
  const lines = selectionLines(plan, selection);
  const section = (title, items, render) => { lines.push("", title); if (!items.length) lines.push("  (none)"); items.forEach(item => lines.push(`  ${render(item)}`)); };
  section("EXECUTED", result.executed, s => `${s.code === 0 ? "pass" : "FAIL"}  ${s.id}: ${s.label} (${s.seconds.toFixed(1)}s)${s.error ? ` — ${s.error}` : ""}`);
  section("REUSED", result.reused, s => `${s.id}: ${s.label} — reused, not recompiled`);
  section("SKIPPED", plan.skipped, s => `${s.id}: ${s.label} — ${s.reason}`);
  if (result.notRun.length) section("NOT RUN (an earlier step failed)", result.notRun, s => `${s.id}: ${s.label}`);
  section("OUTSTANDING", outstandingChecks(selection), text => text);
  lines.push("", !plan.steps.length ? "RESULT: No checks selected." : result.code === 0 ? `RESULT: PASSED — ${result.executed.length} executed, ${result.reused.length} reused, ${plan.skipped.length} skipped.` : `RESULT: FAILED at ${result.failed.map(s => s.id).join(", ")} (exit ${result.code}).`);
  return lines.join("\n");
}
