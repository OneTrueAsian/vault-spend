// Planning, running and reporting `verify:fast` / `verify:full` (R4). The executor is injected so the logic is testable without running anything.
// The fast path keeps every cheap required check (tsc, lint, the FULL unit suite) and adds only the native checks and desktop specs the
// selected change reaches. Neither path is milestone or release acceptance, and the report never blurs executed, reused, skipped and outstanding.
const access = (operation, ...command) => ["node", "e2e/with-access.mjs", operation, "--", ...command];
const STEP = {
  tsc: { label: "TypeScript (tsc --noEmit)", command: ["npx", "tsc", "--noEmit"] },
  lint: { label: "Lint", command: ["npm", "run", "lint"] },
  "npm-test": { label: "Full unit suite (npm test)", command: ["npm", "test"] },
  "cargo-fmt": { label: "Rust formatting", command: access("cargo-fmt", "cargo", "fmt", "--all", "--", "--check") },
  "cargo-clippy": { label: "Rust Clippy (strict)", command: access("cargo-clippy", "cargo", "clippy", "-p", "budget_core", "-p", "vaultspend", "--lib", "--tests", "--", "-D", "warnings") },
  "cargo-test-core": { label: "Rust tests: budget_core", command: access("cargo-test", "cargo", "test", "-p", "budget_core", "--", "--test-threads=1") },
  "cargo-test-commands": { label: "Rust tests: app commands", command: access("cargo-test", "cargo", "test", "-p", "vaultspend", "--lib", "commands::", "--", "--test-threads=1") },
  build: { label: "Debug Tauri build (reused when every input matches)", command: ["npm", "run", "build:app"] },
};
const DISCLAIMER = {
  fast: "FAST VERIFICATION — not milestone or release acceptance. It runs the full unit suite plus only the native checks and desktop specs this change can reach.",
  full: "FULL VERIFICATION — not milestone or release acceptance by itself: mutation checks, performance and memory measurements and the hosted release gate are separate gates.",
};

export function planVerification({ mode, selection, allSpecs, concurrency }) {
  if (!["fast", "full"].includes(mode)) throw new Error(`mode must be "fast" or "full", got ${JSON.stringify(mode)}`);
  const steps = [], skipped = [];
  const add = id => steps.push({ id, ...STEP[id] });
  for (const id of ["tsc", "lint", "npm-test"]) add(id);
  // Desktop specs always use the classified schedule here: exclusive specs run alone. (The runner's own default stays the plain pool until the owner reviews the measured results.)
  const concurrencyArgs = ["--schedule=classified", ...(concurrency ? [`--concurrency=${concurrency}`] : [])];

  if (mode === "full") {
    for (const id of ["cargo-fmt", "cargo-clippy", "cargo-test-core", "cargo-test-commands", "build"]) add(id);
    steps.push({ id: "smoke", label: "Smoke (desktop launch check)", command: ["node", "e2e/run-all.mjs", "--spec=smoke"] });
    steps.push({ id: "desktop-full", label: "Full desktop suite", command: ["node", "e2e/run-all.mjs", ...concurrencyArgs] });
    return { mode, steps, skipped, disclaimer: DISCLAIMER.full };
  }

  const required = (selection.required ?? []).join("\n");
  const rust = [["cargo-fmt", /cargo fmt/], ["cargo-clippy", /clippy/], ["cargo-test-core", /budget_core/], ["cargo-test-commands", /vaultspend/]].filter(([, pattern]) => pattern.test(required));
  if (rust.length) rust.forEach(([id]) => add(id));
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
  return { mode, steps, skipped, disclaimer: DISCLAIMER.fast };
}

export async function runPlan({ plan, exec }) {
  const executed = [], reused = [], failed = [], notRun = [];
  let code = 0;
  for (const step of plan.steps) {
    if (code !== 0) { notRun.push(step); continue; }
    const started = Date.now();
    let outcome;
    try { outcome = await exec(step); } catch (error) { outcome = { code: 1, error: String(error?.message ?? error) }; }
    const record = { ...step, code: outcome.code, seconds: (Date.now() - started) / 1000, ...(outcome.error ? { error: outcome.error } : {}) };
    if (outcome.code !== 0) { failed.push(record); executed.push(record); code = outcome.code; } else if (outcome.reused) reused.push(record);
    else executed.push(record);
  }
  return { code, executed, reused, failed, notRun };
}

export function formatReport({ plan, result, selection }) {
  const lines = [plan.disclaimer, ""];
  lines.push("SELECTION");
  if (selection.notes?.length) selection.notes.forEach(note => lines.push(`  ${note}`));
  for (const entry of selection.entries ?? []) lines.push(`  ${entry.path}  [${entry.verdict}]  ${entry.reason}`);
  lines.push(selection.specs.length ? `  Desktop specs: ${selection.specs.length}${selection.broad ? " (broad: every spec)" : ""}` : "  Desktop specs: none");
  for (const name of selection.specs.slice(0, 40)) lines.push(`    ${name}`);
  if (selection.specs.length > 40) lines.push(`    ... and ${selection.specs.length - 40} more`);
  const section = (title, items, render) => { lines.push("", title); if (!items.length) lines.push("  (none)"); items.forEach(item => lines.push(`  ${render(item)}`)); };
  section("EXECUTED", result.executed, s => `${s.code === 0 ? "pass" : "FAIL"}  ${s.id}: ${s.label} (${s.seconds.toFixed(1)}s)${s.error ? ` — ${s.error}` : ""}`);
  section("REUSED", result.reused, s => `${s.id}: ${s.label} — reused, not recompiled`);
  section("SKIPPED", plan.skipped, s => `${s.id}: ${s.label} — ${s.reason}`);
  if (result.notRun.length) section("NOT RUN (an earlier step failed)", result.notRun, s => `${s.id}: ${s.label}`);
  section("OUTSTANDING", [...(selection.outstanding ?? []), ...(selection.required ?? []).filter(r => /^Review the hosted/.test(r))], text => text);
  lines.push("", result.code === 0 ? `RESULT: PASSED — ${result.executed.length} executed, ${result.reused.length} reused, ${plan.skipped.length} skipped.` : `RESULT: FAILED at ${result.failed.map(s => s.id).join(", ")} (exit ${result.code}).`);
  return lines.join("\n");
}
