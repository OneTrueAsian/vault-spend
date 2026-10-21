// R4: `verify:fast` and `verify:full`. The fast path keeps every required cheap check (tsc, lint, the FULL unit suite) and adds only the
// native checks and desktop specs the change can reach; the full path runs everything. Neither is milestone or release acceptance, and
// the report keeps executed, reused, skipped and outstanding checks apart. The executor is injected, so nothing real is run here.
import { describe, expect, it } from "vitest";
import { formatReport, planVerification, runPlan } from "./verifyPlan.mjs";

const specs = ["smoke.mjs", "feature304_ask_vault_retirement_flow.mjs", "feature5_tags.mjs"];
const selection = (over = {}) => ({ broad: false, specs: ["smoke.mjs", "feature304_ask_vault_retirement_flow.mjs"], entries: [{ path: "src/askVault/x.ts", verdict: "area", reason: "Ask the Vault" }], required: [], outstanding: ["A full desktop suite is still required for milestone or release acceptance."], notes: [], ...over });
const ids = plan => plan.steps.map(s => s.id);
const okExec = (calls = []) => async step => { calls.push(step.id); return { code: 0, reused: step.id === "build" ? true : undefined }; };

describe("planning the fast path", () => {
  it("always includes tsc, lint and the FULL unit suite, never a reduced one", () => {
    const plan = planVerification({ mode: "fast", selection: selection(), allSpecs: specs });
    expect(ids(plan)).toEqual(expect.arrayContaining(["tsc", "lint", "npm-test"]));
    const unit = plan.steps.find(s => s.id === "npm-test");
    expect(unit.command.join(" ")).toBe("npm test");
  });
  it("adds the build and exactly the selected specs when the change reaches the desktop", () => {
    const plan = planVerification({ mode: "fast", selection: selection(), allSpecs: specs });
    expect(ids(plan)).toEqual(expect.arrayContaining(["build", "desktop"]));
    expect(plan.steps.find(s => s.id === "desktop").command.join(" ")).toContain("--spec=smoke.mjs,feature304_ask_vault_retirement_flow.mjs");
  });
  it("runs desktop specs with the classified schedule, so exclusive specs run alone (the safe schedule, whatever the runner's default)", () => {
    for (const mode of ["fast", "full"]) {
      const plan = planVerification({ mode, selection: selection(), allSpecs: specs });
      expect(plan.steps.find(s => s.id === (mode === "fast" ? "desktop" : "desktop-full")).command.join(" ")).toContain("--schedule=classified");
    }
  });
  it("builds before it runs desktop specs, and runs unit checks before the build", () => {
    const order = ids(planVerification({ mode: "fast", selection: selection(), allSpecs: specs }));
    expect(order.indexOf("npm-test")).toBeLessThan(order.indexOf("build")); expect(order.indexOf("build")).toBeLessThan(order.indexOf("desktop"));
  });
  it("a documentation-only change runs the unit checks and skips the desktop, saying why", () => {
    const plan = planVerification({ mode: "fast", selection: selection({ specs: [], entries: [{ path: "README.md", verdict: "no-desktop", reason: "Documentation" }] }), allSpecs: specs });
    expect(ids(plan)).not.toContain("desktop"); expect(ids(plan)).not.toContain("build");
    expect(plan.skipped.map(s => s.id)).toEqual(expect.arrayContaining(["build", "desktop"]));
    expect(plan.skipped.find(s => s.id === "desktop").reason).toMatch(/no desktop spec/i);
  });
  it("a native change adds the Rust checks, run through exclusive access, before the build", () => {
    const plan = planVerification({ mode: "fast", selection: selection({ required: ["cargo test -p budget_core -- --test-threads=1 (run through npm run access)", "cargo fmt --all -- --check"] }), allSpecs: specs });
    const rust = plan.steps.filter(s => s.id.startsWith("cargo"));
    expect(rust.length).toBeGreaterThan(0);
    for (const step of rust) expect(step.command.join(" ")).toMatch(/with-access|npm run access/);
    expect(ids(plan).indexOf("build")).toBeGreaterThan(ids(plan).lastIndexOf(rust.at(-1).id));
  });
  it("a change without native files skips the Rust checks and names the reason", () => {
    const plan = planVerification({ mode: "fast", selection: selection(), allSpecs: specs });
    expect(plan.skipped.find(s => s.id === "cargo")?.reason).toMatch(/no native/i);
  });
  it("a broad selection runs every spec: the runner is given no --spec filter at all, so a newly added spec cannot be left out", () => {
    const plan = planVerification({ mode: "fast", selection: selection({ broad: true, specs }), allSpecs: specs });
    const step = plan.steps.find(s => s.id === "desktop");
    expect(step.command.join(" ")).not.toContain("--spec"); expect(step.label).toMatch(/every spec/i);
  });
  it("no changes at all still runs the unit checks and selects no desktop", () => {
    const plan = planVerification({ mode: "fast", selection: selection({ specs: [], entries: [], notes: ["No changes against the baseline, so nothing is selected."] }), allSpecs: specs });
    expect(ids(plan)).toEqual(expect.arrayContaining(["tsc", "lint", "npm-test"])); expect(ids(plan)).not.toContain("desktop");
  });
  it("fast never lists the full desktop suite as executed", () => {
    expect(planVerification({ mode: "fast", selection: selection(), allSpecs: specs }).skipped.map(s => s.id)).toContain("desktop-full");
  });
});

describe("planning the full path", () => {
  const plan = planVerification({ mode: "full", selection: selection(), allSpecs: specs });
  it("runs every check, Rust included, and the whole desktop suite", () => {
    expect(ids(plan)).toEqual(expect.arrayContaining(["tsc", "lint", "npm-test", "cargo-fmt", "cargo-clippy", "cargo-test-core", "cargo-test-commands", "build", "smoke", "desktop-full"]));
    expect(plan.skipped).toEqual([]);
  });
  it("runs the desktop suite without a --spec filter", () => {
    expect(plan.steps.find(s => s.id === "desktop-full").command.join(" ")).not.toContain("--spec");
  });
  it("passes a chosen concurrency through to the runner", () => {
    const custom = planVerification({ mode: "full", selection: selection(), allSpecs: specs, concurrency: 1 });
    expect(custom.steps.find(s => s.id === "desktop-full").command.join(" ")).toContain("--concurrency=1");
  });
  it.each(["fast", "full"])("never claims to be acceptance (%s)", mode => {
    expect(planVerification({ mode, selection: selection(), allSpecs: specs }).disclaimer).toMatch(/not (milestone|release)/i);
  });
  it("refuses an unknown mode", () => expect(() => planVerification({ mode: "quick", selection: selection(), allSpecs: specs })).toThrow(/mode/));
});

describe("running a plan", () => {
  it("runs the steps in order and reports every one as executed", async () => {
    const calls = [], plan = planVerification({ mode: "fast", selection: selection(), allSpecs: specs });
    const result = await runPlan({ plan, exec: okExec(calls) });
    expect(calls).toEqual(ids(plan)); expect(result.code).toBe(0);
    expect(result.executed.map(s => s.id)).toEqual(expect.arrayContaining(["tsc", "desktop"]));
  });
  it("a reused build is reported as reused, not as executed", async () => {
    const result = await runPlan({ plan: planVerification({ mode: "fast", selection: selection(), allSpecs: specs }), exec: okExec() });
    expect(result.reused.map(s => s.id)).toEqual(["build"]); expect(result.executed.map(s => s.id)).not.toContain("build");
  });
  it("stops at the first failing step, reports the rest as not run, and exits non-zero", async () => {
    const plan = planVerification({ mode: "fast", selection: selection(), allSpecs: specs }), calls = [];
    const result = await runPlan({ plan, exec: async step => { calls.push(step.id); return { code: step.id === "lint" ? 1 : 0 }; } });
    expect(result.code).toBe(1);
    expect(calls.at(-1)).toBe("lint");
    expect(result.notRun.map(s => s.id)).toEqual(ids(plan).slice(ids(plan).indexOf("lint") + 1));
    expect(result.failed.map(s => s.id)).toEqual(["lint"]);
  });
  it("passes a runner's own non-zero code (2 refused, 3 invalid evidence) through", async () => {
    const plan = planVerification({ mode: "fast", selection: selection(), allSpecs: specs });
    expect((await runPlan({ plan, exec: async step => ({ code: step.id === "desktop" ? 3 : 0 }) })).code).toBe(3);
  });
  it("an executor that throws is a failure of that step", async () => {
    const plan = planVerification({ mode: "fast", selection: selection(), allSpecs: specs });
    const result = await runPlan({ plan, exec: async step => { if (step.id === "tsc") throw new Error("spawn failed"); return { code: 0 }; } });
    expect(result.code).toBe(1); expect(result.failed[0]).toMatchObject({ id: "tsc" }); expect(result.failed[0].error).toMatch(/spawn failed/);
  });
});

describe("the report", () => {
  const report = async (mode, over = {}, exec = okExec()) => {
    const plan = planVerification({ mode, selection: selection(over), allSpecs: specs });
    return formatReport({ plan, result: await runPlan({ plan, exec }), selection: selection(over) });
  };
  it("leads with what this is not", async () => {
    const text = await report("fast");
    expect(text.split("\n")[0]).toMatch(/FAST VERIFICATION/); expect(text).toMatch(/not milestone or release acceptance/i);
  });
  it("keeps executed, reused, skipped and outstanding in separate labelled sections", async () => {
    const text = await report("fast");
    for (const heading of ["EXECUTED", "REUSED", "SKIPPED", "OUTSTANDING"]) expect(text).toContain(heading);
    expect(text.indexOf("EXECUTED")).toBeLessThan(text.indexOf("REUSED")); expect(text.indexOf("SKIPPED")).toBeLessThan(text.indexOf("OUTSTANDING"));
  });
  it("lists the selected specs with the reason for each file", async () => {
    const text = await report("fast");
    expect(text).toContain("feature304_ask_vault_retirement_flow.mjs"); expect(text).toContain("src/askVault/x.ts"); expect(text).toMatch(/Ask the Vault/);
  });
  it("a failed run says FAILED and names the step", async () => {
    const text = await report("fast", {}, async step => ({ code: step.id === "npm-test" ? 1 : 0 }));
    expect(text).toMatch(/FAILED/); expect(text).toMatch(/npm-test/); expect(text).not.toMatch(/ALL CHECKS PASSED/);
  });
  it("a passing fast run still lists outstanding acceptance work", async () => {
    const text = await report("fast");
    expect(text).toMatch(/PASSED/); expect(text).toMatch(/full desktop suite is still required/i);
  });
  it("the full report names its own limit too", async () => {
    expect((await report("full")).split("\n")[0]).toMatch(/FULL VERIFICATION/);
    expect(await report("full")).toMatch(/mutation|performance|hosted/i);
  });
});
