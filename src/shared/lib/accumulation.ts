/** Pure maths behind an investment account's "Accumulation & projection":
 * what the recent monthly deposit averages, and where the account is headed if
 * that keeps up until a withdraw month (and how it pays out after). Kept apart
 * from the screens so the numbers can be tested without rendering anything;
 * the Investments tab's what-if calculator (`projections.ts`) is separate and
 * untouched. */

import { isValidDecimalString } from "./format";

/** One calendar month of money moving in and out of an account — the backend's
 * `ContributionMonth`, as numbers. `month` is "YYYY-MM"; `moneyOut` is positive. */
export interface MonthFlow {
  month: string;
  moneyIn: number;
  moneyOut: number;
}

/** A balance a whole number of months from now (0 = now). */
export interface ProjectionPoint {
  month: number;
  balance: number;
}

/** One year's withdrawal from a drawdown. */
export interface YearlyWithdrawal {
  /** 1 for the first withdrawal, on the withdraw month itself. */
  year: number;
  /** Months from now that it happens. */
  month: number;
  amount: number;
  balanceAfter: number;
}

export interface ProjectionInput {
  startValue: number;
  monthlyContribution: number;
  annualReturnPct: number;
  /** Whole months from now to the withdraw month; contributions stop there. */
  monthsToWithdraw: number;
  /** Spread the withdrawals over this many years, or `null` to just stop at the withdraw month. */
  withdrawYears: number | null;
}

export interface Projection {
  /** Month by month from now to the withdraw month — or through the last withdrawal. */
  points: ProjectionPoint[];
  /** What the account is projected to hold on the withdraw month, before any withdrawal. */
  balanceAtWithdraw: number;
  /** Everything still to be contributed before then. */
  contributions: number;
  /** What the balance at the withdraw month owes to growth rather than to money put in. */
  growth: number;
  withdrawals: YearlyWithdrawal[];
}

/** "2026-09" as a count of months, so two of them can be subtracted. */
export function monthIndex(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return year * 12 + (m - 1);
}

/** Whole calendar months from the month `today` ("YYYY-MM-DD") falls in to
 * `withdrawMonth` ("YYYY-MM"): 0 for this month, negative once it has passed. */
export function monthsUntil(today: string, withdrawMonth: string): number {
  return monthIndex(withdrawMonth) - monthIndex(today.slice(0, 7));
}

/** How many complete months the default monthly amount averages over. */
const AVERAGE_WINDOW_MONTHS = 6;

/** The default monthly amount: money in per calendar month over the last six
 * COMPLETE months (the month in progress is left out), counting a month with
 * no deposit as zero. Fewer months when the first deposit is newer than that.
 * `null` when there is no complete month with a deposit to average — nothing
 * deposited, or only this month's. Rounded to cents. */
export function averageMonthlyContribution(months: MonthFlow[], today: string): number | null {
  const firstDeposit = months.find((m) => m.moneyIn > 0);
  if (!firstDeposit) return null;
  const windowEnd = monthIndex(today.slice(0, 7)) - 1;
  const windowStart = Math.max(monthIndex(firstDeposit.month), windowEnd + 1 - AVERAGE_WINDOW_MONTHS);
  if (windowEnd < windowStart) return null;
  let total = 0;
  for (const m of months) {
    const index = monthIndex(m.month);
    if (index >= windowStart && index <= windowEnd) total += m.moneyIn;
  }
  return Math.round((total / (windowEnd - windowStart + 1)) * 100) / 100;
}

/** Runs an account forward month by month: monthly compounding with the flat
 * contribution added after each month's growth (the same convention as the
 * Investments tab's what-if calculator), until the withdraw month. With
 * `withdrawYears` it then pays out: on the withdraw month and once a year
 * after, the account takes the balance divided by the years left, and the rest
 * keeps growing at the same rate — so the last year takes everything and the
 * account ends at exactly $0. Contributions stop when withdrawals start. */
export function projectAccount(input: ProjectionInput): Projection {
  const monthly = input.annualReturnPct / 100 / 12;
  const points: ProjectionPoint[] = [{ month: 0, balance: input.startValue }];
  let balance = input.startValue;
  for (let m = 1; m <= input.monthsToWithdraw; m++) {
    balance = balance * (1 + monthly) + input.monthlyContribution;
    points.push({ month: m, balance });
  }
  const balanceAtWithdraw = balance;
  const contributions = input.monthlyContribution * input.monthsToWithdraw;

  const withdrawals: YearlyWithdrawal[] = [];
  if (input.withdrawYears !== null) {
    let month = input.monthsToWithdraw;
    for (let year = 1; year <= input.withdrawYears; year++) {
      const yearsLeft = input.withdrawYears - year + 1;
      const amount = yearsLeft === 1 ? balance : balance / yearsLeft;
      balance = yearsLeft === 1 ? 0 : balance - amount;
      withdrawals.push({ year, month, amount, balanceAfter: balance });
      // The drop is a second point on the same month, so the line steps down.
      points.push({ month, balance });
      if (yearsLeft === 1) break;
      for (let i = 0; i < 12; i++) {
        balance *= 1 + monthly;
        month++;
        points.push({ month, balance });
      }
    }
  }

  return {
    points,
    balanceAtWithdraw,
    contributions,
    growth: balanceAtWithdraw - input.startValue - contributions,
    withdrawals,
  };
}

/** What `value`, received `years` from now, would buy in today's money at
 * `inflationPct` a year. */
export function toTodaysDollars(value: number, inflationPct: number, years: number): number {
  return value / (1 + inflationPct / 100) ** years;
}

/** `points` expressed in today's dollars, each deflated by its own distance
 * from now. */
export function deflatePoints(points: ProjectionPoint[], inflationPct: number): ProjectionPoint[] {
  return points.map((p) => ({ month: p.month, balance: toTodaysDollars(p.balance, inflationPct, p.month / 12) }));
}

/** Adds up several accounts' projections into one series, sampled every `step`
 * months (and on the last month of the longest one). An account is counted
 * while its own projection runs — its balance after any withdrawal that month —
 * and as nothing after it ends: with a drawdown it has reached $0 by then, and
 * without one it is treated as withdrawn in full on its withdraw month. */
export function combineProjections(projections: Projection[], step = 12): ProjectionPoint[] {
  if (projections.length === 0) return [];
  const lastMonths = projections.map((p) => p.points[p.points.length - 1].month);
  const end = Math.max(...lastMonths);
  const months: number[] = [];
  for (let m = 0; m < end; m += step) months.push(m);
  months.push(end);

  const balanceAt = (p: Projection, month: number): number => {
    let balance = 0;
    for (const point of p.points) {
      if (point.month > month) break;
      balance = point.balance;
    }
    return p.points[p.points.length - 1].month < month ? 0 : balance;
  };
  return months.map((month) => ({ month, balance: projections.reduce((sum, p) => sum + balanceAt(p, month), 0) }));
}

/** Net money in (in minus out) running up month by month — the "cash invested"
 * line on the chart. */
export function cumulativeNet(months: MonthFlow[]): { month: string; net: number }[] {
  let net = 0;
  return months.map((m) => {
    net += m.moneyIn - m.moneyOut;
    return { month: m.month, net };
  });
}

export interface PlanInput {
  /** The saved monthly amount, or `null` to use the recent average. */
  monthlyContribution: number | null;
  annualReturnPct: number;
  /** "YYYY-MM", or `null` for none set. */
  withdrawMonth: string | null;
  withdrawYears: number | null;
}

export interface SummaryInput {
  /** What the account is worth today (its Accounts-tab figure). */
  worthNow: number;
  months: MonthFlow[];
  totalIn: number;
  totalOut: number;
  plan: PlanInput;
  /** "YYYY-MM-DD". */
  today: string;
  inflationPct: number;
  /** Show projected figures in today's money. Only ever affects the projection. */
  todaysDollars: boolean;
}

export interface AccountSummary {
  totalIn: number;
  totalOut: number;
  /** Money in minus money out. */
  netInvested: number;
  worthNow: number;
  /** Worth now minus net invested; negative when the account is down. */
  growth: number;
  /** The recent average, `null` when there is nothing to average. */
  averageMonthly: number | null;
  /** The amount the projection uses: the saved one, else the average, else 0. */
  monthly: number;
  monthlySource: "saved" | "average" | "none";
  /** `no-date`: no withdraw month set. `passed`: the saved month is behind us. */
  status: "no-date" | "passed" | "ok";
  monthsToWithdraw: number | null;
  /** The projection in plain (not deflated) dollars, for charting. */
  projection: Projection | null;
  /** The balance on the withdraw month — in today's dollars when asked for. */
  projectedFinal: number | null;
  /** Each year's withdrawal, in today's dollars when asked for. */
  withdrawals: YearlyWithdrawal[];
}

/** Everything a screen shows about one investment account, derived once so the
 * Details page and the Investments summary can't disagree. */
export function summarizeAccumulation(input: SummaryInput): AccountSummary {
  const netInvested = input.totalIn - input.totalOut;
  const averageMonthly = averageMonthlyContribution(input.months, input.today);
  const saved = input.plan.monthlyContribution;
  const monthlySource = saved !== null ? "saved" : averageMonthly !== null ? "average" : "none";
  const monthly = saved ?? averageMonthly ?? 0;

  const base = {
    totalIn: input.totalIn,
    totalOut: input.totalOut,
    netInvested,
    worthNow: input.worthNow,
    growth: input.worthNow - netInvested,
    averageMonthly,
    monthly,
    monthlySource,
  } as const;

  if (input.plan.withdrawMonth === null) {
    return { ...base, status: "no-date", monthsToWithdraw: null, projection: null, projectedFinal: null, withdrawals: [] };
  }
  const monthsToWithdraw = monthsUntil(input.today, input.plan.withdrawMonth);
  if (monthsToWithdraw < 0) {
    return { ...base, status: "passed", monthsToWithdraw, projection: null, projectedFinal: null, withdrawals: [] };
  }

  const projection = projectAccount({
    startValue: input.worthNow,
    monthlyContribution: monthly,
    annualReturnPct: input.plan.annualReturnPct,
    monthsToWithdraw,
    withdrawYears: input.plan.withdrawYears,
  });
  const real = (value: number, month: number) => (input.todaysDollars ? toTodaysDollars(value, input.inflationPct, month / 12) : value);
  return {
    ...base,
    status: "ok",
    monthsToWithdraw,
    projection,
    projectedFinal: real(projection.balanceAtWithdraw, monthsToWithdraw),
    withdrawals: projection.withdrawals.map((w) => ({ ...w, amount: real(w.amount, w.month), balanceAfter: real(w.balanceAfter, w.month) })),
  };
}

/** A date ("YYYY-MM-DD") as a position on the month axis the chart uses:
 * `monthIndex` plus the day's share of its month. */
export function dateX(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return monthIndex(iso.slice(0, 7)) + (day - 1) / daysInMonth;
}

/** The text in the projection settings form, as typed. */
export interface PlanFormFields {
  monthly: string;
  returnPct: string;
  /** "YYYY-MM" from the month picker, or blank. */
  withdrawMonth: string;
  withdrawYears: string;
  inflation: string;
}

const isPercent = (s: string) => isValidDecimalString(s) && Number(s) >= 0 && Number(s) <= 100;

/** The first thing wrong with the form, as a sentence for the person, or `null`
 * when it can be saved. Mirrors what the backend refuses, so a bad entry is
 * caught before anything is sent (and nothing is half-saved). A withdraw month
 * already saved stays valid even once it has passed, so editing another field
 * isn't blocked by a date that wasn't touched. */
export function validatePlanForm(f: PlanFormFields, today: string, savedWithdrawMonth: string | null): string | null {
  const monthly = f.monthly.trim();
  if (monthly !== "" && (!isValidDecimalString(monthly) || Number(monthly) < 0)) {
    return "The monthly amount has to be a number, 0 or more.";
  }
  if (!isPercent(f.returnPct.trim())) return "The assumed return has to be a number between 0 and 100.";
  const withdrawMonth = f.withdrawMonth.trim();
  if (withdrawMonth !== "" && withdrawMonth < today.slice(0, 7) && withdrawMonth !== savedWithdrawMonth) {
    return "That withdraw month is in the past — pick this month or later.";
  }
  const years = f.withdrawYears.trim();
  if (years !== "" && !(/^\d+$/.test(years) && Number(years) >= 1 && Number(years) <= 50)) {
    return "Spread the withdrawals over 1 to 50 whole years, or leave it blank.";
  }
  if (!isPercent(f.inflation.trim())) return "Inflation has to be a number between 0 and 100.";
  return null;
}
