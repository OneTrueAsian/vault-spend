import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Execute the actual demo's build orchestration with process/file boundaries replaced; never launch or seed a demo.
const source = fs.readFileSync("e2e/demo.mjs", "utf8");
const buildSection = source.slice(source.indexOf("function run("), source.indexOf("// A demo already running"));
function execute(fail = false) {
  const calls = [];
  const context = { args: new Set(["--build"]), exe: "fixture.exe", initDb: "fixture-init.exe", repoRoot: "fixture-root",
    fs: { existsSync: () => false }, console: { log() {}, error() {} },
    spawnSync: (cmd, args) => { calls.push([cmd, ...args]); return { status: fail ? 9 : 0 }; },
    process: { exit: code => { throw new Error(`fixture exit ${code}`); } } };
  let error;
  try { vm.runInNewContext(buildSection, context); } catch (e) { error = e; }
  return { calls: JSON.parse(JSON.stringify(calls)), error };
}
describe("repository demo build paths cooperate with exclusive access", () => {
  it("uses the provenance builder and wraps the seeding-helper Cargo build", () => {
    const { calls, error } = execute();
    expect(error).toBeUndefined();
    expect(calls).toEqual([
      ["npm", "run", "build:app", "--", "--force"],
      ["node", "e2e/with-access.mjs", "demo-init-db", "--", "cargo", "build", "-p", "budget_core", "--bin", "init_db"],
    ]);
  });
  it("does not continue to another target operation when the protected build fails", () => {
    const { calls, error } = execute(true);
    expect(error.message).toBe("fixture exit 9"); expect(calls).toHaveLength(1);
  });
});

describe("the actual compiler callback rechecks output policy after waiting for access", () => {
  function callback(validate, spawn) {
    const source = fs.readFileSync("e2e/build-app.mjs", "utf8");
    const body = source.slice(source.indexOf("const runBuild ="), source.indexOf("\ntry {"));
    const context = vm.createContext({ Promise, assertBuildOutput: validate, repoRoot: "fixture-root", exePath: "fixture-exe", spawn });
    vm.runInContext(body + ";globalThis.run=runBuild;", context);
    return context.run;
  }
  it("validates immediately before spawning the compiler, not only before taking access", async () => {
    let checked = 0;
    const run = callback(() => checked++, () => {
      expect(checked).toBe(1);
      return { on: (event, action) => { if (event === "close") action(0); } };
    });
    await run();
  });
  it("never starts compilation when the output policy changed while waiting", async () => {
    let spawned = 0;
    const run = callback(() => { throw new Error("new config override"); }, () => { spawned++; });
    await expect(run()).rejects.toThrow("new config override"); expect(spawned).toBe(0);
  });
});
