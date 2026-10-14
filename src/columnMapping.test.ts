import { describe, expect, it } from "vitest";
import { columnLabel, draftFromGuess, draftProblem, toColumnMap, type ColumnInspection, type Draft } from "./columnMapping";

const inspection = (guess: Partial<ColumnInspection["guess"]>): ColumnInspection => ({
  status: "needs_mapping",
  headers: ["A", "B", "C"],
  sample_rows: [],
  missing: [],
  guess: { date: null, description: null, amount: null, debit: null, credit: null, ...guess },
  map: null,
});

const complete: Draft = { date: 0, description: 1, split: false, amount: 2, debit: null, credit: null };

describe("draftFromGuess", () => {
  it("fills the guessed columns", () => {
    expect(draftFromGuess(inspection({ date: 0, description: 1, amount: 2 }))).toEqual(complete);
  });

  it("turns on separate money columns when only debit and credit were guessed", () => {
    const draft = draftFromGuess(inspection({ date: 0, description: 1, debit: 2, credit: 3 }));
    expect(draft).toMatchObject({ split: true, debit: 2, credit: 3, amount: null });
  });

  it("keeps a single amount column when one was guessed", () => {
    expect(draftFromGuess(inspection({ amount: 2, debit: 3, credit: 4 })).split).toBe(false);
  });
});

describe("draftProblem", () => {
  it("names the first missing field in plain words", () => {
    expect(draftProblem({ ...complete, date: null })).toBe("Pick the column that has the date.");
    expect(draftProblem({ ...complete, description: null })).toBe("Pick the column that has the description.");
    expect(draftProblem({ ...complete, amount: null })).toBe("Pick the column that has the amount.");
  });

  it("needs both money columns when they are separate", () => {
    const split = { ...complete, split: true, amount: null };
    expect(draftProblem({ ...split, debit: 2, credit: null })).toBe("Pick the column that has the amount.");
    expect(draftProblem({ ...split, debit: 2, credit: 3 })).toBeNull();
  });

  it("says each field needs its own column when two share one", () => {
    expect(draftProblem({ ...complete, date: 1, description: 1 })).toBe("Each field needs its own column.");
    expect(draftProblem({ ...complete, split: true, debit: 2, credit: 2 })).toBe("Each field needs its own column.");
  });

  it("is null for a complete draft", () => {
    expect(draftProblem(complete)).toBeNull();
  });
});

describe("toColumnMap", () => {
  it("builds a single amount column", () => {
    expect(toColumnMap(complete)).toEqual({ date: 0, description: 1, amount: { kind: "single", column: 2 } });
  });

  it("builds separate debit and credit columns", () => {
    const draft = { ...complete, split: true, amount: null, debit: 2, credit: 3 };
    expect(toColumnMap(draft)).toEqual({ date: 0, description: 1, amount: { kind: "debit_credit", debit: 2, credit: 3 } });
  });

  it("throws on an incomplete draft", () => {
    expect(() => toColumnMap({ ...complete, date: null })).toThrow();
  });
});

describe("columnLabel", () => {
  it("shows the header text", () => {
    expect(columnLabel(["Date", "Memo"], 1)).toBe("Memo");
  });

  it("calls a blank header by its position", () => {
    expect(columnLabel(["Date", "", "Amount"], 1)).toBe("Column 2");
  });

  it("tells repeated headers apart", () => {
    const headers = ["Date", "Memo", "Amount", "Fee", "Amount"];
    expect(columnLabel(headers, 2)).toBe("Amount (column 3)");
    expect(columnLabel(headers, 4)).toBe("Amount (column 5)");
  });
});
