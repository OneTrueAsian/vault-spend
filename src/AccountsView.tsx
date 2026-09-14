import { useState } from "react";
import type { Account, AccountContributionDelta, FamilyMember, NetWorthPoint } from "./types";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatAmount } from "./format";
import { GROUP_LABELS, GROUP_ORDER, groupOf, netWorthContribution } from "./accountGroups";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { AccountTypeIcon, ACCOUNT_ICON_OPTIONS, isAccountIconKey, IconPicker, type AccountIconKey } from "./icons";

const ACCOUNT_TYPE_OPTIONS = ["checking", "savings", "credit", "loan", "investment", "other"];

/** Lets a user override the type-guessed icon (`icons/accountIcons.tsx`)
 * with an explicit choice — floats below the type badge that opens it
 * rather than pushing the rest of the card down, since a grid of account
 * cards would otherwise reflow every neighbor open at once. */
function AccountIconPicker({
  accountType,
  value,
  onChange,
}: {
  accountType: string;
  value: AccountIconKey | null;
  onChange: (key: AccountIconKey) => void;
}) {
  return (
    <div className="icon-picker-popover">
      <IconPicker
        options={ACCOUNT_ICON_OPTIONS}
        value={value}
        onChange={onChange}
        renderIcon={(key) => <AccountTypeIcon accountType={accountType} iconKey={key} />}
      />
    </div>
  );
}

/** The one balance-ish field currently being edited inline, across every
 * card (only one at a time). `mode` only matters for a credit account,
 * which has two independently editable numbers — "balance" is the Owed
 * figure (corrected via `Store::set_account_balance_override`), "limit"
 * is the credit limit itself (`starting_balance`, unchanged since it has
 * no reset-based equivalent). Every other account type only ever uses
 * "balance". */
type EditingBalance = { id: number; value: string; mode: "balance" | "limit" };

/** Every stat on this page that can be clicked open to show what makes it
 * up — its own state, independent of ReportsView's `ReportStatKey`, so
 * expanding one doesn't affect the other now that they're separate pages. */
type AccountStatKey = "assets" | "liabilities" | "networth";

const ACCOUNT_STAT_LABELS: Record<AccountStatKey, string> = {
  assets: "Total Assets",
  liabilities: "Total Liabilities",
  networth: "Net Worth",
};


function AccountCard({
  account: a,
  editing,
  setEditing,
  onSetStartingBalance,
  onSetBalanceOverride,
  onUpdateAccountType,
  editingDetails,
  setEditingDetails,
  onSetAccountDetails,
  familyMembers,
  onSetAccountMember,
  editingIcon,
  setEditingIcon,
  onSetAccountIcon,
  confirmingDeleteId,
  setConfirmingDeleteId,
  onDeleteAccount,
}: {
  account: Account;
  editing: EditingBalance | null;
  setEditing: (v: EditingBalance | null) => void;
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onSetBalanceOverride: (accountId: number, balance: string) => void;
  onUpdateAccountType: (accountId: number, accountType: string) => void;
  editingDetails: { id: number; institution: string; mask: string } | null;
  setEditingDetails: (v: { id: number; institution: string; mask: string } | null) => void;
  onSetAccountDetails: (accountId: number, institution: string | null, mask: string | null) => void;
  familyMembers: FamilyMember[];
  onSetAccountMember: (accountId: number, memberId: number | null) => void;
  editingIcon: number | null;
  setEditingIcon: (id: number | null) => void;
  onSetAccountIcon: (accountId: number, iconKey: string | null) => void;
  confirmingDeleteId: number | null;
  setConfirmingDeleteId: (id: number | null) => void;
  onDeleteAccount: (accountId: number) => void;
}) {
  const group = groupOf(a.account_type);
  const isCredit = group === "credit";
  const isLoan = group === "loan";
  const isLiability = isCredit || isLoan;
  const owed = isLoan
    ? a.current_balance
    : (parseFloat(a.starting_balance) - parseFloat(a.current_balance)).toFixed(2);

  function commitEdit(id: number, value: string) {
    const mode = editing?.mode;
    setEditing(null);
    if (!value.trim()) return;
    // A credit card's limit is a genuinely separate value from its balance
    // — editing it means changing `starting_balance` itself. Everything
    // else "correcting the balance" means fixing what's true *today*,
    // which needs a dated checkpoint (see Store::set_account_balance_override)
    // instead of rewriting the account's original baseline — otherwise a
    // correction here would retroactively shift every past "balance as of"
    // lookup (sparklines, trends, net worth history) that predates it.
    if (isCredit && mode === "limit") {
      onSetStartingBalance(id, value.trim());
      return;
    }
    if (isCredit) {
      // What's shown and edited here is "owed," but a credit account's own
      // balance actually tracks *available* credit (owed = limit -
      // available) — solve for the available value that makes owed equal
      // what was typed, and correct that instead of "owed" directly.
      const typedOwed = parseFloat(value.trim());
      if (Number.isNaN(typedOwed)) return;
      const available = parseFloat(a.starting_balance) - typedOwed;
      onSetBalanceOverride(id, available.toFixed(2));
      return;
    }
    onSetBalanceOverride(id, value.trim());
  }

  function commitDetails(id: number) {
    if (!editingDetails) return;
    onSetAccountDetails(id, editingDetails.institution.trim() || null, editingDetails.mask.trim() || null);
    setEditingDetails(null);
  }

  return (
    <div className="account-card">
      <span className="icon-toggle-anchor">
        <button
          type="button"
          className={isLiability ? "type-badge type-badge-neg" : "type-badge"}
          title="Click to change this account's icon"
          onClick={() => setEditingIcon(editingIcon === a.id ? null : a.id)}
        >
          <AccountTypeIcon accountType={a.account_type} iconKey={a.icon_key} />
        </button>
        {editingIcon === a.id && (
          <AccountIconPicker
            accountType={a.account_type}
            value={a.icon_key && isAccountIconKey(a.icon_key) ? a.icon_key : null}
            onChange={(key) => {
              onSetAccountIcon(a.id, key);
              setEditingIcon(null);
            }}
          />
        )}
      </span>
      <div className="info">
        <div className="account-name-cell">{a.name}</div>
        {editingDetails?.id === a.id ? (
          <div className="account-details-edit">
            <input
              autoFocus
              placeholder="Institution"
              value={editingDetails.institution}
              onChange={(e) => setEditingDetails({ ...editingDetails, institution: e.target.value })}
            />
            <input
              placeholder="1234"
              maxLength={4}
              value={editingDetails.mask}
              onChange={(e) => setEditingDetails({ ...editingDetails, mask: e.target.value })}
            />
            <button type="button" onClick={() => commitDetails(a.id)}>
              Save
            </button>
          </div>
        ) : (
          <span
            className="sub account-name-detail"
            title="Click to set institution / account number"
            onClick={() => setEditingDetails({ id: a.id, institution: a.institution ?? "", mask: a.mask ?? "" })}
          >
            {a.institution ? `${a.institution}${a.mask ? " •••• " + a.mask : ""}` : "Add institution…"}
          </span>
        )}
        <div className="account-card-row">
          <select
            aria-label={`Account type for ${a.name}`}
            value={a.account_type}
            onChange={(e) => onUpdateAccountType(a.id, e.target.value)}
          >
            {ACCOUNT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
          <select
            aria-label={`Family member for ${a.name}`}
            className="member-select"
            value={a.member_id ?? ""}
            onChange={(e) => onSetAccountMember(a.id, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Unassigned</option>
            {familyMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="account-card-end">
        {editing?.id === a.id && editing.mode === "balance" ? (
          <>
            <input
              autoFocus
              className="amount-edit-input"
              value={editing.value}
              onChange={(e) => setEditing({ id: a.id, value: e.target.value, mode: "balance" })}
              onBlur={() => commitEdit(a.id, editing.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit(a.id, editing.value);
                if (e.key === "Escape") setEditing(null);
              }}
            />
            <span className="field-hint">
              {isLiability
                ? "Sets what's owed to exactly this amount — new transactions still change it from here."
                : "Sets the balance to exactly this amount — new transactions still change it from here."}
            </span>
          </>
        ) : (
          <span
            className={isLiability ? "bal neg amount-editable" : "bal amount-editable"}
            title={isLiability ? "Click to correct the amount currently owed" : "Click to correct today's balance"}
            onClick={() => setEditing({ id: a.id, value: isLiability ? owed : a.current_balance, mode: "balance" })}
          >
            {isLiability ? `Owed ${formatAmount(owed)}` : formatAmount(a.current_balance)}
          </span>
        )}
        {isCredit &&
          (editing?.id === a.id && editing.mode === "limit" ? (
            <input
              autoFocus
              className="amount-edit-input"
              value={editing.value}
              onChange={(e) => setEditing({ id: a.id, value: e.target.value, mode: "limit" })}
              onBlur={() => commitEdit(a.id, editing.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit(a.id, editing.value);
                if (e.key === "Escape") setEditing(null);
              }}
            />
          ) : (
            <span
              className="sub amount-editable"
              title="Click to set the credit limit"
              onClick={() => setEditing({ id: a.id, value: a.starting_balance, mode: "limit" })}
            >
              Available {formatAmount(a.current_balance)}
            </span>
          ))}
        {confirmingDeleteId === a.id ? (
          <span className="row-delete-confirm">
            <button type="button" className="modal-secondary btn-sm" onClick={() => setConfirmingDeleteId(null)}>
              Cancel
            </button>
            <button type="button" className="btn-sm btn-danger" onClick={() => onDeleteAccount(a.id)}>
              Delete
            </button>
          </span>
        ) : (
          <button type="button" className="modal-secondary btn-sm" onClick={() => setConfirmingDeleteId(a.id)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function AccountsView({
  accounts,
  manualAssetsTotal,
  netWorthHistory,
  accountContributionDeltas,
  onSetStartingBalance,
  onSetBalanceOverride,
  onUpdateAccountType,
  onDeleteAccount,
  onSetAccountDetails,
  familyMembers,
  onSetAccountMember,
  onSetAccountIcon,
  onAddAccount,
}: {
  accounts: Account[];
  /** Sum of manually-tracked assets (Property & Valuables, from Reports) —
   * folded into the Total Assets / Net Worth stats here alongside real
   * accounts, same as before the two pages split apart. */
  manualAssetsTotal: number;
  /** Same trailing-months series and per-account deltas the Dashboard's
   * stat cards use for their own "what changed" section — fetched once in
   * App.tsx for the Dashboard, reused here rather than a second backend
   * call, since the underlying data is identical either way. */
  netWorthHistory: NetWorthPoint[];
  accountContributionDeltas: AccountContributionDelta[];
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onSetBalanceOverride: (accountId: number, balance: string) => void;
  onUpdateAccountType: (accountId: number, accountType: string) => void;
  onDeleteAccount: (accountId: number) => void;
  onSetAccountDetails: (accountId: number, institution: string | null, mask: string | null) => void;
  familyMembers: FamilyMember[];
  onSetAccountMember: (accountId: number, memberId: number | null) => void;
  onSetAccountIcon: (accountId: number, iconKey: string | null) => void;
  onAddAccount: () => void;
}) {
  const [editing, setEditing] = useState<EditingBalance | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [editingDetails, setEditingDetails] = useState<{ id: number; institution: string; mask: string } | null>(
    null,
  );
  const [editingIcon, setEditingIcon] = useState<number | null>(null);
  const [expandedStat, setExpandedStat] = useState<AccountStatKey | null>(null);

  function toggleStat(key: AccountStatKey) {
    setExpandedStat((prev) => (prev === key ? null : key));
  }

  const assetAccounts = accounts.filter((a) => groupOf(a.account_type) !== "credit" && groupOf(a.account_type) !== "loan");
  const liabilityAccounts = accounts.filter((a) => groupOf(a.account_type) === "credit" || groupOf(a.account_type) === "loan");
  const assetsTotal = assetAccounts.reduce((s, a) => s + netWorthContribution(a), 0) + manualAssetsTotal;
  const liabilities = liabilityAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const netWorth = assetsTotal + liabilities;

  const manualAssetsRow = manualAssetsTotal !== 0 ? [{ name: "Property & Valuables", amount: manualAssetsTotal }] : [];
  const accountBreakdowns: Record<AccountStatKey, { name: string; amount: number }[]> = {
    assets: [...assetAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })), ...manualAssetsRow],
    liabilities: liabilityAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    networth: [...accounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })), ...manualAssetsRow],
  };

  // "What changed" rows for each stat's own detail panel — same
  // computation as the Dashboard's stat cards (see DashboardView.tsx),
  // just regrouped onto this page's assets/liabilities/net-worth split
  // instead of Dashboard's cash/debt/investments one. `sign` flips
  // liabilities to a plain "amount owed" magnitude, same reasoning as
  // Dashboard's debt tile: a growing loan balance should read as a
  // positive change (bad), not the negative net-worth-contribution delta
  // it actually is.
  const toChangeRows = (deltas: AccountContributionDelta[], sign = 1) =>
    deltas
      .map((d) => ({ name: d.name, delta: sign * parseFloat(d.delta) }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);
  const changeBreakdowns: Record<AccountStatKey, { name: string; delta: number }[]> = {
    assets: toChangeRows(accountContributionDeltas.filter((d) => d.group !== "credit" && d.group !== "loan")),
    liabilities: toChangeRows(
      accountContributionDeltas.filter((d) => d.group === "credit" || d.group === "loan"),
      -1,
    ),
    networth: toChangeRows(accountContributionDeltas),
  };
  const changeGoodDirection: Record<AccountStatKey, "up" | "down"> = {
    assets: "up",
    liabilities: "down",
    networth: "up",
  };
  const monthsSpan = netWorthHistory.length;

  const rowProps = {
    editing,
    setEditing,
    onSetStartingBalance,
    onSetBalanceOverride,
    onUpdateAccountType,
    editingDetails,
    setEditingDetails,
    onSetAccountDetails,
    familyMembers,
    onSetAccountMember,
    editingIcon,
    setEditingIcon,
    onSetAccountIcon,
    confirmingDeleteId,
    setConfirmingDeleteId,
    onDeleteAccount,
  };

  return (
    <div className="reports-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Accounts</h1>
          <p className="view-sub">Every account, grouped by cash, credit, loans, and investments.</p>
        </div>
        <div className="page-actions">
          <button type="button" onClick={onAddAccount}>
            Add account…
          </button>
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <button
          type="button"
          className={
            expandedStat === "assets" ? "stat tint-accent stat-clickable stat-expanded" : "stat tint-accent stat-clickable"
          }
          onClick={() => toggleStat("assets")}
        >
          <span className="stat-value">{formatAmount(assetsTotal)}</span>
          <span className="stat-label">Total Assets</span>
        </button>
        <button
          type="button"
          className={
            expandedStat === "liabilities" ? "stat tint-red stat-clickable stat-expanded" : "stat tint-red stat-clickable"
          }
          onClick={() => toggleStat("liabilities")}
        >
          <span className="stat-value">{formatAmount(liabilities)}</span>
          <span className="stat-label">Total Liabilities</span>
        </button>
        <button
          type="button"
          className={
            expandedStat === "networth" ? "stat tint-blue stat-clickable stat-expanded" : "stat tint-blue stat-clickable"
          }
          onClick={() => toggleStat("networth")}
        >
          <span className="stat-value">{formatAmount(netWorth)}</span>
          <span className="stat-label">Net Worth</span>
        </button>
      </div>

      <StatDetailPanel
        isOpen={expandedStat !== null}
        title={expandedStat ? ACCOUNT_STAT_LABELS[expandedStat] : null}
        rows={expandedStat ? accountBreakdowns[expandedStat] : null}
        changeRows={expandedStat ? changeBreakdowns[expandedStat] : null}
        changeLabel={monthsSpan > 1 ? `over ${monthsSpan}mo` : undefined}
        changeGoodDirection={expandedStat ? changeGoodDirection[expandedStat] : "up"}
        emptyMessage="No accounts contribute to this yet."
        onClose={() => expandedStat && toggleStat(expandedStat)}
      />

      {GROUP_ORDER.map((group) => {
        const groupAccounts = accounts.filter((a) => groupOf(a.account_type) === group);
        if (groupAccounts.length === 0) return null;
        const subtotal = groupAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
        return (
          <div key={group}>
            <h2 className="account-group-title">
              {GROUP_LABELS[group]} <span className="account-col">{formatAmount(subtotal)}</span>
            </h2>
            <div className="account-cards">
              {groupAccounts.map((a) => (
                <AccountCard key={a.id} account={a} {...rowProps} />
              ))}
            </div>
          </div>
        );
      })}
      {accounts.length === 0 && <p className="empty-state">No accounts yet.</p>}
    </div>
  );
}
