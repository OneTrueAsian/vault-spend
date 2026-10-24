import { describe, expect, it } from "vitest";
import { parseQuestion } from "./parser";
import type { ParseContext } from "./types";

const base: ParseContext = {
  today: "2026-09-06",
  categories: ["Groceries", "Dining", "Dining Out", "Shopping", "Rent"],
  accounts: [{ id: 1, name: "Everyday Checking" }, { id: 3, name: "Rewards Card" }],
  merchants: [
    "Whole Foods Market", "Costco", "Costco", "Shell Gas", "SAMS CLUB #6482", "Sam's Club", "SAMSCLUB.COM", "Samantha's Bakery",
    "SPEEDWAY 04123 MUNCIE IN", "SPEEDWAY 07754 ANDERSON IN", "Walmart Supercenter",
  ],
  members: ["Alex", "Jordan"],
};
const known: ParseContext = { ...base, historyStart: "2025-09-01" };
const august = { from: "2026-08-01", to: "2026-08-31" };
const september = { from: "2026-09-01", to: "2026-09-06" };
const noFilter = { accountIds: [], categories: [], minimumPurchase: null, excludeVendors: [], excludeCategories: [], expectedRevision: null };

function asked(question: string, ctx: ParseContext = known) {
  const result = parseQuestion(question, ctx);
  if (result.status !== "query") throw new Error(`${question} -> ${JSON.stringify(result)}`);
  return result;
}

describe("stores and payees", () => {
  it("a store with no period means all of the records, and says so", () => {
    const r = asked("how much did I spend at costco");
    expect(r.request).toEqual({ ...noFilter, kind: "total", vendors: ["costco"], periods: [{ from: "2025-09-01", to: "2026-09-06" }], limit: 1 });
    expect(r.interpretation).toMatchObject({ vendors: ["Costco"], periods: [{ label: "all your records", allRecords: true }] });
  });
  it("without a known start of records it asks for a period instead", () => {
    expect(parseQuestion("how much did I spend at costco", base)).toMatchObject({ status: "clarify" });
  });
  it("a store with a period", () => {
    const r = asked("What was my total purchases at speedway this month");
    expect(r.request).toMatchObject({ kind: "total", vendors: ["speedway"], periods: [september] });
    expect(r.interpretation.periods[0].allRecords).toBeFalsy();
  });
  it("keeps the shape of the name the person typed", () => {
    expect(asked("how much did I spend at Sam's Club").interpretation.vendors).toEqual(["Sam's Club"]);
    expect(asked("how much did I spend at Sam's Club").request.vendors).toEqual(["sams club"]);
    expect(asked("how much did I spend at sams club last month").request).toMatchObject({ vendors: ["sams club"], periods: [august] });
  });
  it("a store named after 'on' works without 'at'", () => {
    expect(asked("how much did I spend on costco last month").request).toMatchObject({ vendors: ["costco"], categories: [] });
  });
  it("a store and a category together", () => {
    expect(asked("groceries at Costco last month").request).toMatchObject({ vendors: ["costco"], categories: ["Groceries"], periods: [august] });
  });
  it("a store with an account, an amount filter, a ranking and a comparison", () => {
    expect(asked("spending at costco on my Rewards Card last month").request).toMatchObject({ vendors: ["costco"], accountIds: [3] });
    expect(asked("purchases at costco over $50 last month").request).toMatchObject({ vendors: ["costco"], minimumPurchase: { amount: "50.00", inclusive: false } });
    expect(asked("top 3 purchases at costco this year").request).toMatchObject({ kind: "rank-purchases", vendors: ["costco"], limit: 3 });
    expect(asked("compare costco spending this month to last month").request).toMatchObject({ kind: "compare", vendors: ["costco"], periods: [september, august] });
  });
  it("a short name that fits two different stores asks which, and offers both", () => {
    expect(parseQuestion("how much did I spend at sam last month", known)).toMatchObject({
      status: "clarify",
      choices: ["SAMANTHAS BAKERY", "SAMS CLUB", "Both"],
    });
  });
  it("a typo with a close store suggests it; a stranger is not found", () => {
    expect(parseQuestion("how much did I spend at walmrt last month", known)).toMatchObject({ status: "clarify", choices: ["WALMART SUPERCENTER"] });
    expect(parseQuestion("how much did I spend at zzyzx last month", known)).toMatchObject({ status: "unsupported", reason: expect.stringContaining("zzyzx") });
  });
  it("older questions about a store stay with the older matcher", () => {
    expect(parseQuestion("how many transactions at costco in 2026", known)).toEqual({ status: "legacy" });
    expect(parseQuestion("average purchase at costco", known)).toEqual({ status: "legacy" });
  });
  it("a family member is still the older matcher's", () => {
    expect(parseQuestion("how much did Alex spend in July", known)).toEqual({ status: "legacy" });
  });
  it("a store name never swallows time or operator words", () => {
    expect(asked("how much did I spend at costco in august").request).toMatchObject({ vendors: ["costco"], periods: [august] });
    expect(parseQuestion("how much did I spend at costco without zzyzx last month", known).status).toBe("unsupported");
  });
});

describe("a store named without 'at' must be a whole word of a recorded name", () => {
  it("'food' is not the store 'Whole Foods Market'", () => {
    expect(parseQuestion("how much did I spend on food last month", known).status).not.toBe("query");
  });
  it("but the whole words are", () => {
    expect(asked("how much did I spend on whole foods last month").request).toMatchObject({ vendors: ["whole foods"], periods: [august] });
  });
  it("with 'at', the start of a name is enough", () => {
    expect(asked("how much did I spend at whole last month").request).toMatchObject({ vendors: ["whole"] });
  });
});

const chains: ParseContext = {
  ...known,
  merchants: [...known.merchants!, "MEIJER #204", "Target T-1234", "MCDONALD'S F1234", "ARBYS #55", "BURGER KING 123", "Maple Court Apartments"],
  categories: [...known.categories, "Rent"],
};
const lastWeek = { from: "2026-08-30", to: "2026-09-05" };

describe("several stores in one question", () => {
  it("meijer, sams club and target", () => {
    const r = asked("how much did I spend at meijer, sams club and target last month", chains);
    expect(r.request).toMatchObject({ kind: "total", vendors: ["meijer", "sams club", "target"], periods: [august] });
    expect(r.interpretation.vendors).toEqual(["Meijer", "Sams Club", "Target"]);
  });
  it("mcdonalds, arbys and burger king, with apostrophes", () => {
    const r = asked("what did i spend at mcdonald's, arby's and burger king last week", chains);
    expect(r.request).toMatchObject({ vendors: ["mcdonalds", "arbys", "burger king"], periods: [lastWeek] });
    expect(r.interpretation.vendors).toEqual(["Mcdonald's", "Arby's", "Burger King"]);
  });
  it("two stores with 'or', and a repeated store only once", () => {
    expect(asked("spending at costco or target last month", chains).request.vendors).toEqual(["costco", "target"]);
    expect(asked("spending at costco and costco last month", chains).request.vendors).toEqual(["costco"]);
  });
  it("a list works with a category, a ranking and a comparison", () => {
    expect(asked("groceries at costco and target last month", chains).request).toMatchObject({ categories: ["Groceries"], vendors: ["costco", "target"] });
    expect(asked("top 3 purchases at costco and target this year", chains).request).toMatchObject({ kind: "rank-purchases", vendors: ["costco", "target"], limit: 3 });
    expect(asked("compare costco and target spending this month to last month", chains).request).toMatchObject({ kind: "compare", vendors: ["costco", "target"] });
  });
  it("an unclear name in a list asks about that name and keeps the rest of the question", () => {
    const r = parseQuestion("how much did I spend at sam, target last month", chains);
    expect(r).toMatchObject({ status: "clarify", choices: ["SAMANTHAS BAKERY", "SAMS CLUB", "Both"] });
    if (r.status === "clarify") expect(r.replacements![1]).toContain('"sams club"');
    if (r.status === "clarify") expect(r.replacements![1]).toContain("target");
  });
  it("an unknown name in a list is reported, never dropped", () => {
    expect(parseQuestion("how much did I spend at costco and zzyzx last month", chains)).toMatchObject({ status: "unsupported", reason: expect.stringContaining("zzyzx") });
  });
  it("more than ten stores is too many", () => {
    const names = ["aardvark", "badger", "cobra", "dingo", "eagle", "ferret", "gecko", "heron", "iguana", "jackal", "koala"];
    const many: ParseContext = { ...chains, merchants: names };
    expect(parseQuestion(`how much did I spend at ${names.join(", ")} last month`, many).status).toBe("unsupported");
  });
});

describe("leaving things out", () => {
  it("a category without a store", () => {
    const r = asked("groceries last month without costco", chains);
    expect(r.request).toMatchObject({ categories: ["Groceries"], vendors: [], excludeVendors: ["costco"], periods: [august] });
    expect(r.interpretation).toMatchObject({ excludedVendors: ["Costco"], excludedCategories: [] });
  });
  it("everything except a category", () => {
    const r = asked("everything except rent last month", chains);
    expect(r.request).toMatchObject({ categories: [], excludeCategories: ["Rent"], periods: [august] });
    expect(r.interpretation.excludedCategories).toEqual(["Rent"]);
    expect(asked("spending without shopping this year", chains).request.excludeCategories).toEqual(["Shopping"]);
  });
  it("several things left out, stores and categories together", () => {
    expect(asked("spending last month excluding costco and rent", chains).request).toMatchObject({ excludeVendors: ["costco"], excludeCategories: ["Rent"] });
    expect(asked("spending last month without costco, target and rent", chains).request).toMatchObject({ excludeVendors: ["costco", "target"], excludeCategories: ["Rent"] });
  });
  it("other ways of saying it", () => {
    expect(asked("groceries last month but not at costco", chains).request.excludeVendors).toEqual(["costco"]);
    expect(asked("spending last month other than rent", chains).request.excludeCategories).toEqual(["Rent"]);
    expect(asked("how much did I spend last month besides rent", chains).request.excludeCategories).toEqual(["Rent"]);
  });
  it("a period can come before or after the exclusion", () => {
    expect(asked("without rent, what did I spend last month", chains).request).toMatchObject({ excludeCategories: ["Rent"], periods: [august] });
  });
  it("stores to include and things to leave out together", () => {
    expect(asked("how much did I spend at costco and target last month without groceries", chains).request).toMatchObject({
      vendors: ["costco", "target"], excludeCategories: ["Groceries"],
    });
  });
  it("works with a ranking and an amount filter", () => {
    expect(asked("top 3 categories last month without rent", chains).request).toMatchObject({ kind: "rank-categories", excludeCategories: ["Rent"], limit: 3 });
    expect(asked("purchases over $50 last month except costco", chains).request).toMatchObject({ excludeVendors: ["costco"], minimumPurchase: { amount: "50.00" } });
  });
  it("never hides a contradiction", () => {
    expect(parseQuestion("groceries last month without groceries", chains).status).toBe("unsupported");
    expect(parseQuestion("how much did I spend at costco last month without costco", chains).status).toBe("unsupported");
  });
  it("asks what to leave out when nothing follows, and refuses what it cannot leave out", () => {
    expect(parseQuestion("groceries last month without", chains)).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/leave out/i) });
    expect(parseQuestion("groceries last month without zzyzx", chains).status).toBe("unsupported");
    expect(parseQuestion("spending last month without my Rewards Card", chains).status).toBe("unsupported");
  });
  it("a bare 'not' is still not understood, and an exclusion never reaches the older matcher", () => {
    expect(parseQuestion("not groceries spending last month", chains).status).toBe("unsupported");
    expect(parseQuestion("total groceries spending last month excluding cash purchases", chains).status).toBe("unsupported");
  });
});
