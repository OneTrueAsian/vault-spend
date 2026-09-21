import type { Account, Recurring, RecurringMatch, Transaction } from "./types";
import { isTransferTransaction } from "./transfers";
import { formatAmount } from "./format";

export type AttentionKind = "month_review" | "uncategorized" | "bills_missed" | "price_changes" | "bills_due" | "stale_accounts";

export type AttentionItem = {
  kind: AttentionKind;
  count: number;
  label: string;
  /** Names of the bills/accounts behind the count, when that's what the
   * row is about. */
  detail?: string;
};

/** Same window App.tsx's native bill notification uses — a bill counts as
 * "due soon" from today through this many days out. */
export const DUE_SOON_DAYS = 3;
/** Days without a single transaction before an everyday account looks like
 * it's missing an import. */
export const STALE_ACCOUNT_DAYS = 30;

/** Only accounts where activity is expected every few weeks. A savings
 * account can sit untouched for months (or see only interest), a loan is
 * paid on its own monthly schedule, and an investment account's activity
 * lives in Holdings rather than transactions — flagging any of them would
 * be a permanent false alarm. */
const ACTIVITY_EXPECTED_TYPES = new Set(["checking", "credit"]);

/** Parses "YYYY-MM-DD" as a *local* date — `new Date("2026-09-18")` is UTC
 * midnight and lands on the previous day in any timezone behind UTC. */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

/** "A, B, +1 more" — names shown up to two, then a count of the rest. */
function summarizeNames(names: string[]): string {
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")}, +${names.length - 2} more`;
}

/** The things on the Dashboard's "Needs a look" card that need *doing*
 * rather than just knowing: transactions still without a category, bills
 * about to come due, and everyday accounts that have gone quiet (usually a
 * sign the last import was a while ago). Each item appears only when its
 * count is above zero, so an all-clear month renders nothing at all. */
export function attentionItems({
  transactions,
  recurring,
  accounts,
  today,
  recurringMatches = [],
  monthReview = null,
}: {
  transactions: Transaction[];
  recurring: Recurring[];
  accounts: Account[];
  today: Date;
  /** How each recurring item lines up with real charges — adds the "looks
   * missed" and "changed price" rows; without it those rows never appear. */
  recurringMatches?: RecurringMatch[];
  /** The month whose end-of-month review is on offer (see `monthReviewDue`), if any. */
  monthReview?: { label: string } | null;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (monthReview) {
    items.push({ kind: "month_review", count: 1, label: `Review ${monthReview.label} — last month's check-in` });
  }

  // A linked transfer's legs never need a category — they aren't spending.
  const uncategorized = transactions.filter((t) => t.category === null && !isTransferTransaction(t)).length;
  if (uncategorized > 0) {
    items.push({
      kind: "uncategorized",
      count: uncategorized,
      label: `${uncategorized} ${plural(uncategorized, "transaction")} ${uncategorized === 1 ? "needs" : "need"} a category`,
    });
  }

  const matchByItem = new Map(recurringMatches.map((m) => [m.recurring_id, m]));

  const missed = recurring.filter(
    (r) => r.status !== "canceled" && parseFloat(r.amount) < 0 && matchByItem.get(r.id)?.state === "missed",
  );
  if (missed.length > 0) {
    items.push({
      kind: "bills_missed",
      count: missed.length,
      label: `${missed.length} ${plural(missed.length, "bill")} ${missed.length === 1 ? "looks" : "look"} missed — no matching charge`,
      detail: summarizeNames(missed.map((r) => r.merchant)),
    });
  }

  // A price change the amount on file already reflects has been dealt with.
  const repriced = recurring.filter((r) => {
    const change = matchByItem.get(r.id)?.price_change;
    return r.status !== "canceled" && change != null && Math.abs(parseFloat(r.amount) - parseFloat(change.to)) >= 0.005;
  });
  if (repriced.length > 0) {
    items.push({
      kind: "price_changes",
      count: repriced.length,
      label: `${repriced.length} ${plural(repriced.length, "subscription")} changed price`,
      detail: summarizeNames(
        repriced.map((r) => {
          const change = matchByItem.get(r.id)!.price_change!;
          return `${r.merchant} ${formatAmount(Math.abs(parseFloat(change.from)))} → ${formatAmount(Math.abs(parseFloat(change.to)))}`;
        }),
      ),
    });
  }

  const dueSoon = recurring.filter((r) => {
    if (r.status === "canceled" || parseFloat(r.amount) >= 0) return false;
    const days = daysBetween(todayMidnight, parseLocalDate(r.next_date));
    return days >= 0 && days <= DUE_SOON_DAYS;
  });
  if (dueSoon.length > 0) {
    items.push({
      kind: "bills_due",
      count: dueSoon.length,
      label: `${dueSoon.length} ${plural(dueSoon.length, "bill")} due in the next ${DUE_SOON_DAYS} days`,
      detail: summarizeNames(dueSoon.map((r) => r.merchant)),
    });
  }

  const lastActivity = new Map<number, string>();
  for (const t of transactions) {
    const seen = lastActivity.get(t.account_id);
    if (seen === undefined || t.date > seen) lastActivity.set(t.account_id, t.date);
  }
  const stale = accounts.filter((a) => {
    if (!ACTIVITY_EXPECTED_TYPES.has(a.account_type)) return false;
    const last = lastActivity.get(a.id);
    if (last === undefined) return false; // never used — the first-run checklist's job, not a stale alarm
    return daysBetween(parseLocalDate(last), todayMidnight) >= STALE_ACCOUNT_DAYS;
  });
  if (stale.length > 0) {
    items.push({
      kind: "stale_accounts",
      count: stale.length,
      label: `${stale.length} ${plural(stale.length, "account")} with no activity in ${STALE_ACCOUNT_DAYS}+ days`,
      detail: summarizeNames(stale.map((a) => a.name)),
    });
  }

  return items;
}
