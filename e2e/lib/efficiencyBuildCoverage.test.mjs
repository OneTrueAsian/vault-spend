import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as identity from "./buildIdentity.mjs";

const toolchain = { node: "fixture-node", rustc: "fixture-rust", cargo: "fixture-cargo" };
const key = files => identity.computeBuildKey({ files, toolchain, mode: "debug" });
let repo;
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "vs-build-closure-")); execFileSync("git", ["init", "-q"], { cwd: repo }); });
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));
const write = (file, value) => { const name = path.join(repo, file); fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, value); };
const collect = (environment = {}) => identity.collectInputs(repo, { environment });

describe("F2: complete reviewed build-input roots", () => {
  it.each(["mobile/index.html", "tools/mobile-offline-build.ts", "tools/mobile-icons.ts", ".cargo/config.toml", ".cargo/config", ".env", ".env.production.local"])("includes %s", file => {
    write(file, "before"); const before = key(collect()); write(file, "after");
    expect(key(collect())).not.toBe(before);
  });
  it("tracks ignored dotenv files without exposing their contents in the input manifest", () => {
    write(".gitignore", ".env*\n"); write(".env.production.local", "VITE_BUILD_INPUT=private-value");
    const inputs = collect(); expect(inputs[".env.production.local"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(inputs)).not.toContain("private-value");
  });
  it.each(["RUSTFLAGS", "CARGO_PROFILE_DEV_OPT_LEVEL", "VITE_FIXTURE_BUILD_SETTING", "TAURI_CONFIG", "CARGO_TARGET_DIR"])("includes %s without storing raw values", setting => {
    const before = collect({ [setting]: "first-sensitive-value" }), after = collect({ [setting]: "second-sensitive-value" });
    expect(key(after)).not.toBe(key(before)); expect(JSON.stringify(after)).not.toContain("second-sensitive-value");
  });
  it("does not confuse diagnostic Axe settings with application build inputs", () => {
    expect(key(collect({ VAULTSPEND_AXE_REUSE: "0" }))).toBe(key(collect({ VAULTSPEND_AXE_REUSE: "1" })));
  });
  it("detects imported tools beyond the explicit reviewed closure instead of silently reusing an incomplete key", () => {
    write("vite.mobile.config.ts", 'import "./tools/not-yet-reviewed";'); write("tools/not-yet-reviewed.ts", "export const value=1;");
    expect(() => collect()).toThrow(/build input|dependenc/i);
  });
  it("checks transitive build-tool imports too", () => {
    write("vite.mobile.config.ts", 'import "./tools/mobile-offline-build";');
    write("tools/mobile-offline-build.ts", 'import "./mobile-icons";');
    write("tools/mobile-icons.ts", 'import "./new-unreviewed-generator";'); write("tools/new-unreviewed-generator.ts", "export const color=1;");
    expect(() => collect()).toThrow(/build input|dependenc/i);
  });
  it("treats relative imports into installed packages like bare package imports, while retaining the lockfile identity", () => {
    write("src/invoke.ts", 'export * from "../node_modules/@tauri-apps/api/core.js";');
    write("node_modules/@tauri-apps/api/core.js", "export const invoke=()=>{};");
    write("package-lock.json", '{"lockfileVersion":3,"packages":{}}');
    const before = key(collect());
    write("package-lock.json", '{"lockfileVersion":3,"packages":{"changed":{}}}');
    expect(key(collect())).not.toBe(before);
  });
  it("tracks config deletion and config changes outside the repository", () => {
    const cargoHome = path.join(repo, "private-cargo-home"); write("private-cargo-home/config.toml", '[build]\nrustflags=["--cfg=before"]');
    const before = key(collect({ CARGO_HOME: cargoHome })); write("private-cargo-home/config.toml", '[build]\nrustflags=["--cfg=after"]');
    expect(key(collect({ CARGO_HOME: cargoHome }))).not.toBe(before);
    fs.unlinkSync(path.join(cargoHome, "config.toml")); expect(key(collect({ CARGO_HOME: cargoHome }))).not.toBe(before);
  });
  it("tracks inherited Cargo configuration rather than silently accepting an ancestor edit", () => {
    // Use an isolated nested checkout; never modify an actual ancestor of the developer repository.
    const parent = repo;
    const nested = path.join(parent, "nested"); fs.mkdirSync(nested);
    execFileSync("git", ["init", "-q"], { cwd: nested });
    write(".cargo/config.toml", '[build]\nrustflags=["--cfg=before"]');
    const before = key(identity.collectInputs(nested, { environment: {} }));
    write(".cargo/config.toml", '[build]\nrustflags=["--cfg=after"]');
    expect(key(identity.collectInputs(nested, { environment: {} }))).not.toBe(before);
    fs.unlinkSync(path.join(parent, ".cargo/config.toml"));
    expect(key(identity.collectInputs(nested, { environment: {} }))).not.toBe(before);
  });
  it("includes ignored repository Cargo configuration without exposing its values", () => {
    write(".gitignore", ".cargo/\n"); write(".cargo/config.toml", '[build]\nrustflags=["secret-config"]');
    const inputs = collect();
    expect(Object.keys(inputs).some(k => k.includes("cargo-ancestor"))).toBe(true);
    expect(JSON.stringify(inputs)).not.toContain("secret-config");
  });
  it("also tracks ignored Cargo configuration in Tauri's backend invocation directory", () => {
    write(".gitignore", ".cargo/\n"); write("src-tauri/.cargo/config.toml", '[build]\nrustflags=["--cfg=before"]');
    const before = key(collect());
    write("src-tauri/.cargo/config.toml", '[build]\nrustflags=["--cfg=after"]');
    expect(key(collect())).not.toBe(before);
  });
  it.each(['[build]\ntarget-dir="elsewhere"', '[build]\ntarget="another-architecture"', 'build={target-dir="elsewhere"}', '"build"."target-dir"="elsewhere"'])("refuses a Cargo-config output override before recording an old host executable: %s", config => {
    write("src-tauri/.cargo/config.toml", config);
    expect(() => identity.assertBuildOutput({ repoRoot: repo, exePath: path.join(repo, "target/debug/vaultspend.exe"), environment: { CARGO_HOME: path.join(repo, "empty-home") } })).toThrow(/config|target|output/i);
  });
  it("rejects output overrides the fixed Tauri build wrapper does not implement", () => {
    expect(typeof identity.assertBuildOutput).toBe("function");
    for (const environment of [{ CARGO_BUILD_TARGET: "other-target" }, { CARGO_TARGET_DIR: "another-target" }])
      expect(() => identity.assertBuildOutput({ repoRoot: repo, exePath: path.join(repo, "target/debug/vaultspend.exe"), environment })).toThrow(/target|output/i);
    expect(() => identity.assertBuildOutput({ repoRoot: repo, exePath: path.join(repo, "old-copy.exe"), environment: {} })).toThrow(/output/i);
    expect(() => identity.assertBuildOutput({ repoRoot: repo, exePath: path.join(repo, "target/debug/vaultspend.exe"), environment: {} })).not.toThrow();
  });
});
