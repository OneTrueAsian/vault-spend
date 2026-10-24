import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import { gradeAcceptancePackages, loadAcceptancePackages } from "../testSupport/askVaultM6/combinedAcceptance";
import type { CorpusCase, GradingInput } from "../testSupport/askVaultM6/manifest";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";

/**
 * Task 7 (owner direction D-8; CG-04, Requirements-Checklist.md:97): the realistic typo, word-order and contraction floor of 100 counts INDIVIDUALLY
 * REVIEWED membership, not raw typo or noise tags. These tests were written before the grader read the reviewed list (RED first).
 * The raw tag count stays reported beside it and can never satisfy the floor by itself.
 */
const dir = "src/testSupport/askVaultM6";
const cases: CorpusCase[] = JSON.parse(readFileSync(`${dir}/cases.json`, "utf8"));
const reviewed = JSON.parse(readFileSync(`${dir}/realisticErrors.json`, "utf8")) as { entries: { id: string; text: string; class: string; rationale: string; justification?: string }[] };
const CLASSES = ["typo", "word-order", "contraction"];

describe("the reviewed realistic-error list is complete, valid and individually justified", () => {
  it("holds at least 100 distinct reviewed P-CORE cases", () => {
    expect(new Set(reviewed.entries.map(e => e.id)).size).toBe(reviewed.entries.length);
    expect(reviewed.entries.length).toBeGreaterThanOrEqual(100);
  });
  it("names only real P-CORE cases carrying the typo tag, with their original text unchanged", () => {
    const byId = new Map(cases.map(c => [c.id, c]));
    for (const e of reviewed.entries) {
      const c = byId.get(e.id);
      expect(c, e.id).toBeDefined();
      expect(c!.population, e.id).toBe("P-CORE");
      expect(c!.tags.includes("typo") || !!e.justification, e.id).toBe(true);
      expect(e.text, e.id).toBe(c!.text);
    }
  });
  it("gives every entry a known error class and its own rationale, intended text and corrupted token", () => {
    const rationales = new Set<string>();
    for (const e of reviewed.entries as Record<string, unknown>[]) {
      expect(CLASSES, String(e.id)).toContain(e.class);
      expect(String(e.rationale).length, String(e.id)).toBeGreaterThanOrEqual(20);
      expect(typeof e.intendedText, String(e.id)).toBe("string");
      expect(typeof e.token, String(e.id)).toBe("string");
      expect(e.intendedText, String(e.id)).not.toBe(e.text);
      rationales.add(String(e.rationale));
    }
    expect(rationales.size).toBeGreaterThan(reviewed.entries.length * 0.5);
  });
  it("includes no whitespace or letter-case noise case without a written justification", () => {
    const byId = new Map(cases.map(c => [c.id, c]));
    for (const e of reviewed.entries) if (!byId.get(e.id)!.tags.includes("typo")) expect(e.justification, e.id).toBeTruthy();
  });
  it("reports the raw tag count separately and it is not the reviewed count", () => {
    const raw = cases.filter(c => c.population === "P-CORE" && c.tags.some(t => ["typo", "noise", "realistic-error"].includes(t))).length;
    expect(raw).toBe(480);
    expect(reviewed.entries.length).not.toBe(raw);
  });
});

describe("the combined grader counts reviewed membership, not tags", () => {
  const packages = loadAcceptancePackages();
  it("reports the reviewed count and the raw tag count as two separate numbers", () => {
    const g = gradeAcceptancePackages(packages);
    expect(g.realisticErrorTexts).toBe(reviewed.entries.length);
    expect(g.typoTexts).toBe(480);
    expect(g.gates.typoFloor).toBe(true);
  });
  it("loses the floor when the reviewed list is removed even though 480 raw tags remain", () => {
    const stripped = packages.map(p => p.id === "ordinary" ? { ...p, input: { ...p.input, reviewedRealisticErrors: undefined } } : p);
    const g = gradeAcceptancePackages(stripped as typeof packages);
    expect(g.typoTexts).toBe(480);
    expect(g.realisticErrorTexts).toBe(0);
    expect(g.gates.typoFloor).toBe(false);
  });
});

describe("grader negative cases for the reviewed list", () => {
  const mk = (n: number, tags: string[] = ["typo"], population: CorpusCase["population"] = "P-CORE"): CorpusCase[] => Array.from({ length: n }, (_, i) => ({
    id: `syn-${i}`, text: `synthetic dining question number ${i}`, population, family: "m1:total-category", cluster: "t", tags,
    required: [101, 202, 303].map(seed => ({ seed, contextId: `c${seed}`, requestId: null, referenceId: null, stop: "refusal" as const })),
  }));
  const entry = (id: string, text: string, over: Record<string, unknown> = {}) => ({ id, text, class: "typo", rationale: "a single transposed pair of letters in one word", intendedText: "x", token: "y", ...over });
  const grade = (cs: CorpusCase[], list: unknown) => gradeCorpus({ cases: cs, requests: {}, references: {}, observations: [], requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" }, reviewedRealisticErrors: list } as unknown as GradingInput);
  const list = (cs: CorpusCase[], n: number) => cs.slice(0, n).map(c => entry(c.id, c.text));
  const problems = (g: ReturnType<typeof grade>) => g.integrityIssues.filter(m => /reviewed realistic/.test(m));

  it("99 reviewed cases fail the floor and 100 pass it", () => {
    const cs = mk(150);
    expect(grade(cs, list(cs, 99)).gates.typoFloor).toBe(false);
    expect(grade(cs, list(cs, 100)).gates.typoFloor).toBe(true);
  });
  it("raw tags alone never satisfy the floor", () => {
    const cs = mk(300, ["typo"]);
    const g = grade(cs, []);
    expect(g.typoTexts).toBe(300); expect(g.realisticErrorTexts).toBe(0); expect(g.gates.typoFloor).toBe(false);
  });
  it("raw tags pass while the reviewed list fails: the reviewed list decides", () => {
    const cs = mk(200); const g = grade(cs, list(cs, 40));
    expect(g.typoTexts).toBeGreaterThanOrEqual(100); expect(g.gates.typoFloor).toBe(false);
  });
  it("a duplicate id is an integrity failure and counts once", () => {
    const cs = mk(120); const l = [...list(cs, 100), entry(cs[0].id, cs[0].text)];
    const g = grade(cs, l);
    expect(problems(g).join()).toMatch(/duplicate/); expect(g.realisticErrorTexts).toBe(100);
  });
  it("an id that does not exist is an integrity failure and is not counted", () => {
    const cs = mk(120); const g = grade(cs, [...list(cs, 100), entry("syn-missing", "no such case")]);
    expect(problems(g).join()).toMatch(/unknown|not a case/); expect(g.realisticErrorTexts).toBe(100);
  });
  it("a case outside P-CORE is an integrity failure and is not counted", () => {
    const core = mk(100), other = mk(5, ["typo"], "P-LT").map((c, i) => ({ ...c, id: `lt-${i}`, text: `long tail dining question ${i}` }));
    const g = grade([...core, ...other], [...list(core, 100), ...list(other, 5)]);
    expect(problems(g).join()).toMatch(/P-CORE/); expect(g.realisticErrorTexts).toBe(100);
  });
  it("a noise-only case without a written justification is rejected, with one it is accepted", () => {
    const noisy = mk(100, ["noise"]);
    const bare = grade(noisy, list(noisy, 100));
    expect(problems(bare).join()).toMatch(/noise/); expect(bare.realisticErrorTexts).toBe(0); expect(bare.gates.typoFloor).toBe(false);
    const ok = grade(noisy, noisy.map(c => entry(c.id, c.text, { justification: "reviewed: a real slip, not whitespace" })));
    expect(problems(ok)).toEqual([]); expect(ok.gates.typoFloor).toBe(true);
  });
  it("a case with neither a typo nor a noise tag is rejected", () => {
    const plain = mk(100, []); const g = grade(plain, list(plain, 100));
    expect(problems(g).join()).toMatch(/not tagged/); expect(g.realisticErrorTexts).toBe(0);
  });
  it("an entry whose text differs from the frozen case, or with an unknown class or no rationale, is rejected", () => {
    const cs = mk(103);
    const l = [...list(cs, 100), entry(cs[100].id, "different text"), entry(cs[101].id, cs[101].text, { class: "paraphrase" }), entry(cs[102].id, cs[102].text, { rationale: "" })];
    const g = grade(cs, l);
    expect(problems(g).length).toBe(3); expect(g.realisticErrorTexts).toBe(100);
  });
  it("two reviewed ids with the same normalized text count as one text", () => {
    const cs = mk(101); const twin = { ...cs[0], id: "twin" };
    const g = grade([...cs, twin], [...list(cs, 100), entry("twin", twin.text)]);
    expect(g.realisticErrorTexts).toBe(100);
  });
});
