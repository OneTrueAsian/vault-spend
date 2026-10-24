import { beforeEach, describe, expect, it, vi } from "vitest";

// M6 F-T5-01. A store roster has one entry per transaction, so a 50,000-row ledger is tens of thousands of names. The ordinary parser asks the
// roster about many candidate spans of one question. This file proves two things, and never measures time:
//   1. The roster answers are EXACTLY the answers of the original per-name scan (a differential test against a verbatim copy of it), over rosters that
//      hold operator words, apostrophes, accents, one-letter words, number words, repeats and empty descriptions.
//   2. A lookup no longer examines every recorded name: the work it does is counted (calls to the distance rule and to the prefix test), so a
//      change that brought the full scan back fails here without any benchmark.
const calls = vi.hoisted(() => ({ distance: 0 }));
vi.mock("./distance", async importOriginal => {
  const actual = await importOriginal<typeof import("./distance")>();
  return { ...actual, distance: (...args: Parameters<typeof actual.distance>) => { calls.distance += 1; return actual.distance(...args); } };
});
import { distance } from "./distance";
import { anyVendorMatches, resolveVendor, vendorTerm, vendorWords, type VendorChoice, type VendorResolution } from "./vendor";

// ---- Reference: the original implementation (vendor.ts at ea39fa4), unchanged apart from names and types. ----
type Prepared = { names: string[]; counts: Map<string, number>; words: Map<string, string[]> };
function referencePrepare(descriptions: readonly string[]): Prepared {
  const counts = new Map<string, number>();
  for (const d of descriptions) counts.set(d, (counts.get(d) ?? 0) + 1);
  const names = [...counts.keys()];
  return { names, counts, words: new Map(names.map(name => [name, vendorWords(name)])) };
}
const startsAtAWord = (words: string[], term: string) => words.some((_, i) => words.slice(i).join("").startsWith(term));
const referenceAny = (descriptions: readonly string[], term: string) => { const { names, words } = referencePrepare(descriptions); return names.some(name => startsAtAWord(words.get(name)!, term)); };
function brandLabel(description: string): VendorChoice { const words = vendorWords(description); const end = words.findIndex(w => /\d/.test(w)); const lead = (end > 0 ? words.slice(0, end) : words).slice(0, 6); return { label: lead.join(" ").toUpperCase(), term: lead.join(" ") }; }
function groupByBrand(names: string[]) { const groups: { first: string; names: string[] }[] = []; for (const name of names) { const first = vendorWords(name)[0] ?? name.toLowerCase(); const home = groups.find(g => g.first.startsWith(first) || first.startsWith(g.first)); if (home) { home.names.push(name); if (first.length < home.first.length) home.first = first; } else groups.push({ first, names: [name] }); } return groups; }
const mostCommon = (names: string[], counts: ReadonlyMap<string, number>) => [...names].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b))[0];
function referenceResolve(typed: string, descriptions: string[], wholeWords = false): VendorResolution {
  const term = vendorTerm(typed);
  if (term === null) return { status: "none", suggestions: [] };
  const typedWords = vendorWords(typed);
  const { names, counts, words: nameWords } = referencePrepare(descriptions);
  const wholeWordMatch = (words: string[]) => words.some((_, i) => typedWords.every((w, k) => words[i + k] === w));
  const matched = names.filter(name => startsAtAWord(nameWords.get(name)!, term) && (!wholeWords || wholeWordMatch(nameWords.get(name)!)));
  if (wholeWords && matched.length === 0) return { status: "none", suggestions: [] };
  if (matched.length > 0) {
    const groups = groupByBrand(matched);
    if (groups.length === 1) return { status: "matched", term: vendorWords(typed).join(" "), names: matched };
    return { status: "ambiguous", choices: groups.map(group => brandLabel(mostCommon(group.names, counts))).sort((a, b) => a.label.localeCompare(b.label)), bothTerm: vendorWords(typed).join(" ") };
  }
  const first = vendorWords(typed)[0];
  const tolerance = first.length <= 5 ? 1 : 2;
  const close = groupByBrand(names.filter(name => { const word = nameWords.get(name)![0]; return word !== undefined && first.length >= 3 && distance(first, word.slice(0, first.length + 1), tolerance) <= tolerance; }));
  return { status: "none", suggestions: close.slice(0, 3).map(group => brandLabel(mostCommon(group.names, counts))) };
}

// ---- Deterministic rosters and questions ----
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const BRANDS = ["COSTCO", "COSTCO GAS", "CUT ABOVE SALON", "CUT", "CUT DINING", "SAVE A LOT", "EXTRA SPACE STORAGE", "ONE TIME CAFE", "WHAT IF BOOKS", "SAM'S CLUB", "SAMS CLUB FUEL CENTER", "WAL-MART.COM", "WALMART SUPERCENTER",
  "ÉCOLE CAFÉ", "CAFÉ ÉCOLE", "A B C", "X", "7 ELEVEN", "7-ELEVEN", "MCDONALD'S", "MCDONALDS", "KROGER", "KROGER FUEL", "SHELL", "SHELBY'S DINER", "SPEEDWAY 04123 MUNCIE IN", "HOME DEPOT", "HOMEDEPOT.COM", "DOMINO'S PIZZA", "TARGET", "TARGET.COM", ""];
function roster(size: number, seed: number): string[] {
  const next = seeded(seed), out: string[] = [];
  for (let i = 0; i < size; i++) { const brand = BRANDS[Math.floor(next() * BRANDS.length)]; out.push(next() < 0.15 ? brand : `${brand} #${100 + Math.floor(next() * 40)}`); }
  return out;
}
function questions(seed: number): string[] {
  const next = seeded(seed), out = new Set<string>(["cut", "cut dining", "cut dinin", "save a lot", "extra", "extra space", "one time", "what", "sams", "sam's club", "sam club", "walmart", "wal mart", "wal-mart", "ecole", "école", "café", "cafe ecole", "a b", "a", "x", "7", "7 eleven", "seven eleven", "mcdonalds", "mcdonald's", "krogr", "kroger fuel", "shel", "shell", "shelb", "home depot", "home dept", "dominos", "domino's pizza", "target com", "targt", "zzzq", "costco gas", "costcoo gas", "costtco", "ab", "", "  ", "!!", "a b c d e f g", "12", "#100"]);
  for (const brand of BRANDS) for (let n = 2; n <= Math.min(brand.length, 9); n++) {
    out.add(brand.slice(0, n).toLowerCase());
    if (next() < 0.5 && n > 3) { const at = Math.floor(next() * (n - 1)) + 1; out.add((brand.slice(0, at) + brand.slice(at + 1, n)).toLowerCase()); out.add((brand.slice(0, at) + brand[at + 1 < brand.length ? at + 1 : at] + brand[at] + brand.slice(at + 2, n)).toLowerCase()); }
  }
  return [...out];
}

describe("the roster answers equal the original per-name scan", () => {
  it.each([[1, 1], [37, 2], [400, 3], [3000, 4], [0, 5]])("roster of %i names (seed %i): every lookup, strict and loose, and every term test agree", (size, seed) => {
    const names = roster(size, seed);
    for (const typed of questions(seed + 100)) {
      for (const strict of [false, true]) expect(resolveVendor(typed, names, strict), `${JSON.stringify(typed)} strict=${strict}`).toEqual(referenceResolve(typed, names, strict));
      const term = typed.toLowerCase().replace(/\s/g, "");
      expect(anyVendorMatches(names, term), `anyVendorMatches ${JSON.stringify(term)}`).toBe(referenceAny(names, term));
    }
  });
  it("terms the lookup never produces (upper case, one character, empty, longer than any name) answer as the scan does", () => {
    const names = roster(500, 9);
    for (const term of ["COSTCO", "Cu", "c", "", " ", "7", "costco#100costco", "x".repeat(200), "école", "ecole"]) expect(anyVendorMatches(names, term), JSON.stringify(term)).toBe(referenceAny(names, term));
  });
  it("one roster list answers many questions, and a different list is never answered from the first", () => {
    const first = ["COSTCO #1", "CUT ABOVE SALON"], second = ["TARGET #2"];
    expect(anyVendorMatches(first, "cut")).toBe(true);
    expect(anyVendorMatches(second, "cut")).toBe(false);
    expect(resolveVendor("cut above", first, true)).toMatchObject({ status: "matched" });
    expect(resolveVendor("cut above", second, true)).toMatchObject({ status: "none", suggestions: [] });
    first.push("CUTLERY WORLD #3");
    expect(referenceAny(first, "cutl")).toBe(true);
  });
  it("order and repeats still decide a label: the commonest spelling wins and ties break alphabetically", () => {
    const names = ["SAMS CLUB #2", "SAMS CLUB #2", "SAMS CLUB #1", "SAMSCLUB.COM", "SAMANTHAS BAKERY", "SAMANTHAS BAKERY", "SAMANTHAS BAKERY"];
    expect(resolveVendor("sam", names)).toEqual(referenceResolve("sam", names));
    expect(resolveVendor("sam", names)).toMatchObject({ status: "ambiguous" });
  });
});

describe("a lookup no longer examines every recorded name", () => {
  // 3,000 distinct names behind a handful of brands, as a large ledger records them (one store number per visit).
  const bigRoster = () => Array.from({ length: 3000 }, (_, i) => `${["COSTCO", "TARGET", "KROGER", "MEIJER", "ALDI"][i % 5]} #${1000 + i}`);
  let startsWith: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { calls.distance = 0; startsWith = vi.spyOn(String.prototype, "startsWith"); });

  it("a close-spelling search measures each distinct first word once, not each recorded name", () => {
    const names = bigRoster();
    resolveVendor("kroggr", names, false);
    expect(calls.distance).toBeLessThanOrEqual(5);
    startsWith.mockRestore();
  });
  it("a name that starts no recorded name is rejected without testing each recorded name", () => {
    const names = bigRoster();
    expect(resolveVendor("zzqx", names, true)).toEqual({ status: "none", suggestions: [] });
    expect(anyVendorMatches(names, "zzqx")).toBe(false);
    expect(startsWith.mock.calls.length).toBeLessThan(50);
    startsWith.mockRestore();
  });
  it("a name is tested only against the recorded names that could start with it", () => {
    const names = bigRoster();
    expect(anyVendorMatches(names, "costco")).toBe(true);
    expect(resolveVendor("tar", names, false)).toMatchObject({ status: "matched" });
    // Costco and Target are 1,200 of the 3,000 names; testing them all would be more than 1,200 tests per lookup.
    expect(startsWith.mock.calls.length).toBeLessThan(1500);
    startsWith.mockRestore();
  });
});
