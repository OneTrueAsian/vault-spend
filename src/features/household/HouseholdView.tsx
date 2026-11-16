import "./HouseholdCards.css";
import { MonthField } from "../../shared/ui/MonthField";
import { CategoryIcon } from "../../shared/ui/icons";
import { PeopleCard } from "./PeopleCard";
import { isIncomeTransaction, netWorthContribution } from "../../shared/lib/accountGroups";
import { isTransferTransaction } from "../../shared/lib/transfers";
import type { Account, Asset, FamilyMember, MemberBudgetActual, Transaction } from "../../shared/lib/types";
import { formatAmount } from "../../shared/lib/format";
import { StackedRows } from "../../shared/ui/StackedRows";
import { biggestOneOffNotes, spendingByPersonRows } from "./spendingByPerson";
import { HelpLink } from "../../shared/ui/HelpLink";
import type { Tab } from "../../shared/native/appTypes";

/** A per-family-member cut of Budget and Cash Flow — built entirely on the
 * member tagging that's already threaded through accounts, transactions,
 * buckets, and recurring items elsewhere in the app. Deliberately scoped
 * to Budget + Cash Flow only: Buckets already show `member_name` on their
 * own cards, and this view must not blend "recurring monthly obligations"
 * with "sinking fund contributions" into one combined total, since a
 * household could plausibly track the same real obligation both ways
 * (e.g. a recurring "Car Insurance" line *and* a sinking-fund bucket
 * toward the same premium) — summing them would risk double-counting. */
export function HouseholdView({
  transactions,
  accounts,
  assets,
  familyMembers,
  memberBudgetActuals,
  budgetReadReady = true,
  monthLabel,
  year,
  month,
  onPrevMonth,
  onNextMonth,
  onManageMembers,
  onRenameMember,
  onRemoveMember,
  onSetYear,
  onSetMonth,
  onOpenHelp,
}: {
  transactions: Transaction[];
  accounts: Account[];
  assets: Asset[];
  familyMembers: FamilyMember[];
  memberBudgetActuals: MemberBudgetActual[];
  budgetReadReady?: boolean;
  monthLabel: string;
  /** Same year/month `monthLabel` and `memberBudgetActuals` are already
   * scoped to (the Budget tab's own month cursor) — used to scope the
   * spending/income cards below to the same month, so this page doesn't
   * mix an all-time figure against a monthly one on the same screen. */
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** Opens the same "Manage family members" dialog the Transactions tab's
   * "⋯" menu does, so the empty state below is one click from fixed
   * instead of a scavenger hunt through another tab. */
  onManageMembers: () => void;
  onRenameMember: (id: number, name: string) => void;
  onRemoveMember: (id: number) => void;
  onSetYear: (year: number) => void;
  onSetMonth: (month: number) => void;
  /** Opens Help at this page's section (the ? beside the title). */
  onOpenHelp?: (tab: Tab) => void;
}) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const transactionsThisMonth = transactions.filter((t) => t.date.startsWith(monthKey));
  const people: { id: number | null; name: string }[] = [...familyMembers];
  // Keep historical figures visible even if a snapshot contains a member outside the current roster.
  for (const row of [...transactionsThisMonth, ...accounts, ...assets, ...memberBudgetActuals]) {
    if (row.member_id !== null && row.member_name && !people.some(p => p.id === row.member_id)) {
      people.push({ id: row.member_id, name: row.member_name });
    }
  }
  people.push({ id: null, name: "Shared" });
  const personTotals = people.map(person => ({
    ...person,
    income: transactionsThisMonth.filter(t => t.member_id === person.id && isIncomeTransaction(t, accounts)).reduce((n, t) => n + Number(t.amount), 0),
    spending: transactionsThisMonth.filter(t => t.member_id === person.id && Number(t.amount) < 0 && !isTransferTransaction(t)).reduce((n, t) => n - Number(t.amount), 0),
    netWorth: accounts.filter(a => a.member_id === person.id).reduce((n, a) => n + netWorthContribution(a), 0)
      + assets.filter(a => a.member_id === person.id).reduce((n, a) => n + Number(a.value), 0),
  }));

  const spendingRows = spendingByPersonRows(people, transactionsThisMonth, accounts);
  const oneOffNotes = biggestOneOffNotes(people, transactionsThisMonth, transactions);

  // Group this month's per-member actuals by category, preserving the
  // order categories first appear in (already sorted by category from the
  // backend) so the table reads top-to-bottom the same way every time.
  const categoryOrder: string[] = [];
  const byCategory = new Map<string, MemberBudgetActual[]>();
  for (const row of memberBudgetActuals) {
    if (row.budget_group === "income") continue; // spending categories only; income is not budgeted per person here
    if (!byCategory.has(row.category)) {
      categoryOrder.push(row.category);
      byCategory.set(row.category, []);
    }
    byCategory.get(row.category)!.push(row);
  }

  return (
    <div className="reports-view household-view">
      <div className="page-top">
        <div>
          <div className="view-title-row">
            <h1 className="view-title">Household</h1>
            {onOpenHelp && <HelpLink tab="household" onOpen={onOpenHelp} />}
          </div>
          <p className="view-sub">{monthLabel}, by family member.</p>
        </div>
        <div className="page-actions">
          <div className="month-nav">
            <button type="button" className="modal-secondary" onClick={onPrevMonth} aria-label="Previous month">
              ‹
            </button>
            <MonthField aria-label="Household month" value={monthKey} onChange={value => {
              if (!value) return;
              const [selectedYear, selectedMonth] = value.split("-").map(Number);
              onSetYear(selectedYear);
              onSetMonth(selectedMonth);
            }} />
            <button type="button" className="modal-secondary" onClick={onNextMonth} aria-label="Next month">
              ›
            </button>
          </div>
          <button type="button" onClick={onManageMembers}>Add person</button>
        </div>
      </div>

      <div className="card">
        <h2 className="reports-section-title">Spending by person</h2>
        <p className="modal-message-secondary">{monthLabel}, by category. The tick is what each person earned.</p>
        <StackedRows rows={spendingRows} caption="Spending by person and category" tickLabel="What they earned" emptyText="No spending this month." />
        {oneOffNotes.length > 0 && (
          <ul className="household-spending-notes">
            {oneOffNotes.map((note) => (
              <li key={note.name} data-spending-note>
                {note.name}'s biggest one-off cost: {note.description}, {formatAmount(note.amount.toFixed(2))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="household-cards">
        <PeopleCard members={familyMembers} onRename={onRenameMember} onRemove={onRemoveMember} />
        <section className="card" data-month-by-person>
          <h2 className="reports-section-title">{monthLabel} by person</h2>
          <div className="household-table-scroll" role="region" aria-label={`${monthLabel} by person`} tabIndex={0}>
          <table className="ledger">
            <thead><tr><th>Person</th><th className="amount-col">Income</th><th className="amount-col">Spending</th></tr></thead>
            <tbody>{personTotals.map(person => <tr key={person.id ?? "shared"}>
              <td>{person.name}</td><td className="amount-col">{formatAmount(person.income)}</td><td className="amount-col">{formatAmount(person.spending)}</td>
            </tr>)}</tbody>
          </table>
          </div>
        </section>
        <section className="card">
          <h2 className="reports-section-title">Net worth by person</h2>
          <p className="modal-message-secondary">Today's values, whatever month is chosen.</p>
          <ul className="breakdown-list">{personTotals.map(person => <li key={person.id ?? "shared"}>
            <span>{person.name}</span><span>{formatAmount(person.netWorth)}</span>
          </li>)}</ul>
        </section>
      </div>

      {budgetReadReady && <div className="card" data-budget-by-person>
        <h2 className="reports-section-title">Budget by person, {monthLabel}</h2>
        <p className="modal-message-secondary">
          Budgets are shared per category — there's no separate target per person, just each person's share of what's
          already been spent.
        </p>
        {categoryOrder.length === 0 ? (
          <p className="empty-state">No budgeted spending yet this month.</p>
        ) : (
          <div className="household-table-scroll" role="region" aria-label="Budget by person" tabIndex={0}>
          <table className="ledger">
            <thead><tr>
              <th>Category</th><th className="amount-col">Planned</th>
              {people.map(person => <th key={person.id ?? "shared"} className="amount-col">{person.name}</th>)}
            </tr></thead>
            <tbody>{categoryOrder.map(category => {
              const rows = byCategory.get(category)!;
              const amounts = people.map(person => rows.filter(row => row.member_id === person.id).reduce((n, row) => n + Number(row.actual), 0));
              const scale = amounts.reduce((n, amount) => n + Math.max(0, amount), 0);
              return <tr key={category}>
                <td><span className="cell-with-icon"><span className="row-icon-badge"><CategoryIcon category={category} /></span>{category}</span></td><td className="amount-col">{formatAmount(rows[0].budgeted)}</td>
                {people.map((person, i) => <td key={person.id ?? "shared"} className="amount-col">
                  <span className="household-person-value">
                    <span className="household-person-bar" aria-hidden="true"><span style={{width: `${scale > 0 ? Math.max(0, amounts[i]) / scale * 100 : 0}%`}} /></span>
                    <span>{formatAmount(amounts[i])}</span>
                  </span>
                </td>)}
              </tr>;
            })}</tbody>
          </table>
          </div>
        )}
      </div>}
    </div>
  );
}
