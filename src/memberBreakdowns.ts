import type { Account, Asset, Transaction } from "./types";
import { isTransferTransaction } from "./transfers";
import { isIncomeTransaction, netWorthContribution } from "./accountGroups";

/** A name→amount row for a "by family member" breakdown table. */
export type MemberAmount = { name: string; amount: number };

/** All-time spending grouped by family member, outflows only. Unlike a
 * tag, a transaction carries at most one member, so there's no
 * double-counting; an unattributed transaction is left out entirely
 * rather than lumped into a catch-all "Unassigned" bucket — this answers
 * "how much did each named person spend," not "how complete is our
 * attribution." Transactions categorized "Transfer" are excluded — moving
 * money between the household's own accounts isn't spending, matching the
 * same exclusion `Store::monthly_totals` applies on the backend. */
export function spendingByMember(transactions: Transaction[]): MemberAmount[] {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    const amount = parseFloat(t.amount);
    if (amount >= 0 || !t.member_name || isTransferTransaction(t)) continue;
    totals.set(t.member_name, (totals.get(t.member_name) ?? 0) + Math.abs(amount));
  }
  return Array.from(totals, ([name, amount]) => ({ name, amount }));
}

/** All-time income grouped by family member — the symmetric counterpart
 * to `spendingByMember` (inflows instead of outflows), same
 * drop-unattributed convention. Income itself is `isIncomeTransaction`
 * (accountGroups.ts) — the same rule `Store::monthly_totals` applies on
 * the backend, so this never disagrees with what Cash Flow reports. */
export function incomeByMember(transactions: Transaction[], accounts: Account[]): MemberAmount[] {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (!t.member_name || !isIncomeTransaction(t, accounts)) continue;
    totals.set(t.member_name, (totals.get(t.member_name) ?? 0) + parseFloat(t.amount));
  }
  return Array.from(totals, ([name, amount]) => ({ name, amount }));
}

/** Net worth grouped by family member — accounts plus manually-tracked
 * assets, using the same `netWorthContribution` convention the Accounts
 * page uses for its own type-based grouping. An "Unassigned" row covers
 * whatever isn't attributed to anyone, so — unlike the spending/income
 * breakdowns above — this total always reconciles with the overall Net
 * Worth stat. Sorted with "Unassigned" last, everything else
 * alphabetically. */
export function netWorthByMember(accounts: Account[], assets: Asset[]): MemberAmount[] {
  const totals = new Map<string, number>();
  for (const a of accounts) {
    const key = a.member_name ?? "Unassigned";
    totals.set(key, (totals.get(key) ?? 0) + netWorthContribution(a));
  }
  for (const asset of assets) {
    const key = asset.member_name ?? "Unassigned";
    totals.set(key, (totals.get(key) ?? 0) + parseFloat(asset.value));
  }
  return Array.from(totals, ([name, amount]) => ({ name, amount })).sort((x, y) =>
    x.name === "Unassigned" ? 1 : y.name === "Unassigned" ? -1 : x.name.localeCompare(y.name),
  );
}
