import type { StatementReview } from "./statementContracts";

export function sampleReview(overrides: Partial<StatementReview> = {}): StatementReview {
  return {
    token: "tok",
    account_kind: "credit",
    source: "pdf",
    layout_name: null,
    recognized: false,
    recognized_but_failed: false,
    learnable: true,
    section_name: "Statement",
    period_start: "2026-07-22",
    period_end: "2026-08-21",
    starting_balance: "43.08",
    ending_balance: "52.36",
    ending_value: null,
    previous_ending_balance: null,
    already_reconciled_through: null,
    nothing_in_period: false,
    activity_check: { outcome: "passed", expected: null, found: null },
    holdings_check: { outcome: "not_available", expected: null, found: null },
    running_balance_breaks: 0,
    rows: [
      { index: 0, date: "2026-07-24", description: "STREAMING SERVICE", amount: "-7.40", principal: null, status: "matched", match_id: 11, possible_ids: [] },
      { index: 1, date: "2026-08-17", description: "CLOUD STORAGE", amount: "-11.99", principal: null, status: "missing", match_id: null, possible_ids: [] },
    ],
    app_transactions: [{ id: 11, date: "2026-07-24", description: "Streaming", amount: "-7.40", change: "7.40" }],
    not_on_statement: [],
    unread: [],
    suggest_flip: false,
    flipped: false,
    holdings: [],
    app_only_holdings: [],
    suggested_name: "Northwind Card Services",
    suggested_phrases: ["Northwind Card Services"],
    ...overrides,
  };
}
