// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseQuestion } from "./parser";
import type { ParseContext, ParseOutcome } from "./types";
import { buildReplyIndex, observeCase, type RouteEnv } from "../testSupport/askVaultM6/routeHarness";
import type { CorpusCase } from "../testSupport/askVaultM6/manifest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// M6 item "Home dept" (owner instruction 2026-10-21, Task-Authority-2.txt:128-146; typoRules.json store decision: "A store typo is never answered without a choice").
// "Entertainment at Kroger, petco and Home dept this quarter": in a list of stores the parser took "home" as a complete store (a word that starts HOME DEPOT) and
// "dept" as a separate unknown store, so it refused. The same words directly after "at" already ask ("Did you mean HOME DEPOT?"). The list must ask too, never answer.
const base = { today: "2027-01-31", categories: ["Entertainment", "Groceries", "Dining"], accounts: [{ id: 1, name: "Travel Card" }], members: ["Alex"], familyMembers: [{ id: 1, name: "Alex" }], historyStart: "2025-09-01" };
const roster = ["KROGER #320", "KROGER #630", "PETCO #673", "HOME DEPOT #453", "HOME DEPOT #529", "SPOTIFY #1", "COSTCO GAS #266", "COSTCO #5"];
const ctx = (merchants = roster): ParseContext => ({ ...base, merchants });
const parse = (text: string, merchants = roster) => parseQuestion(text, ctx(merchants));
const clarify = (p: ParseOutcome) => { if (p.status !== "clarify") throw Error(`expected a clarification, got ${p.status}: ${JSON.stringify(p)}`); return p; };
const query = (p: ParseOutcome) => { if (p.status !== "query") throw Error(`expected a request, got ${p.status}: ${JSON.stringify(p)}`); return p; };
const QUARTER = [{ from: "2027-01-01", to: "2027-01-31" }];

describe("a typo in a later word of a store name asks, in a list of stores, instead of refusing", () => {
  it("the owner's example offers HOME DEPOT, answers nothing, and the choice carries every other clause", () => {
    const asked = clarify(parse("Entertainment at Kroger, petco and Home dept this quarter"));
    expect(asked.choices).toEqual(["HOME DEPOT"]);
    expect(asked.replacements).toHaveLength(1);
    expect(query(parse(asked.replacements![0])).request).toMatchObject({ vendors: ["kroger", "petco", "home depot"], categories: ["Entertainment"], periods: QUARTER, excludeVendors: [] });
  });
  it.each([
    ["or", "Entertainment at Kroger or Home dept this quarter", ["kroger", "home depot"]],
    ["and", "Entertainment at Kroger and Home dept this quarter", ["kroger", "home depot"]],
    ["a comma", "Entertainment at Kroger, Home dept this quarter", ["kroger", "home depot"]],
    ["first in the list", "Entertainment at Home dept, Kroger and petco this quarter", ["home depot", "kroger", "petco"]],
    ["last of three", "Entertainment at Kroger, petco, Home dept this quarter", ["kroger", "petco", "home depot"]],
  ])("joined by %s", (_name, text, vendors) => {
    const asked = clarify(parse(text));
    expect(asked.choices).toEqual(["HOME DEPOT"]);
    expect(query(parse(asked.replacements![0])).request.vendors).toEqual(vendors);
  });
  it("a filter, a count and a period survive the choice", () => {
    const asked = clarify(parse("top 3 purchases over $20 at Kroger and Home dept in june"));
    const request = query(parse(asked.replacements![0])).request;
    expect(request).toMatchObject({ kind: "rank-purchases", limit: 3, vendors: ["kroger", "home depot"], minimumPurchase: { amount: "20.00", inclusive: false }, periods: [{ from: "2026-06-01", to: "2026-06-30" }] });
  });
  it("two stores that share the first word are offered exactly as they are directly after 'at' (the existing store rule groups them), and nothing is chosen", () => {
    const both = [...roster, "HOME GOODS #7"];
    const direct = clarify(parse("spending at Home dept this quarter", both));
    const listed = clarify(parse("Entertainment at Kroger and Home dept this quarter", both));
    expect(listed.choices).toEqual(direct.choices);
    expect(listed.choices!.length).toBeGreaterThan(0);
    for (const r of listed.replacements!) expect(query(parse(r, both)).request.vendors).toHaveLength(2);
  });
  it("a name with no close recorded store keeps the plain not-found message", () => {
    const p = parse("Entertainment at Kroger and Qwxz vbnm this quarter");
    expect(p.status).toBe("unsupported");
  });
  it("a left-out store asks too, and the choice keeps it left out", () => {
    const asked = clarify(parse("Entertainment at Kroger without Home dept this quarter"));
    expect(asked.choices).toEqual(["HOME DEPOT"]);
    expect(query(parse(asked.replacements![0])).request).toMatchObject({ vendors: ["kroger"], excludeVendors: ["home depot"] });
  });
  it("an unsupported clause is still refused after the choice, never answered", () => {
    const p = parse("Entertainment at Kroger and Home dept under $20 this quarter");
    expect(p.status).not.toBe("query");
    if (p.status === "clarify") expect(parse(p.replacements![0]).status).toBe("unsupported");
  });
  it("the typed words are never silently corrected", () => {
    for (const text of ["Entertainment at Kroger and Home dept this quarter", "Entertainment at Kroger and Home depott this quarter"]) {
      expect(parse(text).status).not.toBe("query");
    }
  });
});

// Guards: these hold before and after the change. The fix must not turn valid lists into questions.
describe("valid lists of stores are not turned into questions", () => {
  it.each([
    ["a full recorded name", "Entertainment at Kroger and Home Depot this quarter", ["kroger", "home depot"]],
    ["a name that is only the first word of a store", "Entertainment at Kroger and home this quarter", ["kroger", "home"]],
    ["a store followed by a category name", "Entertainment at Kroger, home groceries this quarter", ["kroger", "home"]],
  ])("%s", (_name, text, vendors) => {
    expect(query(parse(text)).request.vendors).toEqual(vendors);
  });
  // Found by the old-versus-new replay of 12,809 corpus outcomes, not written first: a first version of the fix asked "Did you mean KROGER?" for these.
  it.each([
    ["a slip in a period word after a store", "Entertainment at Kroger and Petco lst quarter"],
    ["an unknown word that is not close to the store's name", "Entertainment at Kroger and Home blorf this quarter"],
  ])("%s keeps its old plain refusal", (_name, text) => {
    const p = parse(text);
    expect(p.status).toBe("unsupported");
  });
  it("a slip in a grammar word after a store is still corrected and answered, not turned into a store question", () => {
    expect(query(parse("Entertainment at Kroger, Petco yyear to date")).request.vendors).toEqual(["kroger", "petco"]);
  });
  it("a slip in a later word of another store (Sam's club) asks too, in a left-out list", () => {
    const stores = [...roster, "SAMS CLUB #212"];
    const asked = clarify(parse("Entertainment this quarter excluding Kroger and sam's clob", stores));
    expect(asked.choices).toEqual(["SAMS CLUB"]);
    expect(query(parse(asked.replacements![0], stores)).request.excludeVendors).toEqual(["kroger", "sams club"]);
  });
  it("a slip in the first word of a later store still asks as before", () => {
    expect(clarify(parse("how much did I spend at Kroger and petoc last week")).choices).toEqual(["PETCO"]);
  });
  it("the same words directly after 'at' still ask as before", () => {
    expect(clarify(parse("spending at Home dept this quarter")).choices).toEqual(["HOME DEPOT"]);
  });
});

describe("the real card and the frozen case m1/303-0177", () => {
  const R = "src/testSupport/askVaultM6/";
  const json = (name: string) => JSON.parse(readFileSync(R + name, "utf8"));
  it("offers HOME DEPOT first, reads nothing until the choice is clicked, and then shows the exact frozen result on all three seeds", async () => {
    const cases: CorpusCase[] = json("cases.json");
    const c = cases.find(x => x.id === "m1/303-0177")!;
    const env: RouteEnv = { contexts: json("contexts.json"), requests: json("expectedRequests.json"), references: json("referenceResults.json") };
    const index = buildReplyIndex(env);
    for (const r of c.required) {
      const offered = await observeCase(c, r, env, index, { choose: () => null });
      expect(offered.stage, `${r.seed}`).toBe("clarify");
      expect(offered.offeredChoices).toEqual(["HOME DEPOT"]);
      expect(offered.accepted).toEqual([]);
      const chosen = await observeCase(c, r, env, index, { choose: labels => labels.find(l => l === "HOME DEPOT") ?? null });
      expect(chosen.stage, `${r.seed}`).toBe("result");
      expect(chosen.meaningChoices).toBe(1);
      expect(chosen.request).toEqual(env.requests[r.requestId!]);
      expect(chosen.result).toEqual(env.references[r.referenceId!].value);
    }
  });
});
