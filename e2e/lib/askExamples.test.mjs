import { describe, expect, it } from "vitest";
import * as x from "./askExamples.mjs";
import { RETIREMENT_CORPUS } from "../../src/askVault/retirementCorpus";
import { compiledRetirementCase } from "../../src/askVault/retirementCompiledCorpus";

// Task 7 (D-6, G-4): the examples pass iterates the card's own exported lists and expects an outcome worked from the seed. Hand figures are pinned for 2026-10-22.
// Written after the helper (no RED receipt for this file); its negative cases below show the checks can fail.
const NOW = new Date(2026, 9, 22, 12);
const world = x.buildWorld(NOW), E = x.buildExpectations(world);
const all = () => { const s = x.advertisedStrings(); return [...s.ledger, ...s.more, ...s.suggestions]; };
const ok = (text, sample) => expect(E[text].problems(sample)).toEqual([]);
const bad = (text, sample) => expect(E[text].problems(sample)).not.toEqual([]);

describe("the advertised strings are read from the card and each has an expected outcome", () => {
  it("finds 12 + 9 + 4 = 25 strings", () => {
    const s = x.advertisedStrings();
    expect([s.ledger.length, s.more.length, s.suggestions.length]).toEqual([12, 9, 4]);
    expect(new Set(all()).size).toBe(25);
  });
  it("has an expectation for every advertised string and none for a string that is not advertised", () => {
    expect(all().filter(t => !E[t])).toEqual([]);
    expect(Object.keys(E).filter(k => !all().includes(k))).toEqual([]);
  });
  it("reports a reworded or new advertised string as having no expectation", () => {
    expect([...all(), "how much did I spend on dining in July"].filter(t => !E[t])).toEqual(["how much did I spend on dining in July"]);
  });
});

describe("expected figures are hand-worked from the seed (fixed date 2026-10-22)", () => {
  it("dining out in July is 60 + 35 = $95.00 over 2 purchases; a wrong amount, count or refusal is rejected", () => {
    ok("how much did I spend on dining out in July", "You spent $95.00 on Dining Out in July 2026. 2 purchases");
    bad("how much did I spend on dining out in July", "You spent $96.00 on Dining Out in July 2026. 2 purchases");
    bad("how much did I spend on dining out in July", "You spent $95.00 on Dining Out in July 2026. 3 purchases");
    bad("how much did I spend on dining out in July", "I couldn't understand that.");
  });
  it("Whole Foods is 80 + 45.50 + 25 = $150.50 over 3 purchases", () => { ok("how much did I spend at Whole Foods", "You spent $150.50 at Whole Foods since your records begin. 3 purchases"); });
  it("September groceries are $338.50 over 6; without Costco $188.50 over 4", () => {
    ok("how much did I spend on groceries last month", "You spent $338.50 on Groceries in September 2026. 6 purchases");
    ok("groceries last month without Costco", "$188.50 4 purchases");
    bad("groceries last month without Costco", "$338.50 6 purchases");
  });
  it("Costco $150.00 over 2; everything except rent $356.50 over 7; average grocery purchase $56.42", () => {
    ok("how much did I spend at Costco last month", "You spent $150.00 at Costco in September 2026. 2 purchases");
    ok("everything except rent last month", "You spent $356.50 on everything, excluding Rent, in September 2026. 7 purchases Left out as you asked: Rent ($1,500.00).");
    ok("average purchase on groceries last month", "You averaged $56.42 per purchase on Groceries in September 2026. $338.50 ÷ 6 purchases");
    bad("average purchase on groceries last month", "You averaged $56.41 per purchase on Groceries in September 2026.");
  });
  it("this year is $2,071.50 over 14 purchases; the top three are Rent, Groceries, Dining Out", () => {
    ok("spending by month this year", "You spent $2,071.50 on everything in 2026 so far. 14 purchases");
    ok("top 3 spending categories this year", "Rent$1,500.001 purchase Groceries$413.508 purchases Dining Out$158.005 purchases");
    bad("top 3 spending categories this year", "Rent$1,500.001 purchase Groceries$413.508 purchases Dining Out$159.005 purchases");
  });
  it("members: Sam $259.00, Robin $97.50, unassigned $1,500.00; biggest three are rent, Costco, Whole Foods", () => {
    ok("what did each family member spend last month", "You spent $1,856.50 on everything in September 2026. Not assigned to anyone$1,500.00 Sam$259.00 Robin$97.50");
    bad("what did each family member spend last month", "You spent $1,856.50 on everything in September 2026. Sam$259.00");
    ok("my three biggest expenses last month", "MAPLE COURT APARTMENTS$1,500.00 COSTCO WHSE$120.00 WHOLE FOODS MARKET #12$80.00");
  });
  it("this month so far $75.00 against last month $1,856.50; savings rate (3,000 - 75) / 3,000 = 97.5, shown as 98%", () => {
    ok("compare this month to last month", "You spent $75.00 in October 2026 so far and $1,856.50 in September 2026.");
    ok("what's my savings rate this month", "Your savings rate for this month is 98% ($3,000.00 income, $75.00 spent).");
  });
  it("checking, net worth, debt, subscriptions, bill and vacation come from the seeded accounts", () => {
    expect(world.checkingBalance).toBe(6000 - 2071.5 + 3000);
    ok("how much do I have in checking", "You have $6,928.50 in checking.");
    ok("what's my net worth", "Your net worth is $23,428.50.");
    ok("what's my total debt", "You owe $8,500.00 in total.");
    ok("how much do I owe on car loan", "You owe $8,500.00 on Car Loan.");
    ok("how much are my subscriptions", "Your recurring bills add up to about $60.00/mo, across 2 recurring bills.");
    ok("how much have I saved toward vacation", "Vacation Fund has $1,500.00 saved of its $3,000.00 target (50%).");
    ok("when is my next bill due", "Your next bill is Netflix for -$15.00 on Oct 25.");
    bad("when is my next bill due", "Your next bill is Gym for -$45.00 on Nov 1.");
  });
  it("runway is hand derived from 90-day spend ($2071.50 - $95 - $25) / 3 and checking $6928.50: 10.7 -> 8.1 months", () => {
    ok("what's my runway if rent goes up by $200", "Right now your runway is 10.7 months. If spending goes up by $200.00/mo, it'd drop to 8.1 months.");
    bad("what's my runway if rent goes up by $200", "Right now your runway is 6.0 months. If spending goes up by $200.00/mo, it'd drop to 5.0 months.");
    bad("what's my runway if rent goes up by $200", "Your runway is 5.0 months; it would drop to 6.0 months");
  });
  it("checks financial table cells across real innerText whitespace without accepting changed figures", () => {
    ok("top 3 spending categories this year", "Rent\n$1,500.00\n1 purchase\nGroceries\n$413.50\n8 purchases\nDining Out\n$158.00\n5 purchases");
    bad("top 3 spending categories this year", "Rent\n$1,500.00\n1 purchase\nGroceries\n$413.50\n8 purchases\nDining Out\n$159.00\n5 purchases");
  });
});

describe("scenario strings must reach a review or choices screen and never an early result", () => {
  it("accepts a known heading and rejects a calculated result or a refusal", () => {
    ok("What if I cut Groceries by $50 a month?", "Check these details");
    bad("What if I cut Groceries by $50 a month?", "You would save $50.00 a month");
    bad("Extra $50 a month into Roth IRA until January 2056", "Illustrative balance at January 2056");
    bad("Save $200 in total this year", "I can't help with that");
  });
});

describe("missing-entity outcome and the adapted m5c-022 question", () => {
  it("rejects an empty, loading, unrelated or premature financial outcome as missing-entity proof", () => {
    for (const text of ["", "Ask the Vault Ask", "Loading", "Check these details", "Your net worth is $23,428.50."]) {
      expect(x.missingEntityProblems(text), text).not.toEqual([]);
    }
  });
  it("shows no figure for something absent, and accepts a plain refusal", () => {
    expect(x.missingEntityProblems("You spent $95.00 on Dining Out in July 2026.")).not.toEqual([]);
    expect(x.missingEntityProblems("You averaged $5.00 per purchase")).not.toEqual([]);
    expect(x.missingEntityProblems("I couldn't find a category called Dining Out.")).toEqual([]);
  });
  it("equals the approved adaptation of the frozen m5c-022 text for the same date", () => {
    const c = RETIREMENT_CORPUS.find(e => e.id === "m5c-022");
    expect(x.ADAPTED_M5C_022(NOW)).toBe(compiledRetirementCase(c, "2026-10-22").text);
    expect(x.ADAPTED_M5C_022(NOW)).toBe("a one-time $500 deposit to my Roth IRA now, retiring October 2026");
  });
});
