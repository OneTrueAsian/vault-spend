import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "../../shared/lib/types";
import { savingsRateByMonth } from "./savingsRate";

const account = { id: 1, name: "Checking", account_type: "checking" } as Account;
const tx = (date: string, amount: string, category = "Other"): Transaction => ({ id: 1, date, amount, category, account_id: 1 }) as Transaction;
const range = (...m: string[]) => m;

describe("savingsRateByMonth", () => {
  it("uses only months inside the range", () => {
    const txs = [tx("2026-04-03", "100"), tx("2026-06-03", "100"), tx("2026-11-03", "100")];
    const months = range("2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11");
    expect(savingsRateByMonth(txs, [account], months, "2026-12").map((p) => p.month)).toEqual(["2026-06", "2026-11"]);
  });

  it("computes (income - expenses) / income, 0 when there is no income, and ignores Transfer", () => {
    const months = range("2026-06", "2026-07", "2026-08");
    const txs = [
      tx("2026-06-01", "800"), tx("2026-06-02", "-200"),
      tx("2026-07-01", "800"), tx("2026-07-02", "-880"),
      tx("2026-08-02", "-100"),
      tx("2026-06-05", "-500", "Transfer"),
    ];
    expect(savingsRateByMonth(txs, [account], months, "2026-12").map((p) => p.value)).toEqual([75, -10, 0]);
  });

  it("marks only the current month as partial and labels it so far", () => {
    const months = range("2026-10", "2026-11");
    const txs = [tx("2026-10-01", "100"), tx("2026-11-01", "100")];
    const points = savingsRateByMonth(txs, [account], months, "2026-11");
    expect(points.map((p) => [p.label, p.partial])).toEqual([["Oct", false], ["Nov so far", true]]);
  });

  it("a current month with no transactions has no point", () => {
    const months = range("2026-10", "2026-11");
    const points = savingsRateByMonth([tx("2026-10-01", "100")], [account], months, "2026-11");
    expect(points.map((p) => p.month)).toEqual(["2026-10"]);
    expect(points.some((p) => p.partial)).toBe(false);
  });
});
