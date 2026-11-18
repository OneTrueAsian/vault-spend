// The Tauri CLI rewrites src-tauri/Cargo.toml during every build whenever the file's bytes differ from its own LF serialization
// (tauri-cli rewrite_manifest compares strings exactly). A CRLF checkout therefore gets rewritten mid-build, and the build guard
// (buildApp.mjs) correctly refuses to record an executable whose inputs changed while it compiled. Checking the manifest out
// with LF on every machine keeps the first build in a fresh checkout or worktree from being refused.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let outDir;
afterEach(() => { if (outDir) fs.rmSync(outDir, { recursive: true, force: true }); });

describe("Tauri manifest checkout", () => {
  it("checks src-tauri/Cargo.toml out with LF line endings, matching what the Tauri CLI writes", () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-manifest-eol-"));
    // checkout-index applies this machine's real checkout conversion (core.autocrlf, .gitattributes) to the indexed file.
    execFileSync("git", ["checkout-index", `--prefix=${outDir.replace(/\\/g, "/")}/`, "--", "src-tauri/Cargo.toml"], { cwd: repoRoot });
    const bytes = fs.readFileSync(path.join(outDir, "src-tauri", "Cargo.toml"));
    expect(bytes.includes(13)).toBe(false);
  });
});
