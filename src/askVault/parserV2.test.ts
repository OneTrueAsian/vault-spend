import { describe, expect, it } from "vitest";
import { parseQuestion } from "./parser";
import type { ParseContext, ParseOutcome } from "./types";

// A small household written for these tests: today is 30 March 2026.
const base: ParseContext = {
  today: "2026-03-30",
  categories: ["Groceries", "Fuel", "Dining Out", "Shopping"],
  accounts: [{ id: 1, name: "Joint" }, { id: 2, name: "Sam Card" }],
  merchants: ["KROGER #12", "SAMS CLUB #55", "SHELL #4"],
  members: ["Sam", "Alex", "Robin"],
};
const family = [{ id: 1, name: "Sam" }, { id: 2, name: "Alex" }, { id: 3, name: "Robin" }];
const v2: ParseContext = { ...base, familyMembers: family };

const ask = (question: string, context: ParseContext = v2) => parseQuestion(question, context);
const query = (question: string, context: ParseContext = v2) => {
  const outcome = ask(question, context);
  expect(outcome.status, (outcome as { reason?: string }).reason ?? "").toBe("query");
  return (outcome as Extract<ParseOutcome, { status: "query" }>).request as any;
};
const stop = (question: string, status: "unsupported" | "clarify", reason: RegExp) => {
  const outcome = ask(question) as { status: string; reason: string };
  expect(outcome.status).toBe(status);
  expect(outcome.reason).toMatch(reason);
  return outcome as unknown as { choices?: string[]; replacements?: string[] };
};
const everyReplacementAnswers = (outcome: { replacements?: string[] }) => {
  expect(outcome.replacements?.length).toBeGreaterThan(0);
  for (const replacement of outcome.replacements ?? []) expect(ask(replacement).status, replacement).toBe("query");
};

describe("comparison purchase thresholds", () => {
  for(const [word,inclusive] of [["over",false],["at least",true]] as const) it(`preserves a ${word} threshold in both-period comparisons`,()=>{
    const request=query(`compare groceries ${word} $100 this month to last month`);
    expect(request).toMatchObject({kind:"compare",categories:["Groceries"],minimumPurchase:{amount:"100.00",inclusive},periods:[{from:"2026-03-01",to:"2026-03-30"},{from:"2026-02-01",to:"2026-02-28"}]});
    expect(request.contractVersion).toBeUndefined(); // The existing native v1 fields already express this read.
  });
  it("combines the threshold with members, category OR, account and same-days alignment",()=>{
    const request=query("compare what sam spent on groceries and shopping over $100 on joint this month to the same days last month");
    expect(request).toMatchObject({contractVersion:2,kind:"compare",members:{ids:[1],unassigned:false},categories:["Groceries","Shopping"],accountIds:[1],minimumPurchase:{amount:"100.00",inclusive:false},alignment:"same-days-previous-month",periods:[{from:"2026-03-01",to:"2026-03-30"},{from:"2026-02-01",to:"2026-02-28"}]});
  });
  it("keeps M1 refusal and does not turn result counts or unsupported thresholds into comparisons",()=>{
    expect(ask("compare groceries over $100 this month to last month",base).status).toBe("unsupported");
    for(const question of ["compare 3 purchases this month to last month","compare groceries under $100 this month to last month","compare groceries over $100 and over $200 this month to last month"])
      expect(ask(question).status,question).toBe("unsupported");
  });
});

describe("answerable ranking and member clarification choices", () => {
  it("offers explicit counts and dates for bare top spending, with every choice answerable", () => {
    const outcome = ask("top spending");
    expect(outcome.status).toBe("clarify");
    if (outcome.status !== "clarify") throw Error("Expected ranking choices");
    expect(outcome.choices.length).toBeLessThanOrEqual(12);
    expect(outcome.choices.length).toBeGreaterThan(0);
    const requests = outcome.replacements!.map(replacement => {
      const next = ask(replacement);
      expect(next.status, replacement).toBe("query");
      if (next.status !== "query") throw Error("Unanswerable ranking choice");
      expect(next.request.limit).toBe(5);
      expect(next.request.periods).toHaveLength(1);
      return next.request.kind;
    });
    expect(new Set(requests)).toEqual(new Set(["rank-categories", "rank-purchases"]));
    expect(outcome.choices.every(choice => /5/.test(choice))).toBe(true);
  });
  for (const name of ["O'Neil", "O’Neil"]) it(`binds every lookalike choice to the selected member id for ${name}`, () => {
    const familyMembers = [{ id: 8, name: "O'Neil" }, { id: 7, name: "O’Neil" }];
    const context = { ...v2, familyMembers };
    const outcome = ask(`how much did ${name} spend on groceries over $10 this month`, context);
    expect(outcome.status).toBe("clarify");
    if (outcome.status !== "clarify") throw Error("Expected member choices");
    expect(outcome.memberSelections).toHaveLength(2);
    for (const [i, selected] of outcome.memberSelections!.entries()) {
      const next = parseQuestion(outcome.replacements![i], context, selected);
      expect(next.status).toBe("query");
      if (next.status !== "query") throw Error("Unanswerable member choice");
      expect(next.request).toMatchObject({members:{ids:[selected[0].id],unassigned:false},categories:["Groceries"],minimumPurchase:{amount:"10.00",inclusive:false},periods:[{from:"2026-03-01",to:"2026-03-30"}]});
    }
  });
  it("refuses a member choice that no longer belongs to the current roster", () => {
    expect(parseQuestion("how much did O’Neil spend this month", {...v2,familyMembers:[{id:7,name:"O’Neil"}]}, [{id:8,name:"O'Neil",occurrence:0}]).status).toBe("unsupported");
  });
  it("does not turn a clearly named category or calendar month into a member choice", () => {
    const categoryContext={...v2,categories:[...v2.categories,"O’Neil"],familyMembers:[{id:7,name:"O’Neil"},{id:8,name:"O'Neil"}]};
    const category=ask("spending on O’Neil this month",categoryContext);
    expect(category.status).toBe("query");
    if(category.status!=="query")throw Error("Expected a category total");
    expect(category.request.categories).toEqual(["O’Neil"]);
    expect("members" in category.request).toBe(false);
    const monthContext={...v2,today:"2026-09-06",historyStart:"2026-01-01",familyMembers:[{id:7,name:"June"},{id:8,name:"june"}]};
    const month=ask("spending in June",monthContext);
    expect(month.status).toBe("query");
    if(month.status!=="query")throw Error("Expected a calendar month");
    expect(month.request.periods).toEqual([{from:"2026-06-01",to:"2026-06-30"}]);
  });
  it("keeps both ids when two different ambiguous names need choosing", () => {
    const context = {...v2,familyMembers:[{id:7,name:"O’Neil"},{id:8,name:"O'Neil"},{id:9,name:"D’Arcy"},{id:10,name:"D'Arcy"}]};
    const outcome=ask("how much did O’Neil and D’Arcy spend this month",context);
    expect(outcome.status).toBe("clarify");
    if(outcome.status!=="clarify")throw Error("Expected member choices");
    expect(outcome.memberSelections).toHaveLength(4);
    for(const [i,selected] of outcome.memberSelections!.entries()){
      const next=parseQuestion(outcome.replacements![i],context,selected);
      expect(next.status).toBe("query");
      if(next.status!=="query")throw Error("Unanswerable member choices");
      expect(next.request).toMatchObject({members:{ids:selected.map(m=>m.id),unassigned:false}});
    }
  });
  it("resolves repeated lookalike names separately rather than dropping a requested person", () => {
    const context={...v2,familyMembers:[{id:7,name:"O’Neil"},{id:8,name:"O'Neil"}]};
    const outcome=ask("how much did O’Neil and O'Neil spend this month",context);
    expect(outcome.status).toBe("clarify");
    if(outcome.status!=="clarify")throw Error("Expected member choices");
    expect(outcome.memberSelections).toHaveLength(4);
    const both=outcome.memberSelections!.findIndex(m=>m.length===2&&m[0].id===7&&m[1].id===8);
    expect(both).toBeGreaterThanOrEqual(0);
    const next=parseQuestion(outcome.replacements![both],context,outcome.memberSelections![both]);
    expect(next.status).toBe("query");
    if(next.status!=="query")throw Error("Expected both members");
    expect(next.request).toMatchObject({members:{ids:[7,8],unassigned:false}});
  });
});

describe("without family members in the context, the older rules still hold", () => {
  it("hands a member question to the older matcher and keeps one category at a time", () => {
    expect(ask("how much did sam spend this month", base)).toEqual({ status: "legacy" });
    expect(ask("average purchase at kroger", base)).toEqual({ status: "legacy" });
    expect(ask("groceries and fuel this year", base)).toMatchObject({ status: "unsupported" });
  });
  it("gives the plain version 1 request for a question that needs nothing new, in either context", () => {
    for (const context of [base, v2]) {
      const request = query("compare groceries this month to last month", context);
      expect(request.contractVersion).toBeUndefined();
      expect(request.members).toBeUndefined();
      expect(request.categories).toEqual(["Groceries"]);
    }
  });
});

describe("several categories", () => {
  it("are an OR in the order asked, with the other choices as an AND", () => {
    const request = query("groceries, fuel and dining out on sam card this year");
    expect(request).toMatchObject({ contractVersion: 2, categories: ["Groceries", "Fuel", "Dining Out"], accountIds: [2] });
  });
  it("cannot limit a ranking of categories", () => {
    stop("top 3 categories for groceries this year", "unsupported", /ranking of categories/);
  });
});

describe("family members", () => {
  it("are chosen by name after did, has or for, or before a spending word", () => {
    for (const question of ["how much did sam spend this month", "how much has sam spent this month", "sam spent how much this month", "top 3 purchases for sam this month"]) {
      expect(query(question).members).toEqual({ ids: [1], unassigned: false });
    }
  });
  it("can be several, in the order named, and combine with a leave-out", () => {
    const request = query("how much did robin and sam spend on fuel this month without shell");
    expect(request.members).toEqual({ ids: [3, 1], unassigned: false });
    expect(request.excludeVendors).toEqual(["shell"]);
  });
  it("can be the purchases nobody is assigned to", () => {
    expect(query("how much did I spend this month that is not assigned to a family member").members).toEqual({ ids: [], unassigned: true });
  });
  it("can be left out only by naming the others", () => {
    stop("how much did I spend this month except sam", "unsupported", /leave a family member out/);
  });
  it("ask when a bare name could also be a store, and every choice answers", () => {
    const outcome = stop("sam this year", "clarify", /family member or a store/i);
    expect(outcome.choices).toHaveLength(2);
    everyReplacementAnswers(outcome);
  });
  it("are never guessed: an unknown name, or nobody set up, is a stop that says so", () => {
    stop("how much did taylor spend this month", "unsupported", /no family member called Taylor.*Sam, Alex and Robin/);
    stop("how much did taylor and sam spend this month", "unsupported", /no family member called Taylor/);
    const none = ask("how much did sam spend this month", { ...base, familyMembers: [] }) as { status: string; reason: string };
    expect(none).toMatchObject({ status: "unsupported" });
    expect(none.reason).toMatch(/No family members are set up/);
  });
  it("leave a store alone when it comes after at", () => {
    const request = query("how much did I spend at sams club this year");
    expect(request.vendors).toEqual(["sams club"]);
    expect(request.contractVersion).toBeUndefined();
  });
});

describe("breakdowns", () => {
  it("by month and by family member, one at a time", () => {
    expect(query("groceries by month this year")).toMatchObject({ groupBy: "month", average: "none" });
    expect(query("monthly groceries over the past 6 months")).toMatchObject({ groupBy: "month" });
    expect(query("what did each family member spend this month")).toMatchObject({ groupBy: "member" });
    stop("spending by month and by family member this year", "unsupported", /one breakdown at a time/);
  });
  it("do not combine with a comparison or a ranking", () => {
    stop("compare groceries by month this year to last year", "unsupported", /comparisons/);
    stop("top 3 categories by month this year", "unsupported", /rankings/);
  });
  it("are by month only", () => {
    stop("spending by quarter this year", "unsupported", /not by quarter/);
    stop("per day spending this month", "unsupported", /not by day/);
  });
  it("stop at 50 lines and ask for a shorter range, and every choice answers", () => {
    const outcome = stop("spending by month over the past 5 years", "clarify", /more than 50 months/);
    everyReplacementAnswers(outcome);
  });
});

describe("averages", () => {
  it("per month, or per purchase", () => {
    expect(query("average monthly fuel from 2025-12-01 to 2026-02-28")).toMatchObject({ average: "per-month", groupBy: "none", categories: ["Fuel"] });
    expect(query("average groceries per month this year").average).toBe("per-month");
    expect(query("average purchase at kroger this year")).toMatchObject({ average: "per-purchase", vendors: ["kroger"] });
    expect(query("average dining out purchase this month")).toMatchObject({ average: "per-purchase", categories: ["Dining Out"] });
  });
  it("ask which kind when only the word average is given", () => {
    const outcome = stop("what is my average spending this year", "clarify", /average/);
    expect(outcome.choices).toEqual(["Per purchase", "Per month"]);
    everyReplacementAnswers(outcome);
  });
  it("ask about a rolling window, which starts part-way through a month", () => {
    const outcome = stop("average monthly spending over the past 3 months", "clarify", /whole months/);
    expect(outcome.replacements).toEqual([
      "average monthly spending from 2025-12-01 to 2026-02-28",
      "average monthly spending from 2025-12-30 to 2026-03-30",
    ]);
    everyReplacementAnswers(outcome);
  });
  it("answer dates the person chose, and the month so far", () => {
    expect(query("average monthly groceries from 2025-09-30 to 2026-03-30").average).toBe("per-month");
    expect(query("average monthly spending this month").average).toBe("per-month");
  });
  it("are not per day or per week, and are not split by family member", () => {
    stop("average daily spending this month", "unsupported", /per day/);
    stop("average weekly groceries this year", "unsupported", /per week/);
    stop("average spending per member this year", "unsupported", /split by family member/);
  });
  it("do not combine with a comparison or a ranking", () => {
    stop("compare average monthly groceries this year to last year", "unsupported", /comparisons/);
  });
});

describe("comparing the same days", () => {
  it("of the month before, stopping where that month ends", () => {
    const request = query("compare groceries so far this month to the same days last month");
    expect(request).toMatchObject({ kind: "compare", alignment: "same-days-previous-month" });
    expect(request.periods).toEqual([{ from: "2026-03-01", to: "2026-03-30" }, { from: "2026-02-01", to: "2026-02-28" }]);
  });
  it("of a named month, only when it is the month before", () => {
    expect(query("compare groceries in february to the same days in january").periods).toEqual([
      { from: "2026-02-01", to: "2026-02-28" },
      { from: "2026-01-01", to: "2026-01-28" },
    ]);
    stop("compare groceries in february to the same days in december", "unsupported", /month right before/);
  });
  it("of the year before", () => {
    const request = query("compare groceries so far this year to the same days last year");
    expect(request.alignment).toBe("same-days-previous-year");
    expect(request.periods[1]).toEqual({ from: "2025-01-01", to: "2025-03-30" });
  });
  it("need a calendar month for the month before, and a comparison to mean anything", () => {
    stop("compare groceries from 2026-03-05 to 2026-03-30 to the same days last month", "unsupported", /one calendar month/);
    stop("groceries this month and the same days last month", "unsupported", /only works in a comparison/);
  });
  it("do not take a second period as well", () => {
    stop("compare groceries this month to last month to the same days last month", "unsupported", /one time period/);
  });
});

describe("every word is still accounted for", () => {
  it("never answers a smaller question when an extra word is left over", () => {
    stop("how much did sam spend on groceries this year per kitten", "unsupported", /don.t understand/);
    stop("how much did sam spend on groceries this year before june", "unsupported", /before|after/);
  });
});

// ---- Review findings (15 October): each of these was reproduced before it was fixed.
const clash: ParseContext = {
  ...v2,
  categories: [...base.categories, "Pets"],
  accounts: [...base.accounts, { id: 3, name: "Joint Savings" }],
  merchants: [...(base.merchants ?? []), "FAMILY DOLLAR #12"],
  familyMembers: [...family, { id: 4, name: "May" }, { id: 5, name: "Fuel" }, { id: 6, name: "Joint" }],
};
const clashed = (question: string) => query(question, clash);
const clarifyAt = (question: string, context: ParseContext) => {
  const outcome = parseQuestion(question, context) as Extract<ParseOutcome, { status: "clarify" }>;
  expect(outcome.status, question).toBe("clarify");
  return outcome;
};
const everyChoiceAnswers = (outcome: Extract<ParseOutcome, { status: "clarify" }>, context: ParseContext) => {
  expect(outcome.replacements?.length, "choices and replacements line up").toBe(outcome.choices.length);
  for (const replacement of outcome.replacements ?? []) expect(parseQuestion(replacement, context).status, replacement).toBe("query");
};

describe("a family member's name that is also a month, account or category", () => {
  it("is a date, an account or a category after on/in/at, never a person", () => {
    expect(clashed("groceries in may").members).toBeUndefined();
    expect(clashed("groceries in may").periods[0].from.slice(5, 7)).toBe("05");
    expect(clashed("how much did I spend on joint this year")).toMatchObject({ accountIds: [1] });
    expect(clashed("how much did I spend on joint this year").members).toBeUndefined();
    expect(clashed("how much did I spend on fuel this year").categories).toEqual(["Fuel"]);
    expect(clashed("how much did I spend on fuel this year").members).toBeUndefined();
  });
  it("is the person when the words say whose spending it is", () => {
    expect(clashed("how much did may spend this year").members).toEqual({ ids: [4], unassigned: false });
    expect(clashed("how much did joint spend this year")).toMatchObject({ members: { ids: [6], unassigned: false }, accountIds: [] });
    expect(clashed("how much did fuel spend this year").members).toEqual({ ids: [5], unassigned: false });
  });
  it("asks when the bare name could be either, and every choice answers", () => {
    for (const question of ["joint this year", "fuel this year"]) {
      const outcome = clarifyAt(question, clash);
      expect(outcome.choices).toHaveLength(2);
      everyChoiceAnswers(outcome, clash);
    }
  });
  it("leaves a longer account name alone", () => {
    expect(clashed("joint savings this year")).toMatchObject({ accountIds: [3] });
  });
});

describe("store names that contain a grammar word", () => {
  it("still read as stores with the family list present", () => {
    expect(query("how much did I spend at family dollar this year", clash).vendors).toEqual(["family dollar"]);
    expect(query("family dollar this year", clash).vendors).toEqual(["family dollar"]);
  });
  it("and the grammar words still work beside them", () => {
    expect(query("what did each family member spend this month").groupBy).toBe("member");
  });
});

describe("a clarification never leads to another clarification", () => {
  it("even when the question had no time period yet", () => {
    for (const question of ["what is my average spending", "sam", "joint", "fuel"]) {
      const outcome = clarifyAt(question, clash);
      everyChoiceAnswers(outcome, clash);
    }
  });
  it("and each choice still says what it means", () => {
    const outcome = clarifyAt("what is my average spending", clash);
    expect(outcome.choices.some((c) => /per purchase/i.test(c)) && outcome.choices.some((c) => /per month/i.test(c))).toBe(true);
    expect(outcome.choices.every((c) => /last month|this month|this year/i.test(c))).toBe(true);
  });
});

describe("ranking categories among several", () => {
  it("is supported, in the family-aware grammar only", () => {
    expect(query("top 3 categories for groceries and fuel this year")).toMatchObject({ kind: "rank-categories", categories: ["Groceries", "Fuel"], limit: 3 });
    expect(ask("top 3 categories for groceries and fuel this year", base)).toMatchObject({ status: "unsupported" });
  });
  it("still cannot be limited to one category", () => {
    stop("top 3 categories for groceries this year", "unsupported", /ranking of categories/);
  });
});

describe("the 20-selection cap", () => {
  const many: ParseContext = { ...v2, categories: Array.from({ length: 24 }, (_, i) => `zeta${String.fromCharCode(97 + i)}`) };
  const names = (n: number) => many.categories.slice(0, n).join(", ");
  it("is enforced for categories, and counts accounts and people with them", () => {
    expect(query(`${names(20)} this year`, many).categories).toHaveLength(20);
    expect(parseQuestion(`${names(21)} this year`, many)).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/20/) });
    const mixed = parseQuestion(`how much did sam and alex spend on joint and ${names(18)} this year`, many) as { status: string; reason?: string };
    expect(mixed).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/20/) });
  });
});

describe("average wording that names both a purchase and a month", () => {
  it("asks which one is meant, and every choice answers", () => {
    for (const question of ["average monthly purchase this year", "average purchase per month this year"]) {
      const outcome = clarifyAt(question, v2);
      expect(outcome.choices).toHaveLength(2);
      everyChoiceAnswers(outcome, v2);
      const kinds = (outcome.replacements ?? []).map((r) => (parseQuestion(r, v2) as any).request.average);
      expect(kinds.sort()).toEqual(["per-month", "per-purchase"]);
    }
  });
});

describe("clarifications are closed across many phrasings", () => {
  const prefixes = ["", "how much did I spend", "average", "average monthly", "top 3 categories", "how much did sam spend", "sam", "average purchase", "monthly"];
  const subjects = ["", "on groceries and fuel", "at kroger", "by month", "per month", "monthly purchase", "sam", "joint"];
  const periods = ["", "this year", "over the past 3 months", "over the past 5 years", "since may"];
  it("gives every choice an answer or a stop, never another question", () => {
    let asked = 0;
    for (const context of [v2, clash]) {
      for (const prefix of prefixes) {
        for (const subject of subjects) {
          for (const period of periods) {
            const question = [prefix, subject, period].filter(Boolean).join(" ");
            if (!question) continue;
            const outcome = parseQuestion(question, context);
            if (outcome.status !== "clarify") continue;
            asked++;
            expect(outcome.replacements?.length, question).toBe(outcome.choices.length);
            for (const replacement of outcome.replacements ?? []) expect(parseQuestion(replacement, context).status, `${question} -> ${replacement}`).toBe("query");
          }
        }
      }
    }
    expect(asked).toBeGreaterThan(50);
  });
  it("leaves the older grammar's clarifications exactly as they were", () => {
    const outcome = parseQuestion("how much did I spend on groceries", base) as Extract<ParseOutcome, { status: "clarify" }>;
    expect(outcome.choices).toEqual(["Last month", "This month so far", "This year so far"]);
  });
});

// Review round 3: store names, closed clarifications, store cues, and names with punctuation.
const named: ParseContext = {
  ...v2,
  merchants: ["MONTHLY MARKET #3", "AVERAGE JOES #2", "KROGER #12", "SAMS CLUB #55", "SHELL #4"],
  familyMembers: [...family, { id: 4, name: "Mary-Jane" }, { id: 5, name: "O’Brien" }, { id: 6, name: "O'Neil" }, { id: 7, name: "Dr. Lee" }],
};
const stores: ParseContext = { ...v2, merchants: ["SAMS CLUB #55", "KROGER #12"] };

describe("a store whose name contains a grammar word", () => {
  it("is the store, with no cue needed beyond 'at', 'on' or 'from'", () => {
    for (const question of ["how much did I spend at monthly market this year", "spend on monthly market this year", "spend from monthly market this year"]) {
      const request = query(question, named);
      expect(request.vendors, question).toEqual(["monthly market"]);
      expect(request.groupBy ?? "none", question).toBe("none");
    }
    const joes = query("how much did I spend at average joes this year", named);
    expect(joes.vendors).toEqual(["average joes"]);
    expect(joes.average ?? "none").toBe("none");
  });
  it("asks when nothing says which it is, and both choices answer", () => {
    for (const question of ["monthly market this year", "average joes this year"]) {
      const outcome = clarifyAt(question, named);
      expect(outcome.choices.length, question).toBe(outcome.replacements?.length);
      everyChoiceAnswers(outcome, named);
      expect((outcome.replacements ?? []).some((r) => (parseQuestion(r, named) as any).request.vendors.length === 1), question).toBe(true);
    }
  });
  it("leaves the grammar word alone when the next word is not part of the store", () => {
    expect(query("monthly groceries this year", named)).toMatchObject({ groupBy: "month", categories: ["Groceries"] });
    expect(query("monthly spending this year", named).groupBy).toBe("month");
  });
});

describe("every choice of every clarification answers", () => {
  it("drops a choice that would only lead to a stop, and stops with the reason when none is left", () => {
    const outcome = ask("sam this month to last month", stores) as { status: string; reason?: string };
    expect(outcome.status).toBe("unsupported");
    expect(outcome.reason).toMatch(/compare/);
  });
  it("holds over a wide sweep of phrasings and clashing names", () => {
    const clashing: ParseContext = {
      ...named,
      categories: [...named.categories, "Pets"],
      accounts: [...named.accounts, { id: 3, name: "Joint Savings" }],
      familyMembers: [...family, { id: 8, name: "May" }, { id: 9, name: "Fuel" }, { id: 10, name: "Joint" }, { id: 11, name: "Pets" }],
    };
    const prefixes = ["", "how much did I spend", "average", "average monthly", "top 3 categories", "top 3 purchases", "compare", "sam", "monthly", "spend on", "how much on"];
    const subjects = ["", "on groceries and fuel", "at kroger", "by month", "monthly purchase", "sam", "joint", "fuel", "may", "pets", "monthly market", "average joes", "sams", "without shell"];
    const periods = ["", "this year", "over the past 3 months", "this month to last month", "this month to the same days last month"];
    let asked = 0;
    for (const context of [named, clashing]) {
      for (const prefix of prefixes) {
        for (const subject of subjects) {
          for (const period of periods) {
            const question = [prefix, subject, period].filter(Boolean).join(" ");
            if (!question) continue;
            const outcome = parseQuestion(question, context);
            if (outcome.status !== "clarify") continue;
            asked++;
            // An open question ("which time period?") has no choices to tap, so nothing to close.
            if (!outcome.replacements) {
              expect(outcome.choices, question).toEqual([]);
              continue;
            }
            expect(outcome.replacements?.length, question).toBe(outcome.choices.length);
            for (const replacement of outcome.replacements ?? []) expect(parseQuestion(replacement, context).status, `${question} -> ${replacement}`).toBe("query");
          }
        }
      }
    }
    expect(asked).toBeGreaterThan(100);
  }, 30000);
  it("still offers the person when a name is also a category, account or store", () => {
    for (const question of ["fuel this year", "joint this year"]) {
      const outcome = clarifyAt(question, { ...clash });
      expect(outcome.choices.some((c) => /family member/i.test(c)), question).toBe(true);
    }
  });
});

describe("on or from a name that is also a store", () => {
  it("is the store: no family-member choice is offered", () => {
    for (const question of ["spend on sam this month", "spend from sam this month"]) {
      const request = query(question, stores);
      expect(request.members, question).toBeUndefined();
      expect(request.vendors, question).toEqual(["sam"]);
    }
    const both: ParseContext = { ...v2, merchants: ["SAMS CLUB #55", "SAMUELS TAILOR #2"] };
    const outcome = clarifyAt("spend on sam this month", both);
    expect(outcome.choices.some((c) => /family member/i.test(c))).toBe(false);
    everyChoiceAnswers(outcome, both);
  });
  it("with no cue word still asks, and with 'did' is the person", () => {
    expect(clarifyAt("sam this month", stores).choices.some((c) => /family member/i.test(c))).toBe(true);
    expect(query("how much did sam spend this month", stores).members).toEqual({ ids: [1], unassigned: false });
  });
});

describe("family member names with punctuation", () => {
  it("match a hyphen, either apostrophe, and a full stop in the name", () => {
    expect(query("how much did mary-jane spend this month", named).members).toEqual({ ids: [4], unassigned: false });
    expect(query("how much did o’brien spend this month", named).members).toEqual({ ids: [5], unassigned: false });
    expect(query("how much did o'brien spend this month", named).members).toEqual({ ids: [5], unassigned: false });
    expect(query("how much did o’neil spend this month", named).members).toEqual({ ids: [6], unassigned: false });
    expect(query("how much did dr. lee spend this month", named).members).toEqual({ ids: [7], unassigned: false });
  });
  it("can be listed with others, and grouped by member", () => {
    expect(query("how much did mary-jane and sam spend this month", named).members).toEqual({ ids: [4, 1], unassigned: false });
    expect(query("what did each family member spend this month", named).groupBy).toBe("member");
  });
  it("work in names of categories and accounts too", () => {
    const hyphen: ParseContext = { ...v2, categories: ["Dining-Out", "Kids’ Clothes"] };
    expect(query("dining-out this year", hyphen).categories).toEqual(["Dining-Out"]);
  });
});

describe("a slip in a spending word is never read as a category", () => {
  const withRent: ParseContext = { ...v2, categories: [...base.categories, "Rent"] };
  it("reads 'sent' as the word 'spent' (and says so), never as the Rent category", () => {
    for (const question of ["how much has robin sent last year", "how much did I sent last year", "compare what robin sent so far this month to the same days last month"]) {
      const outcome = ask(question, withRent) as Extract<ParseOutcome, { status: "query" }>;
      expect(outcome.status, question).toBe("query");
      expect((outcome.request as { categories: string[] }).categories, question).toEqual([]);
      expect(outcome.corrections, question).toContainEqual({ from: "sent", to: "spent" });
    }
    expect(query("how much did I spend on rent last year", withRent).categories).toEqual(["Rent"]);
    expect(query("rent last year", withRent).categories).toEqual(["Rent"]);
  });
  it("holds for the older grammar too", () => {
    const outcome = ask("how much did I sent last year", { ...base, categories: [...base.categories, "Rent"] }) as Extract<ParseOutcome, { status: "query" }>;
    expect(outcome.request.categories).toEqual([]);
  });
});

// Review round 4.
describe("two family members whose names differ only in the apostrophe", () => {
  const twins: ParseContext = { ...v2, familyMembers: [...family, { id: 4, name: "O'Neil" }, { id: 5, name: "O’Neil" }] };
  it("are never told apart silently", () => {
    for (const question of ["how much did o'neil spend this month", "how much did o’neil spend this month", "how much did o'neil and sam spend this month"]) {
      const outcome = ask(question, twins);
      expect(outcome.status, question).not.toBe("query");
      expect((outcome as { reason: string }).reason, question).toMatch(/same name|alike/i);
    }
    expect(query("how much did sam spend this month", twins).members).toEqual({ ids: [1], unassigned: false });
  });
  it("a single O'Neil still works", () => {
    const one: ParseContext = { ...v2, familyMembers: [...family, { id: 4, name: "O’Neil" }] };
    expect(query("how much did o'neil spend this month", one).members).toEqual({ ids: [4], unassigned: false });
  });
});

describe("a store whose whole name is a grammar word, or is long", () => {
  const monthly: ParseContext = { ...v2, merchants: ["MONTHLY", "KROGER #12"] };
  it("is the store after at/on/from, and asked about when nothing else qualifies the word", () => {
    for (const question of ["how much did I spend at monthly this year", "spend on monthly this year", "spend from monthly this year"]) {
      const request = query(question, monthly);
      expect(request.vendors, question).toEqual(["monthly"]);
      expect(request.groupBy ?? "none", question).toBe("none");
    }
    const outcome = clarifyAt("monthly this year", monthly);
    everyChoiceAnswers(outcome, monthly);
    const kinds = (outcome.replacements ?? []).map((r) => (parseQuestion(r, monthly) as any).request);
    expect(kinds.some((r) => r.vendors.length === 1 && (r.groupBy ?? "none") === "none")).toBe(true);
    expect(kinds.some((r) => r.groupBy === "month" && r.vendors.length === 0)).toBe(true);
  });
  it("leaves the grammar word alone when something else follows it", () => {
    expect(query("monthly groceries this year", monthly)).toMatchObject({ groupBy: "month", categories: ["Groceries"] });
    expect(query("monthly spending this year", monthly).groupBy).toBe("month");
  });
  it("a name of five or seven words is one store filter, with or without 'at'", () => {
    const long: ParseContext = { ...v2, merchants: ["ACME HOME GARDEN SUPPLY CENTER #4", "THE FIRST NATIONAL BANK OF NORTH COUNTY #2", "KROGER #12"] };
    for (const [question, term] of [
      ["how much did I spend at acme home garden supply center this year", "acme home garden supply center"],
      ["acme home garden supply center this year", "acme home garden supply center"],
      ["how much did I spend at first national bank of north county this year", "first national bank of north county"],
    ] as const) {
      const request = query(question, long);
      expect(request.vendors, question).toEqual([term]);
    }
  });
});

describe("a quoted name with a hyphen", () => {
  const hyphen = { categories: ["Dining-Out", "Groceries"], accounts: [{ id: 5, name: "Rainy-Day Savings" }, { id: 1, name: "Joint" }] };
  it("matches its category or account in both grammars", () => {
    for (const context of [{ ...base, ...hyphen }, { ...v2, ...hyphen }]) {
      expect(query('how much did I spend on "dining-out" this year', context).categories).toEqual(["Dining-Out"]);
      expect(query('"rainy-day savings" this year', context).accountIds).toEqual([5]);
      expect(query("dining-out this year", context).categories).toEqual(["Dining-Out"]);
      expect(query("rainy-day savings this year", context).accountIds).toEqual([5]);
    }
  });
});

describe("accounts or categories whose names differ only in the apostrophe", () => {
  const twinned = { categories: ["Groceries", "Kids' Clothes", "Kids’ Clothes"], accounts: [{ id: 1, name: "John's Card" }, { id: 2, name: "John’s Card" }, { id: 3, name: "Joint" }] };
  it("are never told apart silently, quoted or not, in both grammars", () => {
    for (const context of [{ ...base, ...twinned }, { ...v2, ...twinned }]) {
      for (const question of [
        "how much did I spend on john's card this year",
        "how much did I spend on john’s card this year",
        'how much did I spend on "john’s card" this year',
        "kids' clothes this year",
        "kids’ clothes this year",
        'how much did I spend on "kids’ clothes" this year',
      ]) {
        const outcome = ask(question, context) as { status: string; reason?: string };
        expect(outcome.status, question).toBe("unsupported");
        expect(outcome.reason, question).toMatch(/look the same|same name/i);
      }
      expect(query("groceries on joint this year", context)).toMatchObject({ categories: ["Groceries"], accountIds: [3] });
    }
  });
  it("a single one of them still works with either apostrophe", () => {
    const one = { ...v2, categories: ["Groceries", "Kids’ Clothes"], accounts: [{ id: 2, name: "John’s Card" }] };
    expect(query("kids' clothes this year", one).categories).toEqual(["Kids’ Clothes"]);
    expect(query("john's card this year", one).accountIds).toEqual([2]);
    expect(query('"kids’ clothes" this year', one).categories).toEqual(["Kids’ Clothes"]);
  });
});
