import { describe, expect, it } from "vitest";
import {
  validateStatementFinished,
  validateStatementLayouts,
  validateStatementLines,
  validateStatementRead,
  validateStatementReview,
} from "./statementContracts";
import { sampleReview } from "./statementTestUtils";

const UNEXPECTED = "The app received an unexpected statement response. Read the statement again.";

describe("statement contracts", () => {
  it("accepts a well-formed review", () => {
    expect(validateStatementReview(sampleReview()).rows).toHaveLength(2);
  });
  it("refuses a review with a malformed amount or unknown status", () => {
    const bad = sampleReview();
    bad.rows[0].amount = "7,40";
    expect(() => validateStatementReview(bad)).toThrow(UNEXPECTED);
    const worse = sampleReview();
    (worse.rows[0] as { status: string }).status = "maybe";
    expect(() => validateStatementReview(worse)).toThrow(UNEXPECTED);
  });
  it("accepts a loan row's principal part and refuses a malformed one", () => {
    const loan = sampleReview({ account_kind: "loan" });
    loan.rows[0].principal = "-60.00";
    expect(validateStatementReview(loan).rows[0].principal).toBe("-60.00");
    loan.rows[0].principal = "6O";
    expect(() => validateStatementReview(loan)).toThrow(UNEXPECTED);
    const missing = sampleReview();
    delete (missing.rows[0] as { principal?: unknown }).principal;
    expect(() => validateStatementReview(missing)).toThrow(UNEXPECTED);
  });
  it("refuses a review with a missing token, bad kind, bad source or bad date", () => {
    for (const change of [{ token: 5 }, { account_kind: "savings" }, { source: "email" }, { period_end: "2026-02-30" }, { running_balance_breaks: -1 }]) {
      expect(() => validateStatementReview({ ...sampleReview(), ...change })).toThrow(UNEXPECTED);
    }
  });
  it("accepts holdings with every status and refuses an unknown one", () => {
    const holding = { symbol: "VTI", name: "Total Market", statement_shares: "10", price: null, market_value: "2500.00", app_holding_id: null, app_shares: null, status: "missing_in_app" };
    expect(validateStatementReview(sampleReview({ holdings: [holding as never] })).holdings).toHaveLength(1);
    expect(() => validateStatementReview(sampleReview({ holdings: [{ ...holding, status: "other" } as never] }))).toThrow(UNEXPECTED);
  });
  it("accepts a read that asks for a section choice", () => {
    expect(validateStatementRead({ token: "t", sections: [{ index: 0, name: "Savings", row_count: 0, holding_count: 0 }], review: null }).review).toBeNull();
  });
  it("accepts a read that already carries a review and refuses a broken one", () => {
    expect(validateStatementRead({ token: "t", sections: [], review: sampleReview() }).review?.token).toBe("tok");
    expect(() => validateStatementRead({ token: "t", sections: [], review: { token: "x" } })).toThrow(UNEXPECTED);
    expect(() => validateStatementRead({ token: "t", sections: [] })).toThrow(UNEXPECTED);
  });
  it("validates statement lines, the finished result and layouts", () => {
    expect(validateStatementLines([{ index: 0, page: 0, text: "x" }])).toHaveLength(1);
    expect(() => validateStatementLines([{ index: 0, text: "x" }])).toThrow(UNEXPECTED);
    expect(validateStatementFinished({ reconciliation_id: 3, added: 0, layout_saved: null }).added).toBe(0);
    expect(() => validateStatementFinished({ reconciliation_id: 0, added: 0, layout_saved: null })).toThrow(UNEXPECTED);
    expect(validateStatementLayouts([{ id: 1, name: "Bank", phrases: ["a"], updated_at: "2026-01-01 10:00:00" }])).toHaveLength(1);
    expect(() => validateStatementLayouts([{ id: 1, name: "Bank", phrases: [1], updated_at: "x" }])).toThrow(UNEXPECTED);
    expect(() => validateStatementLayouts(null)).toThrow(UNEXPECTED);
  });
});
