// What makes a compiled executable "the same" (R1c/R1d). The key is a hash of the CONTENT of every build input (tracked or untracked,
// by path, so additions, deletions and renames count), the toolchain versions and the build mode. HEAD is not part of it: the
// working tree is usually uncommitted, so the same HEAD can hold different code.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const norm = file => file.replaceAll("\\", "/");
const ROOT_INPUTS = /^(index\.html|package\.json|package-lock\.json|Cargo\.toml|Cargo\.lock|rust-toolchain(\.toml)?|tsconfig[^/]*\.json|vite[^/]*\.(ts|mjs|js))$/;

// Files outside src/ that the app compiles in with `?raw` (src/legalNotice.ts, src/HelpView.tsx). A test in affected.test.mjs reads the source for
// such imports, so a new one fails there until it is added here.
const EMBEDDED_OUTSIDE_SRC = new Set(["docs/LEGAL-NOTICE.md", "docs/THIRD-PARTY-NOTICES.txt"]);

// Test-only files (owner decision, 20 Oct 2026): a test edit cannot change the application, so it must not rebuild or invalidate it. Only files that are never compiled into
// the app qualify. buildIdentity.test.mjs proves it: no production module under src/ imports one, and the Rust test modules are declared #[cfg(test)].
const TS_TEST_ONLY = /^src\/(?:.*\.test\.(?:ts|tsx)|testSupport\/.*|[^/]*TestUtils\.ts)$/;
const RUST_TEST_ONLY = /^core\/src\/(?:.*\/)?(?:tests\.rs|[^/]*_tests\.rs|tests\/.*)$/;
export function isTestOnlyFile(file) {
  const f = norm(file);
  return TS_TEST_ONLY.test(f) || RUST_TEST_ONLY.test(f);
}

/** Files whose content can change the executable (or the frontend bundle built into it). Everything else (tests, tests of the runner, docs, workflows) cannot. */
export function isBuildInput(file) {
  const f = norm(file);
  if (isTestOnlyFile(f)) return false;
  if (EMBEDDED_OUTSIDE_SRC.has(f)) return true;
  if (f.startsWith("src-tauri/target/") || f.startsWith("target/") || f.startsWith("node_modules/") || f.startsWith("dist/")) return false;
  if (f.startsWith("src/") || f.startsWith("public/") || f.startsWith("core/") || f.startsWith("src-tauri/")) return true;
  return ROOT_INPUTS.test(f);
}

const inputsOf = files => Object.entries(files).filter(([file]) => isBuildInput(file)).map(([file, hash]) => [norm(file), hash]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export function computeBuildKey({ files, toolchain, mode }) {
  if (!files || typeof files !== "object") throw new Error("A build key needs the list of input files.");
  if (!toolchain || ["node", "rustc", "cargo"].some(name => typeof toolchain[name] !== "string" || !toolchain[name])) throw new Error("A build key needs the node, rustc and cargo versions (toolchain).");
  if (typeof mode !== "string" || !mode) throw new Error("A build key needs the build mode.");
  return crypto.createHash("sha256").update(JSON.stringify({ mode, toolchain: { node: toolchain.node, rustc: toolchain.rustc, cargo: toolchain.cargo }, files: inputsOf(files) })).digest("hex");
}

/** Test and harness identity, kept apart from the application's: test files, the desktop runner and harness, and the specs. A change here never rebuilds the app, but it is part of what a result is evidence for. */
export function isHarnessInput(file) {
  const f = norm(file);
  if (isTestOnlyFile(f)) return true;
  return f.startsWith("e2e/") && f !== "e2e/.e2e-durations.json" && !f.startsWith("e2e/.");
}

export function computeTestKey({ files }) {
  if (!files || typeof files !== "object") throw new Error("A test key needs the list of input files.");
  const inputs = Object.entries(files).filter(([file]) => isHarnessInput(file)).map(([file, hash]) => [norm(file), hash]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return crypto.createHash("sha256").update(JSON.stringify({ files: inputs })).digest("hex");
}

/** Which TEST files (never the runner or documents) were added, removed or changed between two snapshots. A test edit mid-run still invalidates the run, as it did when tests counted as build inputs. */
export function diffTestFiles(before, after) {
  const pick = files => new Map(Object.entries(files).filter(([file]) => isTestOnlyFile(file)).map(([file, hash]) => [norm(file), hash]));
  const a = pick(before), b = pick(after);
  return {
    added: [...b.keys()].filter(file => !a.has(file)).sort(),
    removed: [...a.keys()].filter(file => !b.has(file)).sort(),
    changed: [...b.keys()].filter(file => a.has(file) && a.get(file) !== b.get(file)).sort(),
  };
}

export function diffInputs(before, after) {
  const a = new Map(inputsOf(before)), b = new Map(inputsOf(after));
  return {
    added: [...b.keys()].filter(file => !a.has(file)).sort(),
    removed: [...a.keys()].filter(file => !b.has(file)).sort(),
    changed: [...b.keys()].filter(file => a.has(file) && a.get(file) !== b.get(file)).sort(),
  };
}

export const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();

export function recordArtifact({ exePath, recordPath, key, builtAt = new Date().toISOString() }) {
  const exeSha256 = sha256File(exePath); // throws when there is no executable
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify({ key, exeSha256, builtAt }, null, 2) + "\n");
  return { key, exeSha256, builtAt };
}

/** fresh: built from exactly these inputs and untouched. stale: inputs changed since. changed: the file is not the one recorded. unknown: nothing trustworthy recorded. missing: no executable. */
export function verifyArtifact({ exePath, recordPath, currentKey }) {
  if (!fs.existsSync(exePath)) return { status: "missing", reason: `No executable at ${exePath}. Build it first.` };
  let record;
  try { record = JSON.parse(fs.readFileSync(recordPath, "utf8")); } catch { record = null; }
  if (!record || typeof record.key !== "string" || typeof record.exeSha256 !== "string") return { status: "unknown", reason: "No readable record of what this executable was built from." };
  const exeSha256 = sha256File(exePath);
  if (exeSha256 !== record.exeSha256) return { status: "changed", exeSha256, builtAt: record.builtAt, reason: "The executable is not the one that was recorded; it was replaced after it was built." };
  if (record.key !== currentKey) return { status: "stale", exeSha256, builtAt: record.builtAt, reason: "Build inputs have changed since this executable was built." };
  return { status: "fresh", exeSha256, builtAt: record.builtAt, key: record.key };
}

/** Content hashes of every non-ignored file in the working tree (tracked and untracked) that is a build input or a test/harness input; each key filters to its own kind. */
export function collectInputs(repoRoot) {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const files = {};
  for (const file of listed) {
    if (!isBuildInput(file) && !isHarnessInput(file)) continue;
    try { files[file] = crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, file))).digest("hex"); } catch { /* deleted but still listed: absent from the key, like a deletion */ }
  }
  return files;
}

export function readToolchain() {
  const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim(); } catch { return ""; } };
  return { node: process.version, rustc: run("rustc", ["-V"]), cargo: run("cargo", ["-V"]) };
}
