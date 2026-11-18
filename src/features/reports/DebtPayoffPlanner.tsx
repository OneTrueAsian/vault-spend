import { useState } from "react";
import type { Account, DebtPayoffPlan } from "../../shared/lib/types";
import { formatAmount, formatDisplayDate } from "../../shared/lib/format";
import { groupOf, owedAmount } from "../../shared/lib/accountGroups";
import { PinToDashboardButton } from "../../shared/ui/PinToDashboardButton";
import type { WidgetId } from "../../shared/lib/dashboardLayout";
import { MenuSelect } from "../../shared/ui/MenuSelect";

/** The debt payoff planner. Shown on Cash Flow; kept in its own file so Cash Flow and Reports
 * changes do not collide (VS-31). */
/** How much is actually owed on a debt account — the positive counterpart
 * to `netWorthContribution`'s (negative) debt contribution. Matches
 * `AccountRow`'s own `owed` calculation. */
const DEBT_STRATEGY_OPTIONS: { value: string; label: string }[] = [
  { value: "snowball", label: "Snowball (smallest balance first)" },
  { value: "avalanche", label: "Avalanche (highest rate first)" },
];

export function DebtPayoffPlannerSection({
  accounts,
  onSetAccountInterestRate,
  onCalculateDebtPayoff,
  onSetAccountExcludedFromDebtPayoff,
  layoutWidgets,
  onPinWidget,
}: {
  accounts: Account[];
  onSetAccountInterestRate: (accountId: number, rate: string | null) => void;
  onCalculateDebtPayoff: (
    strategy: string,
    extraPayment: string,
    minimums: { accountId: number; minimumPayment: string }[],
  ) => Promise<DebtPayoffPlan | null>;
  onSetAccountExcludedFromDebtPayoff: (accountId: number, excluded: boolean) => void;
  layoutWidgets: WidgetId[];
  onPinWidget: (id: WidgetId) => void;
}) {
  // Every debt with a balance owed is listed — including ones the user has
  // excluded (e.g. a card paid off in full every month) — so excluding is
  // reversible via the checkbox rather than making the account disappear
  // from view entirely.
  const debtAccounts = accounts.filter((a) => {
    const g = groupOf(a.account_type);
    return (g === "credit" || g === "loan") && owedAmount(a) > 0;
  });

  const [strategy, setStrategy] = useState("snowball");
  const [extraPayment, setExtraPayment] = useState("0");
  const [minimums, setMinimums] = useState<Record<number, string>>({});
  const [plan, setPlan] = useState<DebtPayoffPlan | null>(null);
  const [calculating, setCalculating] = useState(false);

  if (debtAccounts.length === 0) return null;

  async function handleCalculate() {
    setCalculating(true);
    setPlan(
      await onCalculateDebtPayoff(
        strategy,
        extraPayment.trim() || "0",
        debtAccounts.map((a) => ({ accountId: a.id, minimumPayment: minimums[a.id]?.trim() || "0" })),
      ),
    );
    setCalculating(false);
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Debt Payoff Planner</span>
        <PinToDashboardButton widgetId="debt_payoff" layoutWidgets={layoutWidgets} onPin={onPinWidget} />
      </div>
      <table className="ledger">
        <thead>
          <tr>
            <th>Include</th>
            <th>Debt</th>
            <th className="amount-col">Balance</th>
            <th className="amount-col">APR %</th>
            <th className="amount-col">Minimum payment</th>
          </tr>
        </thead>
        <tbody>
          {debtAccounts.map((a) => (
            <tr key={a.id}>
              <td>
                <input
                  type="checkbox"
                  checked={!a.excluded_from_debt_payoff}
                  title="Include in payoff plan — uncheck for a debt you already pay off in full, like a credit card, so it isn't treated as debt to pay down"
                  onChange={(e) => onSetAccountExcludedFromDebtPayoff(a.id, !e.target.checked)}
                />
              </td>
              <td>{a.name}</td>
              <td className="amount-col">{formatAmount(owedAmount(a))}</td>
              <td className="amount-col">
                <input
                  className="amount-edit-input"
                  defaultValue={a.interest_rate ?? ""}
                  placeholder="0.00"
                  onBlur={(e) => onSetAccountInterestRate(a.id, e.target.value.trim() || null)}
                />
              </td>
              <td className="amount-col">
                <input
                  className="amount-edit-input"
                  value={minimums[a.id] ?? ""}
                  placeholder="0.00"
                  onChange={(e) => setMinimums({ ...minimums, [a.id]: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="labeled-field-form" onSubmit={(e) => { e.preventDefault(); handleCalculate(); }}>
        <label className="labeled-field">
          <span className="labeled-field-label">Strategy</span>
          <MenuSelect
            ariaLabel="Strategy"
            value={strategy}
            onChange={setStrategy}
            options={DEBT_STRATEGY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </label>
        <label className="labeled-field">
          <span className="labeled-field-label">Extra monthly payment</span>
          <input value={extraPayment} onChange={(e) => setExtraPayment(e.target.value)} placeholder="0.00" />
        </label>
        <button type="submit" disabled={calculating} style={{ alignSelf: "flex-end" }}>
          {calculating ? "Calculating…" : "Calculate"}
        </button>
      </form>

      {plan && (
        <>
          <div className="stats">
            <div className="stat tint-accent">
              <span className="stat-value">{plan.total_months !== null ? `${plan.total_months} mo` : "Never"}</span>
              <span className="stat-label">Debt-free in</span>
            </div>
            <div className="stat tint-red">
              <span className="stat-value">{formatAmount(plan.total_interest_paid)}</span>
              <span className="stat-label">Total interest</span>
            </div>
          </div>
          <table className="ledger">
            <thead>
              <tr>
                <th>Debt</th>
                <th>Payoff date</th>
                <th className="amount-col">Interest paid</th>
              </tr>
            </thead>
            <tbody>
              {plan.per_account.map((l) => (
                <tr key={l.account_id}>
                  <td>{l.account_name}</td>
                  <td>{l.payoff_date ? formatDisplayDate(l.payoff_date) : "Never at this payment level"}</td>
                  <td className="amount-col">{formatAmount(l.total_interest_paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
