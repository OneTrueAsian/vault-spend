// Which import rows still need the person's choice on the review screen. Mirrors the backend's
// order (budget_core::import_resolution): the file's own category when it is one of theirs, else
// the panel's choice for that file category, else a sure rule or guess, else the person decides.
// Worked out here so changing a panel choice or a checkbox needs no call to the backend.
import { describe, expect, it } from "vitest";
import {
  isSure,
  leaveRestUncategorized,
  pruneRowChoices,
  rowChoicesToSend,
  rowNeedsChoice,
  unresolvedRows,
  type ImportRow,
  type RowChoices,
  type Suggestion,
} from "./importResolution";
import type { CategoryChoice } from "./ImportCategoryReconcile";

const BELOW = 0.5;

function row(index: number, over: Partial<ImportRow> = {}): ImportRow {
  return {
    index,
    date: "2026-01-05",
    description: `ROW ${index}`,
    amount: "-1.00",
    is_duplicate: false,
    account_name: null,
    category: null,
    matched_category: null,
    suggestion: null,
    ...over,
  };
}

const rule = (category: string, confidence: number | null = null): Suggestion => ({ category, source: "rule", confidence });
const guess = (category: string, confidence: number | null): Suggestion => ({ category, source: "guess", confidence });

describe("isSure", () => {
  it.each([
    [rule("Dining"), true],
    [rule("Dining", 0.3), false],
    [rule("Dining", 0.69), true],
    [guess("Dining", 0.5), true],
    [guess("Dining", 0.4999), false],
    [guess("Dining", 0.6999), true],
    [guess("Dining", 0.7), true],
    [guess("Dining", null), false],
    [guess("Dining", Number.NaN), false],
    [guess("Dining", 1.5), false],
    [null, false],
  ])("%j is sure: %s", (s, expected) => {
    expect(isSure(s, BELOW)).toBe(expected);
  });

  it("uses the cutoff the backend sends", () => {
    expect(isSure(guess("Dining", 0.6), 0.65)).toBe(false);
  });
});

describe("rowNeedsChoice", () => {
  const panel = (entries: Record<string, CategoryChoice>) => entries;

  it("never asks about a row whose file category is one of the person's", () => {
    expect(rowNeedsChoice(row(0, { category: "groceries", matched_category: "Groceries" }), {}, BELOW)).toBe(false);
  });

  it("does not ask when the panel maps or adds the row's file category, under any casing", () => {
    const r = row(0, { category: "Merchandise" });
    expect(rowNeedsChoice(r, panel({ MERCHANDISE: { action: "map_to", category: "Shopping" } }), BELOW)).toBe(false);
    expect(rowNeedsChoice(r, panel({ " merchandise ": { action: "create" } }), BELOW)).toBe(false);
  });

  it("asks when the panel lets the app guess and the guess is unsure or missing", () => {
    expect(rowNeedsChoice(row(0, { category: "Merchandise", suggestion: guess("Dining", 0.2) }), panel({ Merchandise: { action: "skip" } }), BELOW)).toBe(true);
    expect(rowNeedsChoice(row(0, { category: "Merchandise" }), panel({ Merchandise: { action: "skip" } }), BELOW)).toBe(true);
  });

  it("does not ask when the panel lets the app guess and the guess is sure", () => {
    expect(rowNeedsChoice(row(0, { category: "Merchandise", suggestion: rule("Dining") }), panel({ Merchandise: { action: "skip" } }), BELOW)).toBe(false);
  });

  it("guesses for rows from a file with no category column too", () => {
    expect(rowNeedsChoice(row(0, { suggestion: guess("Dining", 0.8) }), {}, BELOW)).toBe(false);
    expect(rowNeedsChoice(row(0), {}, BELOW)).toBe(true);
  });
});

describe("row choices", () => {
  const rows = [
    row(0, { matched_category: "Groceries", category: "Groceries" }),
    row(1, { category: "Merchandise" }),
    row(2),
    row(3, { suggestion: guess("Dining", 0.3) }),
  ];
  const guessAll: Record<string, CategoryChoice> = { Merchandise: { action: "skip" } };

  it("lists the checked rows that still need a choice and have none", () => {
    const choices: RowChoices = new Map([[2, "Dining"]]);
    const included = new Set([0, 1, 2]);
    expect(unresolvedRows(rows, included, guessAll, choices, BELOW).map((r) => r.index)).toEqual([1]);
  });

  it("counts Leave uncategorized as a choice, but a missing entry as none", () => {
    const choices: RowChoices = new Map([[1, null]]);
    expect(unresolvedRows(rows, new Set([1, 2]), guessAll, choices, BELOW).map((r) => r.index)).toEqual([2]);
  });

  it("never lets an unchecked row hold up the import", () => {
    expect(unresolvedRows(rows, new Set([0]), guessAll, new Map(), BELOW)).toEqual([]);
  });

  it("sends only checked rows that need a choice, keeping null as Leave uncategorized", () => {
    const choices: RowChoices = new Map<number, string | null>([
      [1, null],
      [2, "Dining"],
      [3, "Home"],
    ]);
    // row 3 is unchecked: its choice is kept on screen but not sent
    expect(rowChoicesToSend(rows, new Set([0, 1, 2]), guessAll, choices, BELOW)).toEqual({ 1: null, 2: "Dining" });
  });

  it("keeps an unchecked row's choice so checking it again does not ask twice", () => {
    const choices: RowChoices = new Map([[2, "Dining"]]);
    const kept = pruneRowChoices(rows, guessAll, choices, BELOW);
    expect(kept.get(2)).toBe("Dining");
    expect(unresolvedRows(rows, new Set([2]), guessAll, kept, BELOW)).toEqual([]);
  });

  it("drops a row's choice once the panel settles it, and asks again if the panel goes back to guessing", () => {
    const choices: RowChoices = new Map([[1, "Dining"]]);
    const mapped: Record<string, CategoryChoice> = { Merchandise: { action: "map_to", category: "Shopping" } };
    const pruned = pruneRowChoices(rows, mapped, choices, BELOW);
    expect(pruned.has(1)).toBe(false);
    expect(unresolvedRows(rows, new Set([1]), guessAll, pruned, BELOW).map((r) => r.index)).toEqual([1]);
  });

  it("returns the same map when nothing needs dropping", () => {
    const choices: RowChoices = new Map([[2, "Dining"]]);
    expect(pruneRowChoices(rows, guessAll, choices, BELOW)).toBe(choices);
  });

  it("Leave the rest uncategorized settles only the checked rows still without a choice", () => {
    const choices: RowChoices = new Map([[2, "Dining"]]);
    const next = leaveRestUncategorized(rows, new Set([0, 1, 2]), guessAll, choices, BELOW);
    expect([...next.entries()].sort()).toEqual([
      [1, null],
      [2, "Dining"],
    ]);
    expect(next).not.toBe(choices);
    expect(choices.has(1)).toBe(false);
  });
});
