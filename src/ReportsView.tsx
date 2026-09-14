import { FormEvent, useState } from "react";
import type { Account, Asset, Bucket, DebtPayoffPlan, FamilyMember, Report, Transaction } from "./types";
import { StatDetailPanel } from "./StatDetailPanel";
import { LineChart } from "./charts";
import { formatAmount, isValidDecimalString, toLocalIsoDate } from "./format";
import { groupOf, isIncomeTransaction, owedAmount } from "./accountGroups";
import { PinToDashboardButton } from "./PinToDashboardButton";
import type { WidgetId } from "./dashboardLayout";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { netWorthByMember, spendingByMember } from "./memberBreakdowns";

const ASSET_TYPE_OPTIONS = ["real_estate", "vehicle", "other"];
const ASSET_TYPE_LABELS: Record<string, string> = {
  real_estate: "Real Estate",
  vehicle: "Vehicle",
  other: "Other",
};

function NewAssetForm({
  familyMembers,
  onCreate,
}: {
  familyMembers: FamilyMember[];
  onCreate: (
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState(ASSET_TYPE_OPTIONS[0]);
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [memberId, setMemberId] = useState("");
  const [open, setOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const valueTrimmed = value.trim();
  const valueError =
    valueTrimmed === ""
      ? "Enter a value."
      : !isValidDecimalString(valueTrimmed)
        ? "That doesn't look like a number."
        : parseFloat(valueTrimmed) < 0
          ? "Value can't be negative."
          : null;
  const valid = name.trim() !== "" && !valueError;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!valid) return;
    onCreate(name.trim(), assetType, valueTrimmed, toLocalIsoDate(), notes.trim() || null, memberId ? Number(memberId) : null);
    setName("");
    setValue("");
    setNotes("");
    setMemberId("");
    setSubmitAttempted(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}>Add property or valuable…</button>
    );
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Home"' />
      <select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
        {ASSET_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {ASSET_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Current value"
        aria-invalid={submitAttempted && valueError !== null}
      />
      {submitAttempted && valueError && <span className="field-error">{valueError}</span>}
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      {familyMembers.length > 0 && (
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Unassigned</option>
          {familyMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      <button type="submit" disabled={!name.trim()}>
        Save
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function PropertyAssetsSection({
  assets,
  familyMembers,
  onCreate,
  onUpdateValue,
  onSetMember,
  onDelete,
}: {
  assets: Asset[];
  familyMembers: FamilyMember[];
  onCreate: (
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) => void;
  onUpdateValue: (id: number, value: string, valuedOn: string) => void;
  onSetMember: (id: number, memberId: number | null) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));

  const total = assets.reduce((s, a) => s + parseFloat(a.value), 0);

  function commitEdit(id: number, value: string) {
    setEditing(null);
    if (!value.trim()) return;
    onUpdateValue(id, value.trim(), toLocalIsoDate());
  }

  return (
    <div>
      <h2 className="reports-section-title">
        Property &amp; Valuables <span className="account-col">{formatAmount(total)}</span>
      </h2>
      <table className="ledger">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th className="amount-col">Value</th>
            <th>Member</th>
            <th>Updated</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id}>
              <td>
                <div className="account-name-cell">{a.name}</div>
                {a.notes && <span className="account-col">{a.notes}</span>}
              </td>
              <td>{ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}</td>
              <td className="amount-col">
                {editing?.id === a.id ? (
                  <input
                    autoFocus
                    className="amount-edit-input"
                    value={editing.value}
                    onChange={(e) => setEditing({ id: a.id, value: e.target.value })}
                    onBlur={() => commitEdit(a.id, editing.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(a.id, editing.value);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <span
                    className="amount-editable"
                    title="Click to update the value"
                    onClick={() => setEditing({ id: a.id, value: a.value })}
                  >
                    {formatAmount(a.value)}
                  </span>
                )}
              </td>
              <td className="member-col">
                <select
                  value={a.member_id ?? ""}
                  onChange={(e) => onSetMember(a.id, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {familyMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>{a.valued_on}</td>
              <td className="actions-col">
                {confirmingDeleteId === a.id ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn-danger" onClick={() => onDelete(a.id)}>
                      Delete
                    </button>
                  </span>
                ) : (
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(a.id)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
          {assets.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-state">
                No property or valuables tracked yet.
              </td>
            </tr>
          )}
          <tr>
            <td colSpan={6}>
              <NewAssetForm familyMembers={familyMembers} onCreate={onCreate} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Every savings bucket's progress toward its target, side by side — a
 * summary the Buckets tab itself doesn't have (its own cards are meant to
 * be worked from one at a time, not scanned as a group). Reuses each
 * bucket's own color (see BucketsView's color picker) for its bar, so a
 * color chosen there carries through to this report for free. */
function BucketsOverviewSection({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Goals overview</span>
      </div>
      <div className="buckets-overview-list">
        {buckets.map((b) => {
          const saved = parseFloat(b.saved_amount);
          const target = b.target_amount ? parseFloat(b.target_amount) : null;
          const pct = target && target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : null;
          return (
            <div key={b.id} className="buckets-overview-row">
              <div className="buckets-overview-row-head">
                <span style={{ fontWeight: 600 }}>{b.name}</span>
                <span className="account-col">
                  {formatAmount(b.saved_amount)}
                  {b.target_amount && ` of ${formatAmount(b.target_amount)}`}
                </span>
              </div>
              {pct !== null ? (
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: b.color ?? undefined }} />
                </div>
              ) : (
                <p className="modal-message-secondary" style={{ margin: 0 }}>
                  No target set
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Savings rate — (income − expenses) ÷ income — trended over every month
 * with transaction history, trailing 12. A purely client-side reduction
 * over the same `transactions`/`accounts` this page already has (income via
 * `isIncomeTransaction` — the same rule `Store::monthly_totals` uses on the
 * backend for Cash Flow's own income figure; expense is any negative
 * amount, see `tagTotals` above, except "Transfer" — money moving between
 * the household's own accounts, same exclusion the backend applies), so it
 * needed no new prop or fetch beyond `accounts`. Cash Flow's "Income vs.
 * expenses" chart shows one month's totals in dollars; this is the trend
 * those totals form over time, as a rate. */
function SavingsRateTrendSection({ transactions, accounts }: { transactions: Transaction[]; accounts: Account[] }) {
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    const entry = monthly.get(month) ?? { income: 0, expense: 0 };
    const amount = parseFloat(t.amount);
    if (isIncomeTransaction(t, accounts)) entry.income += amount;
    else if (amount < 0 && t.category !== "Transfer") entry.expense += Math.abs(amount);
    monthly.set(month, entry);
  }
  const points = Array.from(monthly.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-12)
    .map(([month, { income, expense }]) => ({
      label: new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }),
      value: income > 0 ? ((income - expense) / income) * 100 : 0,
    }));

  if (points.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Savings rate trend</span>
      </div>
      <p className="modal-message-secondary">
        (Income − expenses) ÷ income, by month — a rate can go negative in a month spending outpaced income.
      </p>
      <LineChart points={points} height={180} formatValue={(v) => `${v.toFixed(0)}%`} />
    </div>
  );
}

/** Every stat on this page that can be clicked open to show what makes it
 * up. Account-level stats (assets/liabilities/net worth) moved to
 * AccountsView along with the rest of account management — see its own
 * `AccountStatKey`. */
type ReportStatKey = "totalSaved" | "income" | "byTag" | "byMember";

const REPORT_STAT_LABELS: Record<ReportStatKey, string> = {
  totalSaved: "Total Saved",
  income: "Income (all-time)",
  byTag: "Spending by Tag",
  byMember: "Spending by Member",
};

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
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            {DEBT_STRATEGY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
                  <td>{l.payoff_date ?? "Never at this payment level"}</td>
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

export function ReportsView({
  report,
  accounts,
  buckets,
  transactions,
  assets,
  familyMembers,
  onExportCsv,
  onPrint,
  onDownloadSetupTemplate,
  onImportSetupData,
  onCreateAsset,
  onUpdateAssetValue,
  onSetAssetMember,
  onDeleteAsset,
  onOpenBudget,
  layoutWidgets,
  onPinWidget,
}: {
  report: Report | null;
  accounts: Account[];
  buckets: Bucket[];
  transactions: Transaction[];
  assets: Asset[];
  familyMembers: FamilyMember[];
  onExportCsv: () => void;
  onPrint: () => void;
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
  onCreateAsset: (
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) => void;
  onUpdateAssetValue: (id: number, value: string, valuedOn: string) => void;
  onSetAssetMember: (id: number, memberId: number | null) => void;
  onDeleteAsset: (id: number) => void;
  onOpenBudget: () => void;
  layoutWidgets: WidgetId[];
  onPinWidget: (id: WidgetId) => void;
}) {
  const [expandedStat, setExpandedStat] = useState<ReportStatKey | null>(null);

  function toggleStat(key: ReportStatKey) {
    setExpandedStat((prev) => (prev === key ? null : key));
  }

  if (!report) {
    return <p className="empty-state">Loading report…</p>;
  }

  const totalSavedBreakdown = buckets.map((b) => ({ name: b.name, amount: parseFloat(b.saved_amount) }));

  const incomeByAccount = new Map<string, number>();
  for (const t of transactions) {
    if (!isIncomeTransaction(t, accounts)) continue;
    incomeByAccount.set(t.account_name, (incomeByAccount.get(t.account_name) ?? 0) + parseFloat(t.amount));
  }
  const incomeBreakdown = Array.from(incomeByAccount, ([name, amount]) => ({ name, amount }));

  // All-time spending grouped by tag (freeform, set from the Transactions tab) —
  // only outflows count, same "spent" convention as everywhere else spend
  // is summed. A transaction with more than one tag counts under each.
  const tagTotals = new Map<string, number>();
  for (const t of transactions) {
    const amount = parseFloat(t.amount);
    if (amount >= 0) continue;
    for (const tag of t.tags) {
      tagTotals.set(tag, (tagTotals.get(tag) ?? 0) + Math.abs(amount));
    }
  }
  const tagBreakdown = Array.from(tagTotals, ([name, amount]) => ({ name, amount }));

  const memberBreakdown = spendingByMember(transactions);

  const topLevelBreakdowns: Record<"totalSaved" | "income" | "byTag" | "byMember", { name: string; amount: number }[]> = {
    totalSaved: totalSavedBreakdown,
    income: incomeBreakdown,
    byTag: tagBreakdown,
    byMember: memberBreakdown,
  };

  const netWorthByMemberRows = netWorthByMember(accounts, assets);

  return (
    <div className="reports-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Reports</h1>
          <p className="view-sub">Net worth, savings, and property.</p>
        </div>
        <div className="page-actions no-print">
          <button type="button" className="modal-secondary" onClick={onDownloadSetupTemplate}>
            Download setup template…
          </button>
          <button type="button" className="modal-secondary" onClick={onImportSetupData}>
            Import setup data…
          </button>
          <button type="button" className="modal-secondary" onClick={onExportCsv}>
            Export CSV…
          </button>
          <button type="button" className="modal-secondary" onClick={onPrint}>
            Print / Save as PDF…
          </button>
        </div>
      </div>

      <div className="stats">
        <button
          type="button"
          className={
            expandedStat === "totalSaved" ? "stat tint-accent stat-clickable stat-expanded" : "stat tint-accent stat-clickable"
          }
          onClick={() => toggleStat("totalSaved")}
        >
          <span className="stat-value">{formatAmount(report.total_saved)}</span>
          <span className="stat-label">Total saved (all goals)</span>
        </button>
        <button
          type="button"
          className={expandedStat === "income" ? "stat tint-blue stat-clickable stat-expanded" : "stat tint-blue stat-clickable"}
          onClick={() => toggleStat("income")}
        >
          <span className="stat-value">{formatAmount(report.income_total)}</span>
          <span className="stat-label">Income (all-time)</span>
        </button>
        <button
          type="button"
          className={expandedStat === "byTag" ? "stat tint-teal stat-clickable stat-expanded" : "stat tint-teal stat-clickable"}
          onClick={() => toggleStat("byTag")}
        >
          <span className="stat-value">{tagBreakdown.length}</span>
          <span className="stat-label">Tags in use</span>
        </button>
        {familyMembers.length > 0 && (
          <button
            type="button"
            className={
              expandedStat === "byMember" ? "stat tint-purple stat-clickable stat-expanded" : "stat tint-purple stat-clickable"
            }
            onClick={() => toggleStat("byMember")}
          >
            <span className="stat-value">{memberBreakdown.length}</span>
            <span className="stat-label">Members with spending</span>
          </button>
        )}
      </div>

      <StatDetailPanel
        isOpen={expandedStat !== null}
        title={expandedStat ? REPORT_STAT_LABELS[expandedStat] : null}
        rows={expandedStat ? topLevelBreakdowns[expandedStat] : null}
        emptyMessage={
          expandedStat === "totalSaved"
            ? "No savings goals yet."
            : expandedStat === "income"
              ? "No income recorded yet."
              : expandedStat === "byTag"
                ? "No tags used yet — add some from Transactions."
                : "No spending attributed to a family member yet."
        }
        onClose={() => expandedStat && toggleStat(expandedStat)}
      />

      <PropertyAssetsSection
        assets={assets}
        familyMembers={familyMembers}
        onCreate={onCreateAsset}
        onUpdateValue={onUpdateAssetValue}
        onSetMember={onSetAssetMember}
        onDelete={onDeleteAsset}
      />

      <BucketsOverviewSection buckets={buckets} />

      {familyMembers.length > 0 && (
        <div>
          <div className="card-head">
            <h2 className="reports-section-title">Net Worth by Member</h2>
            <PinToDashboardButton widgetId="net_worth_by_member" layoutWidgets={layoutWidgets} onPin={onPinWidget} />
          </div>
          <table className="ledger">
            <thead>
              <tr>
                <th>Member</th>
                <th className="amount-col">Net Worth</th>
              </tr>
            </thead>
            <tbody>
              {netWorthByMemberRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="amount-col">{formatAmount(row.amount)}</td>
                </tr>
              ))}
              {netWorthByMemberRows.length === 0 && (
                <tr>
                  <td colSpan={2} className="empty-state">
                    Nothing to show yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <SavingsRateTrendSection transactions={transactions} accounts={accounts} />

      <div className="card clickable-row" onClick={onOpenBudget} title="Go to the Budget tab">
        <span className="category-link">This month's budget →</span>
      </div>
    </div>
  );
}
