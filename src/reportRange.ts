/** Pure helpers for the Reports hub: which months a report covers, and the
 * shape of its category-by-month table. Kept out of the component so they can
 * be unit tested without rendering anything. */

export type YearMonth = { year: number; month: number };
export type RangePreset = "year_to_date" | "last_12" | "last_6" | "last_month";

export const PRESET_LABELS: Record<RangePreset, string> = {
  year_to_date: "Year to date",
  last_12: "Last 12 months",
  last_6: "Last 6 months",
  last_month: "Last month",
};

function shiftMonth(ym: YearMonth, by: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The months a preset covers, ending with the current month (last month
 * ends with the one before it). */
export function presetRange(preset: RangePreset, today: Date): { from: YearMonth; to: YearMonth } {
  const current: YearMonth = { year: today.getFullYear(), month: today.getMonth() + 1 };
  switch (preset) {
    case "year_to_date":
      return { from: { year: current.year, month: 1 }, to: current };
    case "last_12":
      return { from: shiftMonth(current, -11), to: current };
    case "last_6":
      return { from: shiftMonth(current, -5), to: current };
    case "last_month": {
      const previous = shiftMonth(current, -1);
      return { from: previous, to: previous };
    }
  }
}

const key = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, "0")}`;

/** Every "YYYY-MM" from `from` to `to`, inclusive; none if `to` is before `from`. */
export function monthKeys(from: YearMonth, to: YearMonth): string[] {
  const keys: string[] = [];
  for (let ym = from; key(ym) <= key(to); ym = shiftMonth(ym, 1)) keys.push(key(ym));
  return keys;
}

/** Whether a "YYYY-MM-DD" date falls in any month of the range. */
export function inMonthRange(date: string, from: YearMonth, to: YearMonth): boolean {
  const month = date.slice(0, 7);
  return month >= key(from) && month <= key(to);
}

/** The first day of `ym` as "YYYY-MM-DD" — the day-level lower bound for a
 * range whose backend calls (like `daily_spending`) take actual dates
 * rather than a year/month pair. */
export function monthStartDate(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;
}

/** The last day of `ym` as "YYYY-MM-DD". Built as "day 0 of the following
 * month" so it doesn't need its own per-month day-count table — `Date.UTC`
 * already normalizes a rolled-over month (`ym.month` here is 1-based, so
 * passing it straight as the 0-based month index lands one month ahead,
 * and day 0 of that month is the last day of `ym.month`). */
export function monthEndDate(ym: YearMonth): string {
  const d = new Date(Date.UTC(ym.year, ym.month, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A column heading for "YYYY-MM": "Jul", or "Jan ’26" when the year is worth showing. */
export function monthHeading(monthKey: string, withYear = false): string {
  const [year, month] = monthKey.split("-").map(Number);
  return withYear ? `${MONTH_ABBR[month - 1]} ’${String(year).slice(2)}` : MONTH_ABBR[month - 1];
}

export type CategoryTableRow = { category: string; byMonth: number[]; total: number };
export type CategoryTable = { rows: CategoryTableRow[]; monthTotals: number[]; grandTotal: number };

/** Lays the backend's (month, category, amount) cells out as a table: a row
 * per category with one number per month (zero where nothing was spent),
 * biggest overall first, plus the totals along the bottom. */
export function buildCategoryTable(cells: { month: string; category: string; amount: string }[], months: string[]): CategoryTable {
  const columnOf = new Map(months.map((m, i) => [m, i]));
  const byCategory = new Map<string, number[]>();
  for (const cell of cells) {
    const column = columnOf.get(cell.month);
    if (column === undefined) continue;
    const row = byCategory.get(cell.category) ?? months.map(() => 0);
    row[column] += parseFloat(cell.amount) || 0;
    byCategory.set(cell.category, row);
  }
  const rows: CategoryTableRow[] = [...byCategory.entries()]
    .map(([category, byMonth]) => ({ category, byMonth, total: byMonth.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
  const monthTotals = months.map((_, i) => rows.reduce((s, r) => s + r.byMonth[i], 0));
  return { rows, monthTotals, grandTotal: monthTotals.reduce((s, v) => s + v, 0) };
}

export type YearSummary = { year: number; income: number; expense: number; net: number; savingsRate: number | null };

/** Income, spending and savings rate per calendar year, from month totals.
 * The rate is `null` for a year with no income and can go negative. */
export function yearlySummary(months: { year: number; month: number; income: string; expense: string }[]): YearSummary[] {
  const byYear = new Map<number, { income: number; expense: number }>();
  for (const m of months) {
    const entry = byYear.get(m.year) ?? { income: 0, expense: 0 };
    entry.income += parseFloat(m.income) || 0;
    entry.expense += parseFloat(m.expense) || 0;
    byYear.set(m.year, entry);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, { income, expense }]) => ({
      year,
      income,
      expense,
      net: income - expense,
      savingsRate: income > 0 ? ((income - expense) / income) * 100 : null,
    }));
}
