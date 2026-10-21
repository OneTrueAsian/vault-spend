// R1c/R1d: which build inputs make an executable "the same", and whether a recorded executable is still the one that was built.
// The key is computed from file CONTENT hashes plus toolchain and build mode, never from HEAD alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeBuildKey, computeTestKey, diffInputs, isBuildInput, isHarnessInput, isTestOnlyFile, recordArtifact, verifyArtifact } from "./buildIdentity.mjs";

const files = () => ({
  "src/main.tsx": "a1", "src/askVault/useRetirementScenario.ts": "b2", "src-tauri/src/lib.rs": "c3", "core/src/store.rs": "d4",
  "Cargo.lock": "e5", "package-lock.json": "f6", "package.json": "07", "vite.config.ts": "18", "tsconfig.json": "29", "src-tauri/tauri.conf.json": "3a", "index.html": "4b",
});
const toolchain = () => ({ node: "v22.20.0", rustc: "rustc 1.98.0", cargo: "cargo 1.98.0" });
const key = (over = {}) => computeBuildKey({ files: files(), toolchain: toolchain(), mode: "debug", ...over });

describe("which files are build inputs", () => {
  it.each([
    "src/main.tsx", "src/new/untracked-file.ts", "src/askVault/x.ts", "src/mobilePreviewFixtures.ts", "src-tauri/src/commands.rs", "src-tauri/capabilities/default.json", "core/src/store/accounts.rs", "Cargo.toml", "Cargo.lock",
    "package.json", "package-lock.json", "vite.config.ts", "vite.mobile.config.ts", "tsconfig.json", "tsconfig.node.json", "index.html", "public/icon.svg", "src-tauri/tauri.conf.json", "rust-toolchain.toml", "src-tauri/build.rs", "src-tauri/Cargo.toml",
  ])("%s changes what gets built", path => expect(isBuildInput(path)).toBe(true));
  it.each(["README.md", "e2e/feature1_x.mjs", "e2e/run-all.mjs", "docs/notes.md", ".github/workflows/release-windows.yml", "e2e/.e2e-durations.json", "target/debug/vaultspend.exe", "node_modules/x/index.js"])(
    "%s does not", path => expect(isBuildInput(path)).toBe(false));
  it("treats Windows separators the same as forward slashes", () => expect(isBuildInput("src\\askVault\\a.ts")).toBe(true));
});

describe("test-only files are not application build inputs (owner decision 20 Oct 2026)", () => {
  it.each([
    "src/askVault/useRetirementScenario.test.tsx", "src/format.test.ts", "src\\askVault\\a.test.ts", "src/testSupport/render.tsx", "src/cssTestUtils.ts", "src/menuSelectTestUtils.ts", "src/statementTestUtils.ts",
    "core/src/store/tests.rs", "core/src/store/tests/accounts.rs", "core/src/store/tests/ask_vault_retirement_fixtures.json",
  ])("%s is test-only and cannot change the executable", path => { expect(isTestOnlyFile(path)).toBe(true); expect(isBuildInput(path)).toBe(false); });
  it.each(["src/main.tsx", "src/askVault/useRetirementScenario.ts", "src/mobilePreviewFixtures.ts", "src/setupTemplate.ts", "src/ledgerHelpers.ts", "core/src/store.rs", "core/src/store/accounts.rs", "src-tauri/src/lib.rs", "src/testament.ts", "src/latest.tsx"])(
    "%s is not test-only", path => { expect(isTestOnlyFile(path)).toBe(false); expect(isBuildInput(path)).toBe(true); });
  it("a test-only edit leaves the application key unchanged and a production edit changes it", () => {
    const withTests = { ...files(), "src/askVault/useRetirementScenario.test.tsx": "t1", "core/src/store/tests/accounts.rs": "t2" };
    expect(key({ files: withTests })).toBe(key());
    expect(key({ files: { ...withTests, "src/askVault/useRetirementScenario.test.tsx": "edited" } })).toBe(key());
    expect(key({ files: { ...withTests, "src/askVault/useRetirementScenario.ts": "edited" } })).not.toBe(key());
  });
  it("adding or deleting a test file does not change the application key", () => {
    expect(key({ files: { ...files(), "src/new.test.ts": "x" } })).toBe(key());
    expect(diffInputs(files(), { ...files(), "src/new.test.ts": "x" })).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe("test and harness identity is tracked separately", () => {
  const harness = () => ({ "src/a.test.ts": "1", "e2e/run-all.mjs": "2", "e2e/lib/harness.mjs": "3", "core/src/store/tests/accounts.rs": "4" });
  it("covers test files, the desktop harness and the runner, and not application sources or documents", () => {
    for (const p of Object.keys(harness())) expect(isHarnessInput(p), p).toBe(true);
    for (const p of ["src/main.tsx", "core/src/store.rs", "README.md", "docs/x.md", "e2e/.e2e-durations.json", "target/debug/vaultspend.exe"]) expect(isHarnessInput(p), p).toBe(false);
  });
  it("changes when a test or harness file changes, and not when an application file changes", () => {
    const base = computeTestKey({ files: { ...files(), ...harness() } });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    for (const name of Object.keys(harness())) expect(computeTestKey({ files: { ...files(), ...harness(), [name]: "changed" } }), name).not.toBe(base);
    expect(computeTestKey({ files: { ...files(), ...harness(), "src/main.tsx": "changed" } })).toBe(base);
    expect(computeTestKey({ files: { ...files(), ...harness(), "src/new.test.ts": "x" } })).not.toBe(base);
  });
});

describe("the exclusion only removes files the application really does not compile", () => {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (["node_modules", "target"].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
  const rel = file => path.relative(repo, file).replaceAll("\\", "/");
  it("no production module under src/ imports a test-only file (so none is compiled into the app)", () => {
    const everything = walk(path.join(repo, "src")).map(rel), sources = everything.filter(f => /\.(ts|tsx)$/.test(f));
    const testOnly = everything.filter(isTestOnlyFile), production = sources.filter(f => !isTestOnlyFile(f));
    expect(testOnly.length).toBeGreaterThan(50);
    const offenders = [];
    for (const file of production) {
      const text = fs.readFileSync(path.join(repo, file), "utf8");
      for (const target of testOnly) {
        const base = path.posix.basename(target).replace(/\.(ts|tsx|json)$/, "");
        // from "./x", bare import "./x", import("./x") and require("./x"), with or without an extension or a ?query
        if (new RegExp(`(?:from|import|require)\\s*\\(?\\s*["'][^"']*/${base}(?:\\.(?:tsx?|json))?(?:\\?[^"']*)?["']`).test(text)) offenders.push(`${file} imports ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("every Rust test module excluded from the key is declared #[cfg(test)], so it is not compiled into the app", () => {
    const rust = walk(path.join(repo, "core", "src")).map(rel).filter(f => f.endsWith(".rs"));
    const declared = rust.filter(f => /(?:^|\/)(?:tests\.rs|[^/]*_tests\.rs)$/.test(f));
    expect(declared.length).toBeGreaterThan(1);
    for (const file of declared) {
      const name = path.posix.basename(file, ".rs");
      const declaration = new RegExp(`^\\s*(?:pub\\s+)?mod\\s+${name}\\s*;`);
      const owners = rust.filter(other => other !== file && fs.readFileSync(path.join(repo, other), "utf8").split(/\r?\n/).some(l => declaration.test(l)));
      expect(owners.length, file).toBeGreaterThan(0);
      for (const owner of owners) {
        const lines = fs.readFileSync(path.join(repo, owner), "utf8").split(/\r?\n/), at = lines.findIndex(l => declaration.test(l));
        expect(lines[at - 1], `${owner} declares ${name}`).toMatch(/#\[cfg\(test\)\]/);
      }
    }
  });
});

describe("the build key", () => {
  it("is stable, and independent of the order the files were listed", () => {
    const reversed = Object.fromEntries(Object.entries(files()).reverse());
    expect(key({ files: reversed })).toBe(key());
    expect(key()).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when any input file's content changes (frontend, native, config, lockfile)", () => {
    for (const name of Object.keys(files())) expect(key({ files: { ...files(), [name]: "changed" } }), name).not.toBe(key());
  });
  it("changes when an input file is added, deleted or renamed (untracked and deleted files count)", () => {
    expect(key({ files: { ...files(), "src/untracked.ts": "zz" } })).not.toBe(key());
    const { "src/main.tsx": removed, ...without } = files(); void removed;
    expect(key({ files: without })).not.toBe(key());
    expect(key({ files: { ...without, "src/renamed.tsx": "a1" } })).not.toBe(key()); // same content, new name
  });
  it("ignores files that are not build inputs", () => {
    expect(key({ files: { ...files(), "README.md": "x", "e2e/run-all.mjs": "y", "docs/a.md": "z" } })).toBe(key());
  });
  it("changes with the toolchain and the build mode", () => {
    expect(key({ toolchain: { ...toolchain(), rustc: "rustc 1.99.0" } })).not.toBe(key());
    expect(key({ toolchain: { ...toolchain(), node: "v22.21.0" } })).not.toBe(key());
    expect(key({ toolchain: { ...toolchain(), cargo: "cargo 1.99.0" } })).not.toBe(key());
    expect(key({ mode: "release" })).not.toBe(key());
  });
  it("is not a function of HEAD: the same HEAD with different content differs, different HEADs with the same content match", () => {
    expect(key({ head: "aaa" })).toBe(key({ head: "bbb" }));
    expect(key({ head: "aaa", files: { ...files(), "src/main.tsx": "other" } })).not.toBe(key({ head: "aaa" }));
  });
  it("refuses an incomplete description rather than hashing a partial one", () => {
    expect(() => computeBuildKey({ files: files(), mode: "debug" })).toThrow(/toolchain/i);
    expect(() => computeBuildKey({ files: files(), toolchain: toolchain() })).toThrow(/mode/i);
    expect(() => computeBuildKey({ toolchain: toolchain(), mode: "debug" })).toThrow(/files/i);
    expect(() => computeBuildKey({ files: files(), toolchain: { node: "v22" }, mode: "debug" })).toThrow(/toolchain/i);
  });
});

describe("what changed between two snapshots", () => {
  it("names added, removed and changed build inputs, and nothing else", () => {
    const after = { ...files(), "src/new.ts": "n1", "README.md": "x" };
    delete after["core/src/store.rs"]; after["src/main.tsx"] = "a1-changed";
    expect(diffInputs(files(), after)).toEqual({ added: ["src/new.ts"], removed: ["core/src/store.rs"], changed: ["src/main.tsx"] });
  });
  it("is empty when only non-inputs differ", () => expect(diffInputs(files(), { ...files(), "docs/x.md": "1" })).toEqual({ added: [], removed: [], changed: [] }));
});

describe("verifying a recorded executable", () => {
  let dir, exe, record;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-artifact-")); exe = path.join(dir, "app.exe"); record = path.join(dir, "artifact.json"); fs.writeFileSync(exe, "binary-v1"); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it("is fresh when the inputs and the executable match what was recorded", () => {
    recordArtifact({ exePath: exe, recordPath: record, key: key(), builtAt: "2026-10-19T00:00:00Z" });
    expect(verifyArtifact({ exePath: exe, recordPath: record, currentKey: key() })).toMatchObject({ status: "fresh", exeSha256: expect.stringMatching(/^[0-9A-F]{64}$/) });
  });
  it("is stale when an input changed after the build, and says the inputs differ", () => {
    recordArtifact({ exePath: exe, recordPath: record, key: key() });
    const result = verifyArtifact({ exePath: exe, recordPath: record, currentKey: key({ files: { ...files(), "src/main.tsx": "edited" } }) });
    expect(result.status).toBe("stale");
    expect(result.reason).toMatch(/inputs/i);
  });
  it("is changed when the executable was replaced after it was recorded, even if the inputs match", () => {
    recordArtifact({ exePath: exe, recordPath: record, key: key() });
    fs.writeFileSync(exe, "binary-v2");
    expect(verifyArtifact({ exePath: exe, recordPath: record, currentKey: key() })).toMatchObject({ status: "changed" });
  });
  it("is unknown (never silently fresh) when nothing was recorded", () => {
    expect(verifyArtifact({ exePath: exe, recordPath: record, currentKey: key() })).toMatchObject({ status: "unknown" });
  });
  it("is unknown when the record cannot be read", () => {
    fs.writeFileSync(record, "{ broken");
    expect(verifyArtifact({ exePath: exe, recordPath: record, currentKey: key() })).toMatchObject({ status: "unknown" });
  });
  it("is missing when there is no executable at all", () => {
    recordArtifact({ exePath: exe, recordPath: record, key: key() });
    fs.rmSync(exe);
    expect(verifyArtifact({ exePath: exe, recordPath: record, currentKey: key() })).toMatchObject({ status: "missing" });
  });
  it("recording refuses a missing executable", () => {
    fs.rmSync(exe);
    expect(() => recordArtifact({ exePath: exe, recordPath: record, key: key() })).toThrow();
  });
});
