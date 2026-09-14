import type { Account, Asset, FamilyMember, MemberBudgetActual, Transaction } from "./types";
import { formatAmount } from "./format";
import { incomeByMember, netWorthByMember, spendingByMember } from "./memberBreakdowns";

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
  monthLabel,
  year,
  month,
  onPrevMonth,
  onNextMonth,
}: {
  transactions: Transaction[];
  accounts: Account[];
  assets: Asset[];
  familyMembers: FamilyMember[];
  memberBudgetActuals: MemberBudgetActual[];
  monthLabel: string;
  /** Same year/month `monthLabel` and `memberBudgetActuals` are already
   * scoped to (the Budget tab's own month cursor) — used to scope the
   * spending/income cards below to the same month, so this page doesn't
   * mix an all-time figure against a monthly one on the same screen. */
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  if (familyMembers.length === 0) {
    return (
      <div className="reports-view">
        <div className="page-top">
          <div>
            <h1 className="view-title">Household</h1>
            <p className="view-sub">Net worth, income, and spending by family member.</p>
          </div>
        </div>
        <div className="card">
          <p className="modal-message-secondary">
            Add a family member (Transactions tab → "Manage family members…") to see spending and budgets broken down by
            person.
          </p>
        </div>
      </div>
    );
  }

  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const transactionsThisMonth = transactions.filter((t) => t.date.startsWith(monthKey));
  const spending = spendingByMember(transactionsThisMonth);
  const income = incomeByMember(transactionsThisMonth, accounts);
  const netWorth = netWorthByMember(accounts, assets);

  // Group this month's per-member actuals by category, preserving the
  // order categories first appear in (already sorted by category from the
  // backend) so the table reads top-to-bottom the same way every time.
  const categoryOrder: string[] = [];
  const byCategory = new Map<string, MemberBudgetActual[]>();
  for (const row of memberBudgetActuals) {
    if (!byCategory.has(row.category)) {
      categoryOrder.push(row.category);
      byCategory.set(row.category, []);
    }
    byCategory.get(row.category)!.push(row);
  }

  return (
    <div className="reports-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Household</h1>
          <p className="view-sub">{monthLabel}, by family member.</p>
        </div>
      </div>
      <div className="month-nav">
        <button type="button" className="modal-secondary" onClick={onPrevMonth} aria-label="Previous month">
          ‹
        </button>
        <span className="month-label">{monthLabel}</span>
        <button type="button" className="modal-secondary" onClick={onNextMonth} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="card">
        <h2 className="reports-section-title">Spending by person ({monthLabel})</h2>
        {spending.length === 0 ? (
          <p className="modal-message-secondary">No spending attributed to a specific person this month.</p>
        ) : (
          <ul className="breakdown-list">
            {spending.map((row) => (
              <li key={row.name}>
                <span>{row.name}</span>
                <span>{formatAmount(row.amount.toFixed(2))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 className="reports-section-title">Income by person ({monthLabel})</h2>
        {income.length === 0 ? (
          <p className="modal-message-secondary">No income attributed to a specific person this month.</p>
        ) : (
          <ul className="breakdown-list">
            {income.map((row) => (
              <li key={row.name}>
                <span>{row.name}</span>
                <span>{formatAmount(row.amount.toFixed(2))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 className="reports-section-title">Net worth by person</h2>
        <p className="modal-message-secondary">Always as of today — net worth isn't a monthly figure like the cards above.</p>
        <ul className="breakdown-list">
          {netWorth.map((row) => (
            <li key={row.name}>
              <span>{row.name}</span>
              <span>{formatAmount(row.amount.toFixed(2))}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="reports-section-title">Budget, by category and person</h2>
        <p className="modal-message-secondary">
          Budgets are shared per category — there's no separate target per person, just each person's share of what's
          already been spent.
        </p>
        {categoryOrder.length === 0 ? (
          <p className="empty-state">No budgeted spending yet this month.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Category</th>
                <th>Person</th>
                <th className="amount-col">Spent</th>
                <th className="amount-col">Budgeted</th>
              </tr>
            </thead>
            <tbody>
              {categoryOrder.map((category) =>
                byCategory.get(category)!.map((row, i) => (
                  <tr key={`${category}-${row.member_id ?? "unassigned"}`}>
                    <td>{i === 0 ? category : ""}</td>
                    <td>{row.member_name ?? "Unassigned"}</td>
                    <td className="amount-col">{formatAmount(row.actual)}</td>
                    <td className="amount-col">{i === 0 ? formatAmount(row.budgeted) : ""}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
