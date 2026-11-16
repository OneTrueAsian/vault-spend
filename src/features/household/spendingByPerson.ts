import { isIncomeTransaction } from "../../shared/lib/accountGroups";
import { isTransferTransaction } from "../../shared/lib/transfers";
import type { StackedRow } from "../../shared/ui/StackedRows";
import type { Account, Transaction } from "../../shared/lib/types";

type Person = { id: number | null; name: string };

const cents = (amount: string | number) => Math.round(Number(amount) * 100);
const spendOf = (t: Transaction) => (Number(t.amount) < 0 && !isTransferTransaction(t) ? -cents(t.amount) : 0);

/** "Spending by person": one stacked row per person (Shared last), each a month's outflows by category. The tick is what the
 * person earned, the same figure as the Income column of the month-by-person table (and left off when nothing came in). Money
 * in, refunds and transfers are not bars, as in that table's Spending column. */
export function spendingByPersonRows(people: Person[], monthTransactions: Transaction[], accounts: Account[]): StackedRow[] {
  return people.map((person) => {
    const mine = monthTransactions.filter((t) => t.member_id === person.id);
    const byCategory = new Map<string, number>();
    for (const t of mine) {
      const spent = spendOf(t);
      if (spent > 0) byCategory.set(t.category ?? "Uncategorized", (byCategory.get(t.category ?? "Uncategorized") ?? 0) + spent);
    }
    const earned = mine.filter((t) => isIncomeTransaction(t, accounts)).reduce((n, t) => n + cents(t.amount), 0);
    return {
      label: person.name,
      segments: [...byCategory].map(([category, amount]) => ({ category, amount: amount / 100 })),
      ...(earned > 0 ? { tick: earned / 100 } : {}),
    };
  });
}

const nameOf = (t: Transaction) => (t.description ?? "").trim().toLowerCase();
/** Same name and about the same amount (within 15%): the look of a regular bill. A shop visited for a very different amount is not. */
const sameBill = (a: Transaction, b: Transaction) => nameOf(a) !== "" && nameOf(a) === nameOf(b) && Math.abs(Math.abs(Number(a.amount)) - Math.abs(Number(b.amount))) <= Math.abs(Number(a.amount)) * 0.15;

/** A person's biggest single purchase of the month, named when it is at least a fifth of what they spent (v9's rule). v9 passes
 * over anything that matches a recurring item; the app's matcher is not available per transaction here, so a purchase bought
 * under the same name for about the same amount in another month (rent, a subscription) counts as a regular bill instead. */
export function biggestOneOffNotes(people: Person[], monthTransactions: Transaction[], allTransactions: Transaction[]) {
  const notes: { name: string; description: string; amount: number; share: number }[] = [];
  for (const person of people) {
    const spending = monthTransactions.filter((t) => t.member_id === person.id && spendOf(t) > 0);
    const total = spending.reduce((n, t) => n + spendOf(t), 0);
    const oneOffs = spending.filter((t) => !allTransactions.some((o) => o.date.slice(0, 7) !== t.date.slice(0, 7) && sameBill(o, t)));
    const biggest = oneOffs.reduce<Transaction | null>((best, t) => (best === null || spendOf(t) > spendOf(best) ? t : best), null);
    if (biggest && spendOf(biggest) * 5 >= total) {
      notes.push({ name: person.name, description: biggest.description, amount: spendOf(biggest) / 100, share: Math.round((spendOf(biggest) / total) * 100) });
    }
  }
  return notes;
}
