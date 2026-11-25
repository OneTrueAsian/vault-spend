// Affected-spec selection (R3). Conservative by construction: a file is narrowed to particular specs only by an explicit rule in
// e2e/affected-map.json. Shared infrastructure, persistence, invocation wrappers, build configuration and the harness select every
// spec, and so does any file the map does not know. Native files are not visible to JavaScript import analysis, so a rule marks them
// and the selection lists the Rust and TypeScript contract checks that must also run.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isRustTestOnlyFile } from "./buildIdentity.mjs";
import { matchesSelector } from "./specSelectors.mjs";
import { transitiveImports } from "./specAudit.mjs";

const norm = file => file.replaceAll("\\", "/");
export function globToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") { out += ".*"; i++; if (pattern[i + 1] === "/") i++; } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export const loadMap = file => JSON.parse(fs.readFileSync(file, "utf8"));

export function validateMap(map, specs) {
  const problems = [];
  const patterned = (list, name, { needsSpecs }) => {
    if (!Array.isArray(list)) { problems.push(`${name} must be a list`); return; }
    for (const rule of list) {
      if (typeof rule?.pattern !== "string" || !rule.pattern) { problems.push(`${name}: a rule has no pattern`); continue; }
      try { globToRegExp(rule.pattern); } catch { problems.push(`${name}: pattern ${rule.pattern} is not valid`); }
      if (typeof rule.reason !== "string" || rule.reason.length < 10) problems.push(`${name}: ${rule.pattern} needs a reason`);
      if (rule.unitTargets !== undefined && (!Array.isArray(rule.unitTargets) || !rule.unitTargets.length || rule.unitTargets.some(target => typeof target !== "string" || !/^(?:src|e2e)\//.test(target)))) {
        problems.push(`${name}: ${rule.pattern} needs a list of Vitest paths under src/ or e2e/`);
      }
      if (needsSpecs) {
        if (!Array.isArray(rule.specs) || !rule.specs.length) problems.push(`${name}: ${rule.pattern} selects no specs`);
        for (const selector of rule.specs ?? []) if (!specs.some(spec => matchesSelector(spec, selector))) problems.push(`${name}: ${rule.pattern} selects "${selector}", which matches no spec`);
      }
    }
  };
  patterned(map.broad, "broad", { needsSpecs: false });
  patterned(map.noDesktop, "noDesktop", { needsSpecs: false });
  patterned(map.areas, "areas", { needsSpecs: true });
  return problems;
}

const git = (repoRoot, args, quiet = false) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", quiet ? "ignore" : "pipe"] });

export function resolveBaseline(repoRoot, ref) {
  return git(repoRoot, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]).trim();
}

/** Compare a git ref with the working tree, including untracked files and the original path of renames. */
export function collectChanges(repoRoot, since = "HEAD") {
  const baseline = resolveBaseline(repoRoot, since);
  const tokens = git(repoRoot, ["diff", "--name-status", "-z", "-M", baseline, "--"], true).split("\0").filter(Boolean);
  const changes = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i][0];
    if (status === "R" || status === "C") { changes.push({ status: status === "R" ? "R" : "A", path: norm(tokens[i + 2]), ...(status === "R" ? { oldPath: norm(tokens[i + 1]) } : {}) }); i += 3; } else { changes.push({ status: status === "T" ? "M" : status, path: norm(tokens[i + 1]) }); i += 2; }
  }
  for (const file of git(repoRoot, ["ls-files", "-o", "--exclude-standard", "-z"], true).split("\0").filter(Boolean)) changes.push({ status: "A", path: norm(file) });
  return changes;
}

const FAST_BASE = ["npm test (the full unit suite)", "npm run lint", "npx tsc --noEmit"];
const NATIVE_CHECKS = ["cargo-fmt", "cargo-clippy", "cargo-test-core", "cargo-test-commands"];
const reachesNative = file => /\.rs$/.test(file) || /(^|\/)Cargo\.(toml|lock)$/.test(file) || /^rust-toolchain(?:\.toml)?$/.test(file) || file.startsWith("src-tauri/") || file.startsWith("core/tests/fixtures/");
export const isVitestFile = file => /^(?:src\/.*\.test\.tsx?|e2e\/.*\.test\.mjs)$/.test(file);
const appTestChecks = new Map([
  ["src-tauri/src/backups/tests.rs", "cargo-test-backups"],
  ["src-tauri/src/commands/files/tests.rs", "cargo-test-files"],
  ["src-tauri/src/commands/folder_imports/tests.rs", "cargo-test-folder-imports"],
]);

function rustTestCheck(file, status) {
  if (appTestChecks.has(file)) return appTestChecks.get(file);
  if (status === "D" && /^core\/tests\/(?:comparisons\/main|\w+)\.rs$/.test(file)) return "cargo-test-core";
  if (file.startsWith("core/tests/comparisons/")) return "cargo-test-comparisons";
  if (file.startsWith("core/tests/")) return `cargo-test-integration:${path.posix.basename(file, ".rs")}`;
  if (file === "core/src/store/tests/ask_vault_retirement_fixtures.json") return "cargo-test-store:ask_vault_retirement";
  const storeModule = file.match(/^core\/src\/store\/tests\/(\w+)\.rs$/);
  return storeModule ? `cargo-test-store:${storeModule[1]}` : "cargo-test-core";
}

export function selectAffected({ changes, specs, map, e2eDir }) {
  const entries = [], selected = new Set(), required = new Set(), notes = [], nativeChecks = new Set();
  let broad = false;
  const importers = new Map(); // helper file -> specs importing it, built lazily
  const importersOf = file => {
    if (!importers.size) for (const spec of specs) for (const imported of transitiveImports(path.join(e2eDir, spec))) {
      const key = norm(path.relative(path.dirname(e2eDir), imported));
      importers.set(key, [...(importers.get(key) ?? []), spec]);
    }
    return importers.get(file) ?? [];
  };
  const find = (list, file) => (list ?? []).find(rule => globToRegExp(rule.pattern).test(file));

  for (const change of changes) {
    const paths = change.oldPath ? [[change.path, "A"], [change.oldPath, "D"]] : [[change.path, change.status]];
    for (const [file, status] of paths) {
      const base = { path: file, status };
      // Native obligations are independent of the desktop map's first matching rule. A broad/unknown match cannot erase them.
      // Include the old path of a rename/deletion, even when its new path is a frontend file.
      if (isRustTestOnlyFile(file)) {
        nativeChecks.add("cargo-fmt");
        nativeChecks.add(rustTestCheck(file, status));
        entries.push({ ...base, verdict: "no-desktop", reason: "Audited Rust test input. It selects its Rust test target and leaves the desktop executable current." });
        continue;
      }
      if (reachesNative(file)) {
        NATIVE_CHECKS.forEach(check => nativeChecks.add(check));
        nativeChecks.add("cargo-test-workspace");
      }
      if (isVitestFile(file)) {
        entries.push({ ...base, verdict: "no-desktop", reason: "Vitest unit test source. It runs with Vitest and is outside the desktop executable.", unitTargets: status === "D" ? undefined : [file] });
        continue;
      }
      let rule;
      if ((rule = find(map.broad, file))) { broad = true; entries.push({ ...base, verdict: "broad", reason: rule.reason }); } else if ((rule = find(map.noDesktop, file))) {
        entries.push({ ...base, verdict: "no-desktop", reason: rule.reason, ...(rule.unitTargets ? { unitTargets: rule.unitTargets } : {}) });
        for (const r of rule.requires ?? []) required.add(r);
        for (const check of rule.nativeChecks ?? []) nativeChecks.add(check);
      } else if (/^e2e\/(smoke|feature\d+[^/]*)\.mjs$/.test(file)) {
        const name = file.slice("e2e/".length);
        if (specs.includes(name)) selected.add(name);
        entries.push({ ...base, verdict: "spec", reason: specs.includes(name) ? "A desktop spec changed: it runs itself." : "A desktop spec was removed; nothing to run for it." });
      } else if (file.startsWith("e2e/lib/")) {
        const users = importersOf(file);
        users.forEach(name => selected.add(name));
        entries.push({ ...base, verdict: users.length ? "helper" : "no-desktop", unitCoverageUnknown: true, reason: users.length ? `Imported (directly or through another helper) by ${users.length} spec(s).` : "No desktop spec imports this helper." });
      } else if ((rule = find(map.areas, file))) {
        rule.specs.forEach(selector => specs.filter(name => matchesSelector(name, selector)).forEach(name => selected.add(name)));
        for (const r of rule.requires ?? []) required.add(r);
        entries.push({ ...base, verdict: "area", reason: rule.reason, ...(rule.unitTargets ? { unitTargets: rule.unitTargets } : {}) });
      } else { broad = true; entries.push({ ...base, verdict: "unknown", reason: "No rule in e2e/affected-map.json covers this file, so every desktop spec is selected." }); }
    }
  }

  if (!changes.length) notes.push("No changes against the baseline, so nothing is selected.");
  if (broad) specs.forEach(name => selected.add(name));
  else if (selected.size) selected.add("smoke.mjs");
  const ordered = specs.filter(name => selected.has(name));
  if (changes.length) FAST_BASE.forEach(item => required.add(item));
  if (ordered.length) required.add("npm run build:app (the executable is reused only when every build input matches)");
  const outstanding = changes.length ? [
    broad
      ? "Milestone or release acceptance still needs its own gates (mutation, performance, the hosted release gate at its approved concurrency) where AGENTS.md or the milestone protocol requires them."
      : "A full desktop suite is still required for milestone or release acceptance and after shared UI, persistence or harness changes; this selection is not full regression coverage.",
  ] : [];
  return { broad, specs: ordered, entries, required: [...required], nativeChecks: [...nativeChecks], outstanding, notes };
}
