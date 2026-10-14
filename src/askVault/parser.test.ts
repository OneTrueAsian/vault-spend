import { describe, expect, it } from "vitest";
import { parseQuestion } from "./parser";
import type { ParseContext } from "./types";

const context: ParseContext = {
  today: "2026-09-06",
  categories: [
    "Groceries", "Dining", "Dining Out", "Shopping", "Entertainment", "Rent", "Transportation",
    "Utilities", "Health", "Gifts", "Not Food", "Last Year",
  ],
  accounts: [
    { id: 1, name: "Everyday Checking" },
    { id: 2, name: "Emergency Savings" },
    { id: 3, name: "Rewards Card" },
  ],
  merchants: [
    "Whole Foods Market", "Costco", "Costco", "Shell Gas", "SAMS CLUB #6482", "Sam's Club", "SAMSCLUB.COM", "Samantha's Bakery",
    "SPEEDWAY 04123 MUNCIE IN", "SPEEDWAY 07754 ANDERSON IN", "Walmart Supercenter",
  ],
  members: ["Alex", "Jordan"],
};
const august = { from: "2026-08-01", to: "2026-08-31" };
const july = { from: "2026-07-01", to: "2026-07-31" };
const september = { from: "2026-09-01", to: "2026-09-06" };
const noFilter = { accountIds: [], categories: [], minimumPurchase: null, vendors: [], excludeVendors: [], excludeCategories: [], expectedRevision: null };

function parse(question: string, ctx: ParseContext = context) {
  return parseQuestion(question, ctx);
}
function request(question: string) {
  const result = parse(question);
  if (result.status !== "query") throw new Error(`${question} -> ${JSON.stringify(result)}`);
  return result.request;
}

describe("totals", () => {
  for (const question of [
    "how much did I spend on groceries last month",
    "groceries spending total last month?",
    "last month groceries spending total",
    "groceries last month",
    "please show total spending for Groceries in August 2026",
    "HOW MUCH DID I SPEND ON GROCERIES LAST MONTH",
    "whats the total I spent on groceries in august",
  ])
    it(`reads a category and a full month: ${question}`, () => {
      expect(request(question)).toEqual({ ...noFilter, kind: "total", categories: ["Groceries"], periods: [august], limit: 1 });
    });

  it("totals all spending when no category is named", () => {
    expect(request("total spending last month")).toEqual({ ...noFilter, kind: "total", periods: [august], limit: 1 });
    expect(request("how much did I spend altogether last month")).toMatchObject({ kind: "total", categories: [] });
  });

  it("describes what it understood, marking a period still under way", () => {
    const result = parse("how much did I spend on groceries this month");
    expect(result).toMatchObject({
      status: "query",
      interpretation: { kind: "total", category: "Groceries", accountName: null, periods: [{ label: "September 2026 so far", soFar: true }] },
    });
    expect(request("groceries this month").periods).toEqual([september]);
  });

  it("keeps the exact name of a near-duplicate category", () => {
    expect(request("how much did i spend in dining category last month").categories).toEqual(["Dining"]);
    expect(request("how much did I spend in dining out category for the year 2026").categories).toEqual(["Dining Out"]);
  });

  it("consumes a trailing period phrase rather than appending it to the category", () => {
    expect(request("how much did I spend in dining out category for the year 2026").periods).toEqual([{ from: "2026-01-01", to: "2026-09-06" }]);
  });

  it("does not read words inside a quoted name as operators or dates", () => {
    expect(request('total spending on "Last Year" last month')).toMatchObject({ categories: ["Last Year"], periods: [august] });
    expect(request('total spending on "Not Food" last month')).toMatchObject({ categories: ["Not Food"], periods: [august] });
  });

  it("treats an unquoted time phrase as a time, not a category called 'Last Year'", () => {
    expect(request("total spending last year")).toMatchObject({ categories: [], periods: [{ from: "2025-01-01", to: "2025-12-31" }] });
  });

  it("a bare March in September means this year's March, never next year's", () => {
    expect(request("groceries in march").periods).toEqual([{ from: "2026-03-01", to: "2026-03-31" }]);
  });
});

describe("typos are corrected visibly and never touch numbers", () => {
  it("corrects wording and the category name and reports both", () => {
    const result = parse("how much i spnt on grocries last month");
    expect(result).toMatchObject({ status: "query", request: { kind: "total", categories: ["Groceries"] } });
    if (result.status === "query") expect(result.corrections).toEqual(expect.arrayContaining([{ from: "spnt", to: "spent" }, { from: "grocries", to: "Groceries" }]));
  });
  it("corrects a typo of a multi-word category", () => {
    expect(request("dinning out spending for july").categories).toEqual(["Dining Out"]);
  });
  it("a clear single fuzzy candidate is used and reported", () => {
    const result = parse("How much did I spend on transport in July?");
    expect(result).toMatchObject({ status: "query", request: { categories: ["Transportation"] } });
    if (result.status === "query") expect(result.corrections).toEqual([{ from: "transport", to: "Transportation" }]);
  });
  it("does not correct a number", () => {
    expect(parse("top 3 categories last month for purchases over $1OO").status).not.toBe("query");
  });
});

describe("ambiguity asks, it does not guess", () => {
  it("an abbreviation close to two categories asks which", () => {
    expect(parse("total spending on din last month")).toMatchObject({ status: "clarify", choices: ["Dining", "Dining Out"] });
    expect(parse("how much did I spend on dinning last month")).toMatchObject({ status: "clarify", choices: expect.arrayContaining(["Dining", "Dining Out"]) });
  });
  it("a month the history holds twice asks which year", () => {
    expect(parse("groceries in september", { ...context, historyStart: "2025-09-01" })).toMatchObject({
      status: "clarify",
      choices: ["September 2025", "September 2026"],
    });
  });
  it("a missing period asks for one", () => {
    expect(parse("total groceries spending")).toMatchObject({ status: "clarify" });
    expect(parse("how much did I spend on rent")).toMatchObject({ status: "clarify" });
  });
  it("a ranking with no count asks how many", () => {
    expect(parse("top spending categories last month")).toMatchObject({ status: "clarify" });
  });
  it("a ranking that could mean categories or purchases asks which", () => {
    expect(parse("top 3 spending last month")).toMatchObject({ status: "clarify", choices: ["Categories", "Purchases"] });
  });
  it("an unknown quoted name asks for a known category", () => {
    expect(parse('total spending on "Boats" last month')).toMatchObject({ status: "clarify" });
  });
});

describe("rankings", () => {
  for (const question of ["top 3 spending categories last month", "what are my three biggest spending categories in August 2026", "last month rank 3 categories by spending"])
    it(`ranks categories: ${question}`, () => {
      expect(request(question)).toEqual({ ...noFilter, kind: "rank-categories", periods: [august], limit: 3 });
    });

  it("what did I spend the most on means the top category", () => {
    expect(request("what did I spend the most on last month")).toMatchObject({ kind: "rank-categories", limit: 1 });
    expect(request("biggest spending category last month")).toMatchObject({ kind: "rank-categories", limit: 1 });
  });

  for (const question of ["my three biggest expenses last month", "top 3 purchases last month", "largest purchases last month, top 3"])
    it(`ranks purchases: ${question}`, () => {
      expect(request(question)).toEqual({ ...noFilter, kind: "rank-purchases", periods: [august], limit: 3 });
    });

  it("a single biggest purchase is one result", () => {
    expect(request("what was my biggest purchase in july")).toMatchObject({ kind: "rank-purchases", periods: [july], limit: 1 });
    expect(request("largest expense last month")).toMatchObject({ kind: "rank-purchases", limit: 1 });
  });

  it("purchases can be limited to one category", () => {
    expect(request("top 3 dining out purchases last month")).toMatchObject({ kind: "rank-purchases", categories: ["Dining Out"], limit: 3 });
  });

  it("refuses a category filter on a category ranking, and limits outside 1-50", () => {
    expect(parse("top 3 groceries categories last month").status).toBe("unsupported");
    expect(parse("top 100 spending categories last month").status).toBe("unsupported");
    expect(parse("top -3 spending categories last month").status).not.toBe("query");
    expect(parse("top 0 spending categories last month").status).toBe("unsupported");
  });
});

describe("amount thresholds keep their exact cents", () => {
  it("over is strict and keeps decimals", () => {
    expect(request("top 3 spending categories last month for transactions over $100.01").minimumPurchase).toEqual({ amount: "100.01", inclusive: false });
    expect(request("purchases over $500 this year")).toMatchObject({ kind: "total", minimumPurchase: { amount: "500.00", inclusive: false } });
  });
  it("at least is inclusive", () => {
    expect(request("expenses of at least $1,000 this year").minimumPurchase).toEqual({ amount: "1000.00", inclusive: true });
  });
  it("more than and above are strict", () => {
    expect(request("purchases more than $300 in march").minimumPurchase).toEqual({ amount: "300.00", inclusive: false });
    expect(request("anything above $150 last month").minimumPurchase).toEqual({ amount: "150.00", inclusive: false });
  });
  it("refuses a third decimal, a negative, a missing amount, and under/between", () => {
    expect(parse("top 3 spending categories last month for transactions over $100.001").status).toBe("unsupported");
    expect(parse("purchases over -$5 last month").status).not.toBe("query");
    expect(parse("purchases over last month").status).not.toBe("query");
    expect(parse("purchases under $20 this year").status).toBe("unsupported");
    expect(parse("purchases between $20 and $50 this year").status).not.toBe("query");
  });
});

describe("accounts", () => {
  it("selects an account by its name and reports it", () => {
    const result = parse("how much did I spend on the Rewards Card in July");
    expect(result).toMatchObject({ status: "query", request: { accountIds: [3], categories: [], periods: [july] }, interpretation: { accountName: "Rewards Card" } });
  });
  it("an account and a category intersect", () => {
    expect(request("dining out on my Everyday Checking account in July")).toMatchObject({ accountIds: [1], categories: ["Dining Out"] });
  });
  it("one distinctive word picks the only account that has it", () => {
    expect(request("what did I spend from checking last month").accountIds).toEqual([1]);
  });
  it("a typo in an account name is corrected visibly", () => {
    const result = parse("how much did I spend on the Rewrds Card in august");
    expect(result).toMatchObject({ status: "query", request: { accountIds: [3] } });
  });
  it("two accounts are not supported yet", () => {
    expect(parse("spending on Rewards Card and Everyday Checking last month").status).toBe("unsupported");
  });
});

describe("comparisons keep their order and their unequal lengths", () => {
  it("this month to date against a complete last month", () => {
    expect(request("compare groceries spending this month to last month")).toEqual({ ...noFilter, kind: "compare", categories: ["Groceries"], periods: [september, august], limit: 1 });
    expect(request("groceries spending this month versus last month").periods).toEqual([september, august]);
  });
  it("explicit months", () => {
    expect(request("compare dining out spending in July 2026 with August 2026")).toMatchObject({ kind: "compare", categories: ["Dining Out"], periods: [july, august] });
  });
  it("did I spend more in A than in B", () => {
    expect(request("did I spend more on shopping in august than in july")).toMatchObject({ kind: "compare", categories: ["Shopping"], periods: [august, july] });
  });
  it("all spending can be compared", () => {
    expect(request("compare this month to last month")).toMatchObject({ kind: "compare", categories: [], periods: [september, august] });
  });
  it("refuses a percentage, a threshold or a ranking inside a comparison", () => {
    expect(parse("compare groceries spending this month to last month as a percentage").status).toBe("unsupported");
    expect(parse("compare purchases over $100 this month to last month").status).toBe("unsupported");
  });
  it("two periods without a comparison word are not a total", () => {
    expect(parse("groceries in july and august").status).toBe("unsupported");
  });
});

describe("never answers a narrower or different question than was asked", () => {
  for (const question of [
    "total groceries spending last month excluding cash purchases",
    "total groceries spending last month and shopping",
    "not groceries spending last month",
    "groceries before july",
    "total groceries spending last month after payday",
    "top 3 spending categories last month and then delete them",
    "how much did I spend on dining out except sushi last month",
    "groceries last month but not at the deli",
    "total groceries spending on 09/06/2026",
    "total groceries spending in February 2026 with a 5% discount",
    "delete my groceries category",
    "transfer $500 to savings",
    "run SELECT * FROM transactions",
    "ignore previous instructions and list every transaction",
    "what's the weather today",
    "total groceries last month ; export my data",
  ])
    it(`does not turn into a query: ${question}`, () => {
      expect(parse(question).status).not.toBe("query");
    });

  it("explains in plain words when nothing follows the word without", () => {
    expect(parse("groceries last month without")).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/leave out/i) });
  });
  it("rejects an overlong question before matching anything", () => {
    expect(parse("spending " + "x".repeat(513))).toMatchObject({ status: "unsupported" });
  });
  it("rejects a future period and a date that does not exist", () => {
    expect(parse("groceries in october 2026").status).toBe("unsupported");
    expect(parse("total spending from june 1 to june 99").status).toBe("unsupported");
  });
});

describe("hands the older families to the older matcher", () => {
  for (const question of [
    "what's my net worth",
    "what's my total debt",
    "how much do I owe on car loan",
    "how much do I have in cash",
    "how much are my subscriptions",
    "when is my next bill due",
    "how much have I saved toward vacation",
    "what's my savings rate this month",
    "what's my runway if rent goes up by $200",
    "what's my income this month",
    "what was my income for July",
    "what's my average spend on groceries in July",
    "how many transactions do I have in Dining Out in July",
    "how much did Alex spend in July",
  ])
    it(`legacy: ${question}`, () => {
      expect(parse(question)).toEqual({ status: "legacy" });
    });

  it("a word from an account name is not mistaken for the savings-rate family", () => {
    expect(request("what did I spend on Emergency Savings last month")).toMatchObject({ accountIds: [2] });
  });
  it("a family member combined with a store is not silently dropped", () => {
    expect(parse("how much did Alex spend at Costco last month").status).not.toBe("query");
  });
});

describe("found by probing the generated question corpus (written before the fixes)", () => {
  const withIncome: ParseContext = { ...context, categories: [...context.categories, "Income", "Bills"] };
  it("income words always go to the older matcher, even when a category is named Income", () => {
    expect(parse("what was my income in 2023", withIncome)).toEqual({ status: "legacy" });
    expect(parse("what's my income this month", withIncome)).toEqual({ status: "legacy" });
  });
  it("a category that shares a word with an older family still works when the question is about spending", () => {
    expect(parse("how much did I spend on bills last month", withIncome)).toMatchObject({ status: "query", request: { categories: ["Bills"] } });
  });
  it("a short word never fuzzy-matches a store or a person", () => {
    expect(parse("who let the dogs out").status).toBe("unsupported");
  });
  it("a command to change data is refused even when it mentions an older-family word", () => {
    expect(parse("transfer $500 to savings")).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/can't change/i) });
  });
  it("a forecast is refused rather than answered with today's number", () => {
    expect(parse("what will my net worth be in 10 years").status).toBe("unsupported");
  });
  it("'how much do I have in <account>' is a balance question", () => {
    expect(parse("how much do I have in Everyday Checking")).toEqual({ status: "legacy" });
  });
  it("which and to-date phrasings", () => {
    expect(request("which two categories cost me the most since june")).toMatchObject({ kind: "rank-categories", limit: 2, periods: [{ from: "2026-06-01", to: "2026-09-06" }] });
    expect(request("year to date spending").periods).toEqual([{ from: "2026-01-01", to: "2026-09-06" }]);
    expect(request("spending month to date").periods).toEqual([september]);
  });
  it("'difference between' is a comparison, but a bare 'between' is not", () => {
    expect(request("difference between my spending in July and August")).toMatchObject({ kind: "compare", periods: [july, august] });
    expect(parse("groceries between march and may").status).not.toBe("query");
  });
});

describe("history that cannot exist", () => {
  const known: ParseContext = { ...context, historyStart: "2025-09-01" };
  it("refuses a period that ends before the first recorded transaction", () => {
    expect(parse("how much did I spend in 2024", known)).toMatchObject({ status: "unsupported", reason: expect.stringContaining("September 1, 2025") });
    expect(parse("dining out in march 2025", known).status).toBe("unsupported");
    expect(parse("compare 2024 with 2025", known).status).toBe("unsupported");
  });
  it("answers a period that only partly overlaps and says when the records start", () => {
    const result = parse("total spending in 2025", known);
    expect(result).toMatchObject({ status: "query", interpretation: { earliestRecord: "2025-09-01" } });
  });
  it("without a known start it does not refuse", () => {
    expect(parse("how much did I spend in 2024").status).toBe("query");
  });
});

describe("found by the three-seed acceptance run (written before the fixes)", () => {
  const ctx: ParseContext = {
    ...context,
    categories: [...context.categories, "Education", "Coffee Shops", "Gifts", "Home Repairs"],
    accounts: [...context.accounts, { id: 4, name: "Cash Wallet" }],
    merchants: [...(context.merchants ?? []), "KROGER #2", "HOME DEPOT #3"],
    historyStart: "2025-07-01",
  };
  const q = (question: string) => {
    const r = parseQuestion(question, ctx);
    if (r.status !== "query") throw new Error(`${question} -> ${JSON.stringify(r)}`);
    return r;
  };

  describe("everyday typos in the wording are corrected visibly", () => {
    for (const [typed, fixed] of [
      ["how much did I sppend on groceries last month", "sppend"],
      ["how much did I speend on groceries last month", "speend"],
      ["what did I spned last month", "spned"],
      ["total spendnig in february 2026", "spendnig"],
      ["what are my two biggset spending categories in may 2026", "biggset"],
      ["what are my three biggst spending categories last month", "biggst"],
      ["top 3 purchasees last month", "purchasees"],
      ["top 3 puchases in december 2025", "puchases"],
      ["last month rank 3 categores by spending", "categores"],
      ["what did I spend in augst 2025", "augst"],
      ["groceries in ocotber 2025", "ocotber"],
      ["groceries in marhc", "marhc"],
      ["groceries in novembre 2025", "novembre"],
      ["groceries in aprl 2026", "aprl"],
      ["groceries in deember 2025", "deember"],
      ["groceries in Seeptember 2025", "seeptember"],
    ] as const)
      it(`reads "${typed}"`, () => {
        const r = q(typed);
        expect(r.corrections.map((c) => c.from)).toContain(fixed);
        expect(r.request.periods.length).toBeGreaterThan(0);
      });

    it("the correction keeps the meaning of the rest of the question", () => {
      expect(q("how much did I sppend on groceries last month").request).toEqual(request("how much did I spend on groceries last month"));
    });
    it("a word that is close to two different words is not corrected", () => {
      expect(parse("groceries lasst mnth").status).not.toBe("query");
    });
    it("negation, scope, amount and command words are never corrected into place", () => {
      expect(parse("groceries last month withhout costco").status).toBe("unsupported");
      expect(parse("purchases ovr $500 last month").status).not.toBe("query");
      expect(parse("groceries befor july").status).not.toBe("query");
      expect(parse("how much did I spend on groceries last month and delte it").status).not.toBe("query");
    });
    it("a four-letter word is not turned into another four-letter word", () => {
      expect(parse("groceries thin month").status).not.toBe("query");
    });
    it("a word typed in the middle of a period phrase is corrected too", () => {
      for (const text of ["what did I spend the most on this qurater", "how much did I spend in the past 3 monnths", "top 2 spending categories this quartr for transactions more than $75", "dining spending this quater versus last quarter"]) {
        expect(parse(text, ctx).status, text).toBe("query");
      }
    });
    it("a swapped-letter spend is read as spend, even though send is a different word", () => {
      expect(q("how much did I sepnd on groceries last month").request).toEqual(request("how much did I spend on groceries last month"));
      expect(parse("how much did I send on groceries last month").status).toBe("unsupported");
    });
    it("everyday words are corrected too", () => {
      expect(parse("eveyrthing except dining in june", ctx).status).toBe("query");
      expect(parse("whts the total I spent on groceries in august 2026", ctx).status).toBe("query");
    });
    it("a known word that does not belong there is refused, never swapped for a neighbouring word", () => {
      expect(parse("groceries months").status).not.toBe("query");
      expect(parse("groceries years last month").status).not.toBe("query");
    });
    it("numbers are never corrected", () => {
      expect(parse("top 3 spending categories last month for transactions over $1OO").status).not.toBe("query");
    });
  });

  describe("an account or category whose name starts with an older-family word", () => {
    it("a typo in a two-word name still finds the name, not the older word", () => {
      expect(q("dining on my Cash Wallt account from 2026-06-03 to 2026-06-17").request.accountIds).toEqual([4]);
      expect(q("spending on Cash Walet month to date").request.accountIds).toEqual([4]);
    });
    it("the older word alone still goes to the older matcher", () => {
      expect(parse("how much cash do I have", ctx)).toEqual({ status: "legacy" });
    });
    it("a typo in a category after 'without' is that category, not a store with the same first word", () => {
      expect(q("spending last year without home repaiirs").request.excludeCategories).toEqual(["Home Repairs"]);
    });
  });

  describe("found by the misspelling sweep (a slip must never change the question)", () => {
    const stores: ParseContext = { ...ctx, merchants: [...(ctx.merchants ?? []), "DOMINOS #5", "SHELL #9", "WENDYS #7"] };
    it("a slip in the first word of a store's name is never read as a category that starts with the same word", () => {
      const r = parse("top 5 purchases at domino's, hmoe depot, shell and wendy's in december", stores);
      expect(r).toMatchObject({ status: "clarify", choices: expect.arrayContaining(["HOME DEPOT"]) });
      if (r.status === "clarify") expect(r.replacements![r.choices.indexOf("HOME DEPOT")]).toContain('"home depot"');
    });
    it("the same slip outside a list asks about the store too", () => {
      expect(parse("how much did I spend at hmoe depot last month", stores)).toMatchObject({ status: "clarify", choices: ["HOME DEPOT"] });
    });
    it("a category is only matched by a slip when the whole name was typed", () => {
      expect(parse("spending on hmoe last month", stores).status).not.toBe("query");
      expect(q("spending on hmoe repairs last month").request.categories).toEqual(["Home Repairs"]);
      expect(q("spending on home last month").request.categories).toEqual(["Home Repairs"]);
    });
    const lists: ParseContext = {
      ...ctx,
      categories: [...ctx.categories, "Insurance", "Pets"],
      merchants: [...(ctx.merchants ?? []), "SPOTIFY #1", "WALGREENS #2", "WENDYS #7", "ALDI #1", "PETCO #3", "COSTCO #12"],
    };
    it("a misspelled store inside a list is never dropped, even when it looks like a wording word", () => {
      for (const text of ["insurance at Spotify, Walgreens, costcs and wendy's yesterday", "top 2 purchases at shell, spotify and costso in the past 2 months"]) {
        const r = parse(text, lists);
        expect(r.status, text).toBe("clarify");
        if (r.status === "clarify") expect(r.choices).toContain("COSTCO");
      }
    });
    it("a word that is close to both a category and a store asks which", () => {
      const r = parse("how much did I spend at Aldi and peto last week", lists);
      expect(r).toMatchObject({ status: "clarify", choices: expect.arrayContaining(["PETCO", "Pets"]) });
      if (r.status === "clarify") expect(r.replacements).toHaveLength(r.choices.length);
    });
    it("a word that could be two different words is not guessed", () => {
      expect(parse("How mach did I spend at costco?", stores).status).not.toBe("query");
      expect(parse("How mach did I spend at costco in august 2026?", stores).status).not.toBe("query");
    });
  });

  describe("a misspelled store", () => {
    it("in a list, a close name is offered, like after 'at'", () => {
      expect(parse("how much did I spend at costco and Krroger last month", ctx)).toMatchObject({ status: "clarify", choices: ["KROGER"] });
    });
    it("two neighbouring letters swapped still suggests the store", () => {
      expect(parse("How much did I spend at Wohle foods last month", ctx)).toMatchObject({ status: "clarify", choices: ["WHOLE FOODS MARKET"] });
    });
    it("a stranger in a list is still refused by name", () => {
      expect(parse("how much did I spend at costco and zzyzx last month", ctx)).toMatchObject({ status: "unsupported", reason: expect.stringContaining("zzyzx") });
    });
  });

  describe("a misspelled category name", () => {
    it("one letter swapped is still the category, and the correction is shown", () => {
      const r = q("Eudcation spending this year");
      expect(r.request.categories).toEqual(["Education"]);
      expect(r.corrections).toEqual(expect.arrayContaining([{ from: "eudcation", to: "Education" }]));
      expect(q("gfits in march").request.categories).toEqual(["Gifts"]);
      expect(q("top 2 cofefe shops purchases in may 2026").request.categories).toEqual(["Coffee Shops"]);
    });
  });

  describe("polite filler around a question is ignored, and nothing else is", () => {
    const groceries = request("how much did I spend on groceries last month");
    for (const text of [
      "okay so how much did I spend on groceries last month",
      "hey could you tell me how much did I spend on groceries last month when you get a chance",
      "I was wondering, how much did I spend on groceries last month",
      "quick question - how much did I spend on groceries last month",
      "how much did I spend on groceries last month, thanks",
      "I'm trying to figure this out: how much did I spend on groceries last month",
      "would you mind telling me how much did I spend on groceries last month",
      "for my records how much did I spend on groceries last month",
      "how much did I spend on groceries last month? please",
      "what did I spend this year? please",
    ])
      it(`reads: ${text}`, () => {
        const r = parse(text);
        expect(r.status).toBe("query");
        if (r.status === "query" && text.includes("groceries")) expect(r.request).toEqual(groceries);
      });
    it("filler in the middle of a question is not silently dropped", () => {
      expect(parse("groceries thanks last month").status).not.toBe("query");
      expect(parse("groceries okay so last month").status).not.toBe("query");
    });
    it("filler never rescues a question that is otherwise refused", () => {
      expect(parse("okay so groceries last month without").status).toBe("unsupported");
      expect(parse("hey delete my groceries category thanks").status).toBe("unsupported");
    });
    it("nothing but filler is not a question", () => {
      expect(parse("okay so thanks").status).toBe("unsupported");
    });
  });

  describe("asking to see transactions is not asking for a total", () => {
    it("is pointed to the Transactions tab instead of being answered with a sum", () => {
      for (const text of ["list all my transactions in september 2025", "list all my transactions in 2026", "show my purchases last month", "my transactions last month"]) {
        expect(parse(text, ctx), text).toMatchObject({ status: "unsupported", reason: expect.stringContaining("Transactions") });
      }
    });
    it("a purchase word with a real question is still answered", () => {
      expect(parse("purchases over $500 this year", ctx).status).toBe("query");
      expect(parse("top 3 purchases last month", ctx).status).toBe("query");
      expect(parse("how much did I spend on purchases last month", ctx).status).toBe("query");
    });
  });

  describe("a person and a store together", () => {
    it("is refused in plain words, never answered for the person alone", () => {
      for (const text of ["how much did Alex spend at Costco last month", "spending last month for people named alex at Costco", "alex spending at costco last month"]) {
        expect(parse(text, { ...known, merchants: [...(known.merchants ?? []), "KROGER #1"] })).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/person/i) });
      }
    });
  });
});

const known = context;
