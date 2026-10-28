import { array, boolean, date, decimal, id, integer, nullable, object, string } from "./contractChecks";
import { accountCheck, TransactionError, type TransactionContext } from "./transactionContracts";
import type {
  Account,
  AccountContributionDelta,
  BudgetAlert,
  CashFlow,
  CategoryAmount,
  Insight,
  MemberBudgetActual,
  NetWorthPoint,
  Report,
  ReportBudgetLine,
} from "./types";
type Envelope = { contractVersion: 1; context: TransactionContext; revision: { local: number; external: number } };
export type DashboardSnapshot = Envelope & {
  asOf: string;
  report: Report;
  netWorth: NetWorthPoint[];
  spending: CategoryAmount[];
  alerts: BudgetAlert[];
  insights: Insight[];
  averageSpend: string;
  /** At least 14 days of transactions exist, so the runway average is real. */
  enoughHistory: boolean;
  contributions: AccountContributionDelta[];
};
export type ReportSummarySnapshot = Envelope & { asOf: string; report: Report; accounts: Account[]; averageSpend: string };
export type BudgetSnapshot = Envelope & {
  year: number;
  month: number;
  actuals: ReportBudgetLine[];
  alerts: BudgetAlert[];
  flow: CashFlow;
  members: MemberBudgetActual[];
};
export type ReportSnapshot = Envelope & {
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
  cells: { month: string; category: string; amount: string }[];
  flow: CashFlow;
  daily: { date: string; amount: string }[];
};
const year = (v: unknown) => integer(v) && (v as number) >= 1 && (v as number) <= 9999;
const month = (v: unknown) => integer(v) && (v as number) >= 1 && (v as number) <= 12;
const context = object({ contractVersion: (v) => v === 1, generation: integer, sessionRevision: integer });
const envelope = {
  contractVersion: (v: unknown) => v === 1,
  context,
  revision: object({ local: integer, external: integer }),
};
const budgetLine = object({
  category: string,
  budget_group: string,
  budgeted: decimal,
  actual: decimal,
  cap_enabled: boolean,
  rollover: decimal,
  rollover_enabled: boolean,
});
const flow = object({
  months: array(object({ year, month, month_label: string, income: decimal, expense: decimal })),
  top_categories: array(object({ category: string, amount: decimal })),
  top_merchants: array(object({ description: string, amount: decimal })),
  total_income: decimal,
  total_expense: decimal,
});
const budget = object({
  ...envelope,
  year,
  month,
  actuals: array(budgetLine),
  alerts: array(
    object({
      category: string,
      budget_group: string,
      budgeted: decimal,
      actual: decimal,
      pct: decimal,
      level: (v) => v === "warning" || v === "over",
      cap_enabled: boolean,
    }),
  ),
  flow,
  members: array(
    object({
      category: string,
      budget_group: string,
      budgeted: decimal,
      member_id: nullable(id),
      member_name: nullable(string),
      actual: decimal,
    }),
  ),
});
const report = object({
  ...envelope,
  fromYear: year,
  fromMonth: month,
  toYear: year,
  toMonth: month,
  cells: array(
    object({
      month: (v) => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v),
      category: string,
      amount: decimal,
    }),
  ),
  flow,
  daily: array(object({ date, amount: decimal })),
});
const serial = (y: number, m: number) => y * 12 + m - 1;
function invalid(): never {
  throw new TransactionError(
    "invalid_response",
    "The app received incomplete or inconsistent financial totals. Retry loading data.",
  );
}
export function validateBudgetSnapshot(value: unknown): BudgetSnapshot {
  if (!budget(value)) return invalid();
  const result = value as BudgetSnapshot;
  if (
    result.flow.months.length !== 1 ||
    result.flow.months[0].year !== result.year ||
    result.flow.months[0].month !== result.month
  )
    return invalid();
  return result;
}
export function validateReportSnapshot(value: unknown): ReportSnapshot {
  if (!report(value)) return invalid();
  const result = value as ReportSnapshot;
  const start = serial(result.fromYear, result.fromMonth),
    end = serial(result.toYear, result.toMonth);
  if (
    end < start ||
    end - start >= 1200 ||
    result.flow.months.length !== end - start + 1 ||
    result.flow.months.some((m, i) => serial(m.year, m.month) !== start + i)
  )
    return invalid();
  const contains = (s: string) => {
    const n = serial(Number(s.slice(0, 4)), Number(s.slice(5, 7)));
    return n >= start && n <= end;
  };
  if (result.cells.some((c) => !contains(c.month)) || result.daily.some((d) => !contains(d.date))) return invalid();
  return result;
}

const summaryReport = object({
  total_saved: decimal,
  income_total: decimal,
  month_label: string,
  budget_actuals: array(budgetLine),
});
const summary = object({ ...envelope, asOf: date, report: summaryReport, accounts: array(accountCheck), averageSpend: decimal });
const dashboard = object({
  ...envelope,
  asOf: date,
  report: summaryReport,
  netWorth: array(
    object({ month_label: string, value: decimal, cash: decimal, debt: decimal, investments: decimal, as_of: date }),
  ),
  spending: array(object({ category: string, amount: decimal })),
  alerts: array(
    object({
      category: string,
      budget_group: string,
      budgeted: decimal,
      actual: decimal,
      pct: decimal,
      level: (v) => v === "warning" || v === "over",
      cap_enabled: boolean,
    }),
  ),
  insights: array(
    object({
      severity: (v) => v === "warning" || v === "info" || v === "positive",
      kind: (v) => v === "pace" || v === "category_jump" || v === "category_drop" || v === "large_expense",
      message: string,
    }),
  ),
  averageSpend: decimal,
  enoughHistory: boolean,
  contributions: array(
    object({ account_id: id, name: string, group: string, from_amount: decimal, to_amount: decimal, delta: decimal }),
  ),
});
export function validateReportSummarySnapshot(value: unknown): ReportSummarySnapshot {
  if (!summary(value)) return invalid();
  return value as ReportSummarySnapshot;
}
export function validateDashboardSnapshot(value: unknown): DashboardSnapshot {
  if (!dashboard(value)) return invalid();
  const result = value as DashboardSnapshot;
  if (
    result.netWorth.length !== 6 ||
    result.netWorth.at(-1)?.as_of !== result.asOf ||
    result.netWorth.some(
      (point, i) => point.as_of > result.asOf || (i > 0 && point.as_of <= result.netWorth[i - 1].as_of),
    )
  )
    return invalid();
  return result;
}
