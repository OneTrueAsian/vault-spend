import { array, boolean, date, decimal, id, integer, nullable, object, string, type Check } from "./contractChecks";

export type AccountKind = "cash" | "credit" | "loan" | "investment";
export type CheckResult = { outcome: "passed" | "failed" | "not_available"; expected: string | null; found: string | null };
export type ReviewRow = {
  index: number;
  date: string;
  description: string;
  /** In the app's sign for this account. */
  amount: string;
  /** Loan accounts only: the part of a payment that lowers the loan, in the app's sign. */
  principal: string | null;
  status: "matched" | "possible" | "missing";
  match_id: number | null;
  possible_ids: number[];
};
export type AppTransaction = { id: number; date: string; description: string; amount: string; change: string };
export type HoldingReview = {
  symbol: string;
  name: string;
  statement_shares: string;
  price: string | null;
  market_value: string;
  app_holding_id: number | null;
  app_shares: string | null;
  status: "same" | "different" | "missing_in_app";
};
export type AppOnlyHolding = { id: number; symbol: string; name: string; shares: string };
export type StatementReview = {
  token: string;
  account_kind: AccountKind;
  source: "pdf" | "download";
  layout_name: string | null;
  recognized: boolean;
  recognized_but_failed: boolean;
  learnable: boolean;
  section_name: string;
  period_start: string;
  period_end: string;
  starting_balance: string | null;
  ending_balance: string | null;
  ending_value: string | null;
  previous_ending_balance: string | null;
  already_reconciled_through: string | null;
  nothing_in_period: boolean;
  activity_check: CheckResult;
  holdings_check: CheckResult;
  running_balance_breaks: number;
  rows: ReviewRow[];
  app_transactions: AppTransaction[];
  not_on_statement: number[];
  unread: { line: number; text: string }[];
  suggest_flip: boolean;
  flipped: boolean;
  holdings: HoldingReview[];
  app_only_holdings: AppOnlyHolding[];
  suggested_name: string;
  suggested_phrases: string[];
};
export type StatementRead = {
  token: string;
  sections: { index: number; name: string; row_count: number; holding_count: number }[];
  review: StatementReview | null;
};
export type StatementLineText = { index: number; page: number; text: string };
export type StatementFinished = { reconciliation_id: number; added: number; layout_saved: string | null };
export type StatementLayoutSummary = { id: number; name: string; phrases: string[]; updated_at: string };
export type TextRef = { line: number; start: number };
export type TeachMarks = {
  rows: { date: TextRef; amount: TextRef }[];
  balances: { kind: "start_end"; start: TextRef; end: TextRef } | { kind: "totals"; additions: TextRef; subtractions: TextRef } | null;
  holdings: { symbol: TextRef; quantity: TextRef; price: TextRef | null; marketValue: TextRef; total: TextRef }[];
};
/** What the person decided. Loan principal parts are not sent: the app keeps them with the open review. */
export type FinishDecisions = {
  matches: { row: number; transactionId: number }[];
  add: { row: number; date: string; description: string; amount: string }[];
  skip: number[];
  startingBalance: string | null;
  endingBalance: string | null;
  holdings: {
    symbol: string;
    action: "update" | "add" | "remove" | "leave";
    holdingId: number | null;
    shares: string | null;
    price: string | null;
    costBasis: string | null;
    name: string | null;
  }[];
  /** Investment accounts: finish without checking share counts, when the holdings couldn't be read. */
  finishWithoutHoldings: boolean;
  ignoreUnread: boolean;
  saveLayout: { name: string; phrases: string[] } | null;
};

const oneOf =
  (...values: string[]): Check =>
  (v) =>
    typeof v === "string" && values.includes(v);
const ids = array(id);
const check = object({ outcome: oneOf("passed", "failed", "not_available"), expected: nullable(decimal), found: nullable(decimal) });
const reviewCheck = object({
  token: string,
  account_kind: oneOf("cash", "credit", "loan", "investment"),
  source: oneOf("pdf", "download"),
  layout_name: nullable(string),
  recognized: boolean,
  recognized_but_failed: boolean,
  learnable: boolean,
  section_name: string,
  period_start: date,
  period_end: date,
  starting_balance: nullable(decimal),
  ending_balance: nullable(decimal),
  ending_value: nullable(decimal),
  previous_ending_balance: nullable(decimal),
  already_reconciled_through: nullable(date),
  nothing_in_period: boolean,
  activity_check: check,
  holdings_check: check,
  running_balance_breaks: integer,
  rows: array(
    object({
      index: integer,
      date,
      description: string,
      amount: decimal,
      principal: nullable(decimal),
      status: oneOf("matched", "possible", "missing"),
      match_id: nullable(id),
      possible_ids: ids,
    }),
  ),
  app_transactions: array(object({ id, date, description: string, amount: decimal, change: decimal })),
  not_on_statement: ids,
  unread: array(object({ line: integer, text: string })),
  suggest_flip: boolean,
  flipped: boolean,
  holdings: array(
    object({
      symbol: string,
      name: string,
      statement_shares: decimal,
      price: nullable(decimal),
      market_value: decimal,
      app_holding_id: nullable(id),
      app_shares: nullable(decimal),
      status: oneOf("same", "different", "missing_in_app"),
    }),
  ),
  app_only_holdings: array(object({ id, symbol: string, name: string, shares: decimal })),
  suggested_name: string,
  suggested_phrases: array(string),
});
const readCheck = object({
  token: string,
  sections: array(object({ index: integer, name: string, row_count: integer, holding_count: integer })),
  review: nullable(reviewCheck),
});

function validated<T>(c: Check, v: unknown): T {
  if (!c(v)) throw new Error("The app received an unexpected statement response. Read the statement again.");
  return v as T;
}

export const validateStatementReview = (v: unknown) => validated<StatementReview>(reviewCheck, v);
export const validateStatementRead = (v: unknown) => validated<StatementRead>(readCheck, v);
export const validateStatementLines = (v: unknown) =>
  validated<StatementLineText[]>(array(object({ index: integer, page: integer, text: string })), v);
export const validateStatementFinished = (v: unknown) =>
  validated<StatementFinished>(object({ reconciliation_id: id, added: integer, layout_saved: nullable(string) }), v);
export const validateStatementLayouts = (v: unknown) =>
  validated<StatementLayoutSummary[]>(array(object({ id, name: string, phrases: array(string), updated_at: string })), v);
