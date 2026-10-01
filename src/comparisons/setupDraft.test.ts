import { describe, expect, it } from "vitest";
import {
  allocationTotalBasisPoints,
  basisPointsToPercent,
  confirmBalances,
  emptySetup,
  parseAgeEntry,
  parseMoneyText,
  percentToBasisPoints,
  personKey,
  setAge,
  setAllocation,
  setCohortChoice,
  setDebtClass,
  setDebtExcluded,
  setHouseholdIncomeMethod,
  setHouseholdTotal,
  setInHousehold,
  setInvestmentClass,
  setManualOverride,
  setMode,
  setPersonIncome,
  setReferencePerson,
  setSavingsOverride,
  setUniversePreference,
  syncPeople,
} from "./setupDraft";
import type { ManualAmount, PersonRef, SourceRef } from "./types";

const OWNER: PersonRef = { kind: "owner" };
const PARTNER: PersonRef = { kind: "member", id: 7 };
const ACCOUNT: SourceRef = { kind: "account", id: 1 };
const amount = (value: string): ManualAmount => ({ value, measuredOn: "2026-09-01", explanation: "From my pay stubs" });
const TODAY = "2026-09-30";

describe("emptySetup and people", () => {
  it("starts empty with nothing chosen or confirmed", () => {
    const s = emptySetup("household");
    expect(s.formatVersion).toBe(1);
    expect(s.people).toEqual([]);
    expect(s.income.householdMethod).toBe("total");
  });

  it("lists the owner and every family member exactly once, without disturbing anyone already listed", () => {
    let s = syncPeople(emptySetup("household"), [{ id: 7, name: "Partner" }]);
    expect(s.people.map((p) => personKey(p.person))).toEqual(["owner", "member:7"]);
    s = setAge(s, OWNER, { kind: "exact", age: 42 }, TODAY);
    s = syncPeople(s, [{ id: 7, name: "Partner" }, { id: 9, name: "Kid" }]);
    expect(s.people.map((p) => personKey(p.person))).toEqual(["owner", "member:7", "member:9"]);
    expect(s.people[0].age?.age).toEqual({ kind: "exact", age: 42 });
    expect(syncPeople(s, [{ id: 7, name: "Partner" }, { id: 9, name: "Kid" }])).toEqual(s);
  });

  it("keeps a member who was removed from the profile so the repair stays visible", () => {
    let s = syncPeople(emptySetup("household"), [{ id: 7, name: "Partner" }]);
    s = syncPeople(s, []);
    expect(s.people.map((p) => personKey(p.person))).toContain("member:7");
  });
});

describe("mode, reference person and ages", () => {
  const base = () => syncPeople(emptySetup("household"), [{ id: 7, name: "Partner" }]);

  it("changes mode without losing anything else", () => {
    const s = setAge(base(), OWNER, { kind: "exact", age: 42 }, TODAY);
    const switched = setMode(s, "individual");
    expect(switched.mode).toBe("individual");
    expect(switched.people).toEqual(s.people);
  });

  it("stamps the date an age was confirmed and can clear it", () => {
    const s = setAge(base(), OWNER, { kind: "band", min: 25, max: 34 }, TODAY);
    expect(s.people[0].age).toEqual({ age: { kind: "band", min: 25, max: 34 }, confirmedOn: TODAY });
    expect(setAge(s, OWNER, null, TODAY).people[0].age).toBeNull();
  });

  it("sets the one household reference person, or the individual, by mode", () => {
    expect(setReferencePerson(base(), PARTNER).householdReferencePerson).toEqual(PARTNER);
    expect(setReferencePerson(setMode(base(), "individual"), PARTNER).individualPerson).toEqual(PARTNER);
  });

  it("clears the reference person when they leave the household", () => {
    let s = setReferencePerson(base(), PARTNER);
    s = setInHousehold(s, PARTNER, false);
    expect(s.householdReferencePerson).toBeNull();
    expect(s.people[1].inHousehold).toBe(false);
  });
});

describe("parseAgeEntry", () => {
  it("accepts an exact age in the adult range", () => {
    expect(parseAgeEntry({ kind: "exact", age: "42" })).toEqual({ ok: { kind: "exact", age: 42 } });
    expect(parseAgeEntry({ kind: "exact", age: " 18 " })).toEqual({ ok: { kind: "exact", age: 18 } });
  });

  it("rejects out-of-range, fractional and non-numeric ages", () => {
    for (const age of ["17", "121", "4.5", "abc", "", "-3"]) {
      expect(parseAgeEntry({ kind: "exact", age })).toHaveProperty("error");
    }
  });

  it("accepts bands, including an open upper end, and rejects reversed ones", () => {
    expect(parseAgeEntry({ kind: "band", min: "25", max: "34" })).toEqual({ ok: { kind: "band", min: 25, max: 34 } });
    expect(parseAgeEntry({ kind: "band", min: "65", max: "" })).toEqual({ ok: { kind: "band", min: 65, max: null } });
    expect(parseAgeEntry({ kind: "band", min: "40", max: "30" })).toHaveProperty("error");
    expect(parseAgeEntry({ kind: "band", min: "", max: "30" })).toHaveProperty("error");
    expect(parseAgeEntry({ kind: "band", min: "10", max: "30" })).toHaveProperty("error");
  });
});

describe("money text", () => {
  it("accepts plain dollars with optional separators and cents", () => {
    expect(parseMoneyText("120000")).toEqual({ ok: "120000" });
    expect(parseMoneyText("$1,234.50")).toEqual({ ok: "1234.50" });
    expect(parseMoneyText(" -250 ")).toEqual({ ok: "-250" });
  });

  it("rejects blanks, words and more than two decimals", () => {
    for (const t of ["", "abc", "1.234", "1e5", "12 000", "$"]) expect(parseMoneyText(t)).toHaveProperty("error");
  });
});

describe("allocations", () => {
  it("converts between percent text and basis points", () => {
    expect(percentToBasisPoints("60")).toEqual({ ok: 6000 });
    expect(percentToBasisPoints("33.33")).toEqual({ ok: 3333 });
    expect(percentToBasisPoints("100")).toEqual({ ok: 10000 });
    expect(percentToBasisPoints("0")).toEqual({ ok: 0 });
    expect(percentToBasisPoints("101")).toHaveProperty("error");
    expect(percentToBasisPoints("x")).toHaveProperty("error");
    expect(basisPointsToPercent(3333)).toBe("33.33");
    expect(basisPointsToPercent(6000)).toBe("60");
  });

  it("stores a share, replaces it, and removes it at zero or blank", () => {
    let s = setAllocation(emptySetup("household"), ACCOUNT, OWNER, 6000);
    s = setAllocation(s, ACCOUNT, PARTNER, 4000);
    expect(allocationTotalBasisPoints(s, ACCOUNT)).toBe(10000);
    s = setAllocation(s, ACCOUNT, OWNER, 5000);
    expect(s.allocations).toHaveLength(2);
    expect(allocationTotalBasisPoints(s, ACCOUNT)).toBe(9000);
    s = setAllocation(s, ACCOUNT, OWNER, 0);
    expect(s.allocations).toHaveLength(1);
    expect(allocationTotalBasisPoints(s, { kind: "account", id: 2 })).toBe(0);
  });

  it("never mixes an account's shares with an asset that has the same number", () => {
    const s = setAllocation(emptySetup("household"), { kind: "asset", id: 1 }, OWNER, 10000);
    expect(allocationTotalBasisPoints(s, ACCOUNT)).toBe(0);
  });
});

describe("classifications and overrides", () => {
  it("sets and clears an investment class, one per source", () => {
    let s = setInvestmentClass(emptySetup("household"), ACCOUNT, "retirement");
    s = setInvestmentClass(s, ACCOUNT, "taxable");
    expect(s.investmentClasses).toEqual([{ source: ACCOUNT, class: "taxable" }]);
    expect(setInvestmentClass(s, ACCOUNT, null).investmentClasses).toEqual([]);
  });

  it("sets and clears a debt class, and toggles a comparison-only exclusion", () => {
    let s = setDebtClass(emptySetup("household"), ACCOUNT, "mortgage");
    expect(s.debtClasses).toEqual([{ source: ACCOUNT, class: "mortgage" }]);
    s = setDebtExcluded(s, ACCOUNT, true);
    s = setDebtExcluded(s, ACCOUNT, true);
    expect(s.debtExclusions).toEqual([ACCOUNT]);
    expect(setDebtExcluded(s, ACCOUNT, false).debtExclusions).toEqual([]);
    expect(setDebtClass(s, ACCOUNT, null).debtClasses).toEqual([]);
  });

  it("sets a savings override to include, exclude or back to the default", () => {
    let s = setSavingsOverride(emptySetup("household"), ACCOUNT, true);
    expect(s.savingsOverrides).toEqual([{ source: ACCOUNT, include: true }]);
    s = setSavingsOverride(s, ACCOUNT, false);
    expect(s.savingsOverrides).toEqual([{ source: ACCOUNT, include: false }]);
    expect(setSavingsOverride(s, ACCOUNT, null).savingsOverrides).toEqual([]);
  });

  it("records a balance confirmation once per metric and refreshes its date", () => {
    let s = confirmBalances(emptySetup("household"), "savings", "2026-01-01");
    s = confirmBalances(s, "savings", TODAY);
    expect(s.balanceConfirmations).toEqual([{ metric: "savings", confirmedOn: TODAY }]);
  });

  it("sets, replaces and removes a manual total per metric and subject", () => {
    let s = setManualOverride(emptySetup("household"), "savings", null, amount("25000"));
    s = setManualOverride(s, "savings", null, amount("26000"));
    s = setManualOverride(s, "savings", OWNER, amount("5"));
    expect(s.manualOverrides).toHaveLength(2);
    expect(s.manualOverrides[0].amount.value).toBe("26000");
    expect(setManualOverride(s, "savings", null, null).manualOverrides).toHaveLength(1);
  });

  it("remembers a cohort pick per mode and metric and a population choice per metric", () => {
    let s = setCohortChoice(emptySetup("individual"), "individual", "income", "x:30-34");
    s = setCohortChoice(s, "individual", "income", "x:25-29");
    expect(s.cohortChoices).toEqual([{ mode: "individual", metric: "income", referenceId: "x:25-29" }]);
    expect(setCohortChoice(s, "individual", "income", null).cohortChoices).toEqual([]);
    let u = setUniversePreference(emptySetup("household"), "savings", "holders");
    u = setUniversePreference(u, "savings", "all");
    expect(u.universePreferences).toEqual([{ metric: "savings", universe: "all" }]);
  });
});

describe("income", () => {
  it("preserves per-person amounts while the household total method is active, and the total while by-person is", () => {
    let s = setHouseholdTotal(emptySetup("household"), amount("120000"));
    s = setPersonIncome(s, OWNER, amount("70000"));
    s = setPersonIncome(s, PARTNER, amount("30000"));
    s = setHouseholdIncomeMethod(s, "by_person");
    expect(s.income.householdTotal?.value).toBe("120000");
    s = setHouseholdIncomeMethod(s, "total");
    expect(s.income.perPerson.map((p) => p.grossAnnual.value)).toEqual(["70000", "30000"]);
  });

  it("removes a person's income when cleared", () => {
    let s = setPersonIncome(emptySetup("household"), OWNER, amount("1"));
    s = setPersonIncome(s, OWNER, null);
    expect(s.income.perPerson).toEqual([]);
  });
});
