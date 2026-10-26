// What makes a compiled executable "the same" (R1c/R1d). The key is a hash of the CONTENT of every build input (tracked or untracked,
// by path, so additions, deletions and renames count), the toolchain versions and the build mode. HEAD is not part of it: the
// working tree is usually uncommitted, so the same HEAD can hold different code.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const norm = file => file.replaceAll("\\", "/");
const ROOT_INPUTS = /^(index\.html|package\.json|package-lock\.json|Cargo\.toml|Cargo\.lock|rust-toolchain(\.toml)?|tsconfig[^/]*\.json|vite[^/]*\.(ts|mjs|js))$/;

// Files outside src/ that the app compiles in with `?raw` (src/legalNotice.ts, src/HelpView.tsx). A test in affected.test.mjs reads the source for
// such imports, so a new one fails there until it is added here.
const EMBEDDED_OUTSIDE_SRC = new Set(["docs/LEGAL-NOTICE.md", "docs/THIRD-PARTY-NOTICES.txt"]);
const BUILD_TOOLS = new Set(["tools/mobile-offline-build.ts", "tools/mobile-icons.ts"]);

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
  if (f.startsWith("@build/") || f.startsWith("mobile/") || f.startsWith(".cargo/") || /^\.env(?:\..+)?$/.test(f) || BUILD_TOOLS.has(f)) return true;
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

/** Validation infrastructure is separate from build freshness and from unit/native test sources. */
export function diffHarnessFiles(before, after) {
  const pick = files => new Map(Object.entries(files).filter(([file]) => isHarnessInput(file) && !isTestOnlyFile(file)).map(([file, hash]) => [norm(file), hash]));
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

function cargoConfigurations(repoRoot, environment) {
  const home = environment.CARGO_HOME || path.join(os.homedir(), ".cargo");
  const configurations = ["config", "config.toml"].map(name => ({ key: `@build/cargo-home/${name}`, file: path.resolve(home, name) }));
  for (let ancestor = path.resolve(repoRoot), depth = 0; ; depth++) {
    for (const name of ["config", "config.toml"]) configurations.push({ key: `@build/cargo-ancestor/${depth}/${name}`, file: path.join(ancestor, ".cargo", name) });
    const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  for (const name of ["config", "config.toml"]) configurations.push({ key: `@build/cargo-tauri/${name}`, file: path.join(repoRoot, "src-tauri", ".cargo", name) });
  return configurations.filter(({ file }) => fs.existsSync(file));
}

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
export function collectInputs(repoRoot, { environment = process.env } = {}) {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const files = {};
  for (const file of listed) {
    if (!isBuildInput(file) && !isHarnessInput(file)) continue;
    try { files[file] = crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, file))).digest("hex"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // Vite reads ignored local dotenv files too. Values/config contents are never stored in the manifest, only SHA-256 digests.
  for (const file of fs.readdirSync(repoRoot).filter(f => /^\.env(?:\..+)?$/.test(f))) {
    if (fs.statSync(path.join(repoRoot, file)).isFile()) files[file] = crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, file))).digest("hex");
  }
  const settings = Object.fromEntries(Object.entries(environment).filter(([name]) => /^(?:CARGO_|RUST|RUSTUP_TOOLCHAIN$|VITE_|TAURI_|NODE_ENV$|NODE_OPTIONS$|SOURCE_DATE_EPOCH$)/.test(name)).sort(([a], [b]) => a.localeCompare(b)));
  files["@build/environment"] = crypto.createHash("sha256").update(JSON.stringify(settings)).digest("hex");
  // Cargo walks from its invocation directory toward the filesystem root, including ignored local configuration.
  // Depth labels preserve precedence without publishing absolute external paths or configuration values.
  // Tauri invokes Cargo in the backend directory, whose local config is below the workspace root.
  for (const { key, file } of cargoConfigurations(repoRoot, environment)) files[key] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  // Fail closed when a production/config module adds a relative dependency outside the reviewed input roots.
  // This catches the entire mobile-offline-build -> mobile-icons chain, and future helpers cannot silently disappear from the key.
  for (const file of Object.keys(files).filter(f => !f.startsWith("@") && isBuildInput(f) && /\.(?:tsx?|m?js)$/.test(f))) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = path.resolve(repoRoot, path.dirname(file), match[1].split("?")[0]);
      const target = [base, ...[".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"].map(ext => base + ext)].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!target) throw new Error(`Unresolved build dependency in ${file}: ${match[1]}`);
      const relative = norm(path.relative(repoRoot, target));
      // Installed packages are governed by package-lock.json, just like bare imports. This is not an audit of node_modules tampering.
      if (relative.startsWith("node_modules/")) continue;
      if (!isBuildInput(relative)) throw new Error(`Unreviewed build input dependency: ${file} imports ${relative}`);
    }
  }
  return files;
}

/** The wrapper's command builds the host debug target at target/debug; refuse overrides that would record a different old file. */
export function assertBuildOutput({ repoRoot, exePath, environment = process.env }) {
  const target = path.resolve(repoRoot, environment.CARGO_TARGET_DIR || "target");
  if (environment.CARGO_BUILD_TARGET || target !== path.resolve(repoRoot, "target")) throw new Error("Unsupported Cargo target/output override for this debug build wrapper");
  if (path.resolve(exePath) !== path.join(target, "debug", "vaultspend.exe")) throw new Error("Unsupported executable output override for this debug build wrapper");
  // Conservative token guard, not a general TOML evaluator. An unreviewed output/target setting must not let a successful
  // compile elsewhere cause an old host executable to be recorded as fresh. Quoted/dotted/inline forms are refused too.
  const outputSetting = /(?:^|[.\s,{])(?:"(?:target(?:-dir)?|target_dir)"|'(?:target(?:-dir)?|target_dir)'|target(?:-dir)?|target_dir)\s*=/m;
  for (const { key, file } of cargoConfigurations(repoRoot, environment)) {
    const source = fs.readFileSync(file, "utf8").replace(/^\s*#.*$/gm, "");
    if (outputSetting.test(source)) throw new Error(`Unsupported Cargo config target/output setting for this host debug wrapper: ${key}`);
  }
}

export function readToolchain() {
  const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim(); } catch { return ""; } };
  return { node: process.version, rustc: run("rustc", ["-V"]), cargo: run("cargo", ["-V"]) };
}
