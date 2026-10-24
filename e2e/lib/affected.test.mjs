// R3: choose the desktop specs a change can affect, conservatively. Unknown files and shared infrastructure select EVERYTHING; a file is
// narrowed only by an explicit, reviewed rule in e2e/affected-map.json. Smoke accompanies any desktop selection. The comparison
// baseline is a git ref (default HEAD); modified, added, deleted, renamed and untracked files all count.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectChanges, loadMap, selectAffected, validateMap } from "./affected.mjs";
import { discoverSpecs } from "./specAudit.mjs";
import { isBuildInput } from "./buildIdentity.mjs";

const e2eDir = path.resolve("e2e");
const specs = discoverSpecs(e2eDir);
const map = loadMap(path.join(e2eDir, "affected-map.json"));
const change = (file, status = "M", oldPath) => ({ status, path: file, ...(oldPath ? { oldPath } : {}) });
const select = (...changes) => selectAffected({ changes, specs, map, e2eDir });
const askSpecs = specs.filter(name => /ask_vault|feature305_|transaction_qa|dashboard_order|financial_snapshot/.test(name));

describe("a change confined to the Ask the Vault area", () => {
  it.each(["src/RetirementScenarioDialog.tsx", "src/RetirementScenarioDialog.css", "src/askVault/useRetirementScenario.ts", "src/AskVaultCard.tsx", "src/askVault/retirementParser.ts"])(
    "%s selects the Ask the Vault specs and smoke, not the whole suite", file => {
      const result = select(change(file));
      expect(result.broad).toBe(false);
      expect(result.specs).toContain("smoke.mjs");
      for (const name of ["feature304_ask_vault_retirement_flow.mjs", "feature306_ask_vault_retirement_lifecycle.mjs", "feature307_ask_vault_retirement_os_focus.mjs", "feature305_screens_default_dark_720.mjs"]) expect(result.specs).toContain(name);
      expect(result.specs.length).toBeLessThan(specs.length / 3);
      expect(result.specs).not.toContain("feature5_tags.mjs");
    });
  it("every selected spec exists, once", () => {
    const result = select(change("src/askVault/retirementParser.ts"));
    expect(new Set(result.specs).size).toBe(result.specs.length);
    for (const name of result.specs) expect(specs).toContain(name);
  });
  it("explains each file: what it matched and why", () => {
    const result = select(change("src/askVault/retirementParser.ts"));
    expect(result.entries).toEqual([expect.objectContaining({ path: "src/askVault/retirementParser.ts", verdict: "area", reason: expect.stringMatching(/Ask the Vault/i) })]);
  });
  it("a native Ask the Vault file selects the same specs and requires the Rust and TypeScript contract checks (the boundary is not visible to import analysis)", () => {
    const result = select(change("core/src/store/ask_vault_retirement.rs"));
    expect(result.broad).toBe(false);
    for (const name of askSpecs) expect(result.specs).toContain(name);
    expect(result.required.join(" ")).toMatch(/cargo test/);
    expect(result.required.join(" ")).toMatch(/retirementNativeContract|npm test/);
  });
  it("the TypeScript side of the native contract requires the Rust checks too", () => {
    expect(select(change("src/askVault/retirementNativeContract.ts")).required.join(" ")).toMatch(/cargo test/);
  });
});

describe("new, deleted and renamed files", () => {
  it("a new untracked file in the area is selected by its path", () => {
    expect(select(change("src/askVault/retirementBrandNew.ts", "A")).broad).toBe(false);
  });
  it("a new file with no rule is unknown, so it selects everything", () => {
    const result = select(change("src/someBrandNewView.tsx", "A"));
    expect(result.broad).toBe(true); expect(result.specs).toEqual(specs);
    expect(result.entries[0]).toMatchObject({ verdict: "unknown" });
  });
  it("a deleted file is judged by its old path", () => {
    expect(select(change("src/askVault/retirementOldThing.ts", "D")).broad).toBe(false);
    expect(select(change("src/someRemovedView.tsx", "D")).broad).toBe(true);
  });
  it("a rename is judged by both paths: moving an unknown file into the area is still broad", () => {
    expect(select(change("src/askVault/retirementMoved.ts", "R", "src/askVault/retirementOld.ts")).broad).toBe(false);
    expect(select(change("src/askVault/retirementMoved.ts", "R", "src/BudgetView.tsx")).broad).toBe(true);
    expect(select(change("src/Elsewhere.tsx", "R", "src/askVault/retirementOld.ts")).broad).toBe(true);
  });
});

describe("shared infrastructure, persistence and the harness keep broad coverage", () => {
  it.each([
    "src/main.tsx", "src/App.tsx", "src/App.css", "src/SharedControls.css", "src/Modal.css", "src/tauriInvoke.ts", "src/contractChecks.ts",
    "vite.config.ts", "package.json", "package-lock.json", "tsconfig.json", "Cargo.lock", "Cargo.toml", "src-tauri/tauri.conf.json", "src-tauri/src/lib.rs", "src-tauri/src/commands.rs",
    "core/src/store.rs", "core/src/store/accounts.rs", "core/src/store/investments.rs",
    "e2e/harness.mjs", "e2e/run-all.mjs", "e2e/lib/scheduler.mjs", "e2e/lib/runGuard.mjs", "e2e/spec-classification.json", "e2e/affected-map.json",
  ])("%s selects every spec", file => {
    const result = select(change(file));
    expect(result.broad).toBe(true); expect(result.specs).toEqual(specs);
  });
  it("one broad file among narrow ones makes the whole selection broad", () => {
    expect(select(change("src/askVault/retirementParser.ts"), change("src/main.tsx")).broad).toBe(true);
  });
  it("anything the map does not know about is broad (no silent empty selection)", () => {
    for (const file of ["tools/some-script.mjs", "scripts/new.ps1", "src/unknown/Thing.tsx", "weird.bin"]) expect(select(change(file)).broad, file).toBe(true);
  });
});

describe("changes that need no desktop run", () => {
  it.each(["README.md", "docs/notes.md", "AGENTS.md", "src/askVault/retirementParser.test.ts", "src/AskVaultCard.test.tsx", "core/src/store/tests/ask_vault_retirement.rs", ".github/workflows/release-windows.yml"])(
    "%s selects no desktop spec and says why", file => {
      const result = select(change(file));
      expect(result.specs).toEqual([]);
      expect(result.broad).toBe(false);
      expect(result.entries[0]).toMatchObject({ verdict: "no-desktop" });
      expect(result.entries[0].reason.length).toBeGreaterThan(10);
    });
  it("no changes at all selects nothing, and says so", () => {
    const result = select();
    expect(result.specs).toEqual([]); expect(result.notes.join(" ")).toMatch(/no changes/i);
  });
  it("a workflow change still reports that the hosted gate must be reviewed", () => {
    expect(select(change(".github/workflows/release-windows.yml")).required.join(" ")).toMatch(/hosted|workflow/i);
  });
  it("a no-desktop file next to an area file selects only the area", () => {
    const result = select(change("README.md"), change("src/askVault/retirementParser.ts"));
    expect(result.specs).toContain("smoke.mjs"); expect(result.broad).toBe(false);
  });
});

describe("changes to a desktop spec or its helper", () => {
  it("a changed spec selects itself and smoke", () => {
    expect(select(change("e2e/feature5_tags.mjs")).specs.sort()).toEqual(["feature5_tags.mjs", "smoke.mjs"]);
  });
  it("a changed helper selects every spec that imports it, directly or through another helper", () => {
    const result = select(change("e2e/lib/askRetirement.mjs"));
    expect(result.broad).toBe(false);
    for (const name of ["feature306_ask_vault_retirement_lifecycle.mjs", "feature307_ask_vault_retirement_os_focus.mjs", "feature308_ask_vault_retirement_boundaries.mjs"]) expect(result.specs).toContain(name);
    expect(result.specs).not.toContain("feature5_tags.mjs");
    expect(result.specs).not.toContain("feature304_ask_vault_retirement_flow.mjs"); // only mentions the helper in a comment
  });
  it("a helper no spec imports is not silently ignored: it selects nothing but says so", () => {
    const result = select(change("e2e/lib/dates.test.mjs"));
    expect(result.entries[0].verdict).toBe("no-desktop");
  });
});

describe("what is still required for final acceptance", () => {
  it("always lists the checks a fast selection does not replace", () => {
    const result = select(change("src/askVault/retirementParser.ts"));
    const text = result.outstanding.join(" ");
    expect(text).toMatch(/full desktop/i); expect(text).toMatch(/milestone|release/i);
  });
  it("a broad selection says the whole desktop suite is selected, and lists nothing outstanding for it", () => {
    const result = select(change("src/main.tsx"));
    expect(result.outstanding.join(" ")).not.toMatch(/full desktop suite is still required/i);
  });
});

describe("files the app embeds from outside src/ (found by reading the source, not by a list)", () => {
  const embedded = () => {
    const found = new Set();
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
          for (const m of fs.readFileSync(full, "utf8").matchAll(/from\s*["'](\.{1,2}\/[^"']+)\?(?:raw|url)["']/g)) {
            const target = path.relative(path.resolve("."), path.resolve(path.dirname(full), m[1])).replaceAll("\\", "/");
            if (!target.startsWith("src/")) found.add(target);
          }
        }
      }
    };
    walk(path.resolve("src"));
    return [...found].sort();
  };
  it("finds the notices the app embeds", () => expect(embedded()).toEqual(expect.arrayContaining(["docs/LEGAL-NOTICE.md", "docs/THIRD-PARTY-NOTICES.txt"])));
  it("every one is a build input: editing it must make a recorded executable stale", () => {
    for (const file of embedded()) expect(isBuildInput(file), `${file} is compiled into the app but is not part of the build key`).toBe(true);
  });
  it("every one selects desktop coverage; none is treated as documentation that needs no desktop run", () => {
    for (const file of embedded()) {
      const result = select(change(file));
      expect(result.entries[0].verdict, file).not.toBe("no-desktop");
      expect(result.specs.length, file).toBeGreaterThan(0);
    }
  });
});

describe("the map itself", () => {
  it("is valid: every rule's spec selector matches at least one spec, and patterns are well formed", () => expect(validateMap(map, specs)).toEqual([]));
  it("flags a rule whose selector matches no spec", () => {
    const bad = { ...map, areas: [...map.areas, { pattern: "src/x/**", specs: ["no_such_spec_anywhere"], reason: "test" }] };
    expect(validateMap(bad, specs).join(" ")).toMatch(/no_such_spec_anywhere/);
  });
  it("flags a rule with no reason", () => {
    expect(validateMap({ ...map, areas: [{ pattern: "src/x/**", specs: ["smoke"] }] }, specs).join(" ")).toMatch(/reason/i);
  });
});

describe("collecting changes from git", () => {
  let repo;
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const write = (file, body) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), body); };
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "vs-affected-"));
    git("init", "-q"); git("config", "user.email", "t@example.com"); git("config", "user.name", "t"); git("config", "commit.gpgsign", "false");
    write("src/a.ts", "1\n".repeat(30)); write("src/b.ts", "2\n".repeat(30)); write("src/gone.ts", "3\n".repeat(30)); write("src/rename-me.ts", "unique rename content\n".repeat(30));
    git("add", "."); git("commit", "-q", "-m", "base");
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));
  it("reports modified, deleted, renamed (with the old path) and untracked files against HEAD", () => {
    write("src/a.ts", "changed\n"); fs.rmSync(path.join(repo, "src/gone.ts")); git("mv", "src/rename-me.ts", "src/renamed.ts"); write("src/new-untracked.ts", "x\n");
    const changes = collectChanges(repo, "HEAD");
    expect(changes).toEqual(expect.arrayContaining([
      { status: "M", path: "src/a.ts" }, { status: "D", path: "src/gone.ts" },
      { status: "R", path: "src/renamed.ts", oldPath: "src/rename-me.ts" }, { status: "A", path: "src/new-untracked.ts" },
    ]));
    expect(changes.find(c => c.path === "src/b.ts")).toBeUndefined();
  });
  it("compares against any ref, so a feature branch can be judged against its base", () => {
    write("src/a.ts", "committed change\n"); git("commit", "-qam", "next");
    expect(collectChanges(repo, "HEAD")).toEqual([]);
    expect(collectChanges(repo, "HEAD~1")).toEqual([{ status: "M", path: "src/a.ts" }]);
  });
  it("includes staged changes, and ignores files git ignores", () => {
    write(".gitignore", "ignored/\n"); write("ignored/x.ts", "x"); write("src/staged.ts", "s\n"); git("add", "src/staged.ts");
    const paths = collectChanges(repo, "HEAD").map(c => c.path);
    expect(paths).toContain("src/staged.ts"); expect(paths).toContain(".gitignore"); expect(paths).not.toContain("ignored/x.ts");
  });
  it("an unknown ref is an error, never an empty selection", () => {
    expect(() => collectChanges(repo, "no-such-ref")).toThrow();
  });
});
