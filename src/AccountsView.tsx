import { RowMenu } from "./RowMenu";
import "./AccountsCards.css";
import { useState } from "react";
import type { Account, AccountContributionDelta, Asset, FamilyMember, NetWorthPoint } from "./types";
import { PropertyAssetsSection } from "./PropertyAssets";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatAmount } from "./format";
import { accountTypeLabel, GROUP_LABELS, GROUP_ORDER, groupOf, isOverdrawn, netWorthContribution } from "./accountGroups";
import { AccountEditDialog } from "./Modal";
import { AccountTypeIcon, ACCOUNT_ICON_OPTIONS, isAccountIconKey, IconPicker, type AccountIconKey } from "./icons";
import { HelpLink } from "./HelpLink";
import type { Tab } from "./appTypes";

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

/** The account types Account details can reconcile against a statement (AccountDetailView). */
function canReconcile(accountType: string): boolean {
  return accountType === "checking" || accountType === "savings";
}

/** Every stat on this page that can be clicked open to show what makes it
 * up — its own state, independent of ReportsView's `ReportStatKey`, so
 * expanding one doesn't affect the other now that they're separate pages. */
type AccountStatKey = "assets" | "liabilities" | "networth";

const ACCOUNT_STAT_LABELS: Record<AccountStatKey, string> = {
  assets: "What you own",
  liabilities: "What you owe",
  networth: "Net worth",
};


function AccountCard({
  account: a,
  editing,
  setEditing,
  onSetStartingBalance,
  onSetBalanceOverride,
  editingIcon,
  setEditingIcon,
  onSetAccountIcon,
  onEdit,
  onOpenDetail,
  onDelete,
}: {
  account: Account;
  editing: EditingBalance | null;
  setEditing: (v: EditingBalance | null) => void;
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onSetBalanceOverride: (accountId: number, balance: string) => void;
  editingIcon: number | null;
  setEditingIcon: (id: number | null) => void;
  onSetAccountIcon: (accountId: number, iconKey: string | null) => void;
  /** Opens the account's Edit dialog (type, member, institution, delete). */
  onEdit: (accountId: number) => void;
  /** Opens the account's own page (balance history, reconcile, transactions); "reconcile" opens it at
   * the reconcile card. */
  onOpenDetail: (accountId: number, focus?: "reconcile") => void;
  /** Opens the account's Edit dialog already asking whether to delete it. */
  onDelete: (accountId: number) => void;
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

  // "Ally ··1177 · Savings · Jordan", as in the UI mockup.
  const detailLine = [
    a.institution ? `${a.institution}${a.mask ? " \u00b7\u00b7" + a.mask : ""}` : null,
    accountTypeLabel(a.account_type),
    a.member_name,
  ]
    .filter(Boolean)
    .join(" \u00b7 ");

  return (
    <div className="account-card" data-account-id={a.id}>
      <span className="icon-toggle-anchor">
        <button
          type="button"
          className={isLiability ? "type-badge type-badge-debt" : group === "investment" ? "type-badge type-badge-investment" : "type-badge"}
          aria-label={`Change icon for ${a.name}`}
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
        <div className="account-name-cell">
          <button type="button" className="account-card-open" data-account-details={a.id} title={`Open details for ${a.name}`} onClick={() => onOpenDetail(a.id)}>{a.name}</button>
        </div>
        <span className="sub account-name-detail-static">{detailLine}</span>
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
          <button
            type="button"
            className={isOverdrawn(a) ? "bal neg amount-editable" : "bal amount-editable"}
            title={isLiability ? "Click to correct the amount currently owed" : "Click to correct today's balance"}
            onClick={() => setEditing({ id: a.id, value: isLiability ? owed : a.current_balance, mode: "balance" })}
          >
            {isLiability ? (
              // One inline run, so the button (a flex box in some styles) keeps "Owed $X" on one line.
              <span>
                <span className="owed-tag">Owed</span> {formatAmount(owed)}
              </span>
            ) : (
              formatAmount(a.current_balance)
            )}
          </button>
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
            <button
              type="button"
              className="sub amount-editable"
              title="Click to set the credit limit"
              onClick={() => setEditing({ id: a.id, value: a.starting_balance, mode: "limit" })}
            >
              {parseFloat(a.starting_balance) > 0 ? `${formatAmount(a.current_balance)} available` : "Set credit limit…"}
            </button>
          ))}
      </div>
      <RowMenu label={`Actions for ${a.name}`} items={[
        { label: "Details", onSelect: () => onOpenDetail(a.id) },
        { label: "Edit…", onSelect: () => onEdit(a.id) },
        canReconcile(a.account_type) && { label: "Reconcile with a statement…", onSelect: () => onOpenDetail(a.id, "reconcile") },
        { label: "Delete…", onSelect: () => onDelete(a.id), danger: true },
      ]} />
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
  onOpenAccountDetail,
  assets,
  onCreateAsset,
  onUpdateAssetValue,
  onSetAssetMember,
  onDeleteAsset,
  onOpenHelp,
}: {
  onOpenAccountDetail: (accountId: number, focus?: "reconcile") => void;
  /** Property & Valuables — manually tracked things that aren't accounts. */
  assets: Asset[];
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
  /** Opens Help at this page's section (the ? beside the title). */
  onOpenHelp?: (tab: Tab) => void;
}) {
  const [editing, setEditing] = useState<EditingBalance | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  // Delete… in a row's menu opens the same Edit dialog, already asking whether to delete.
  const [deletingFromMenu, setDeletingFromMenu] = useState(false);
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

  const manualAssetsRow = manualAssetsTotal !== 0 ? [{ name: "Property and valuables", amount: manualAssetsTotal }] : [];
  // Red only for a balance below zero (s4), not for what's owed on a card or loan.
  const breakdownRow = (a: Account) => ({ name: a.name, amount: netWorthContribution(a), flag: isOverdrawn(a) });
  const accountBreakdowns: Record<AccountStatKey, { name: string; amount: number; flag?: boolean }[]> = {
    assets: [...assetAccounts.map(breakdownRow), ...manualAssetsRow],
    liabilities: liabilityAccounts.map(breakdownRow),
    networth: [...accounts.map(breakdownRow), ...manualAssetsRow],
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
    editingIcon,
    setEditingIcon,
    onSetAccountIcon,
    onEdit: (id: number) => {
      setDeletingFromMenu(false);
      setEditingAccountId(id);
    },
    onDelete: (id: number) => {
      setDeletingFromMenu(true);
      setEditingAccountId(id);
    },
    onOpenDetail: onOpenAccountDetail,
  };
  const accountCount = `${accounts.length} account${accounts.length === 1 ? "" : "s"}`;
  const pageSub =
    accounts.length === 0 && assets.length === 0
      ? "Every account, grouped by cash, credit, loans, and investments."
      : assets.length === 0
        ? accountCount
        : `${accountCount} and ${assets.length} thing${assets.length === 1 ? "" : "s"} you own`;
  const accountBeingEdited = accounts.find((a) => a.id === editingAccountId) ?? null;

  return (
    <div className="reports-view">
      <div className="page-top">
        <div>
          <div className="view-title-row">
            <h1 className="view-title">Accounts</h1>
            {onOpenHelp && <HelpLink tab="accounts" onOpen={onOpenHelp} />}
          </div>
          <p className="view-sub">{pageSub}</p>
        </div>
        <div className="page-actions">
          <button type="button" onClick={onAddAccount}>
            + Add account
          </button>
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <button
          type="button"
          className={
            expandedStat === "assets" ? "stat tint-accent stat-clickable stat-expanded" : "stat tint-accent stat-clickable"
          }
          onClick={() => toggleStat("assets")}
        >
          <span className="stat-label">What you own</span>
          <span className="stat-value">{formatAmount(assetsTotal)}</span>
        </button>
        <button
          type="button"
          className={
            expandedStat === "liabilities" ? "stat tint-neutral stat-clickable stat-expanded" : "stat tint-neutral stat-clickable"
          }
          onClick={() => toggleStat("liabilities")}
        >
          <span className="stat-label">What you owe</span>
          {/* The amount owed, as on each row (an overpaid card makes it negative). */}
          <span className="stat-value">{formatAmount(-liabilities)}</span>
        </button>
        <button
          type="button"
          className={
            expandedStat === "networth" ? "stat tint-blue stat-clickable stat-expanded" : "stat tint-blue stat-clickable"
          }
          onClick={() => toggleStat("networth")}
        >
          <span className="stat-label">Net worth</span>
          <span className="stat-value">{formatAmount(netWorth)}</span>
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

      {/* One card per group, as in the UI mockup: its name and total on top, then one row per account,
          the biggest balance first. A card or loan group's total is the amount owed. */}
      {GROUP_ORDER.map((group) => {
        const groupAccounts = accounts
          .filter((a) => groupOf(a.account_type) === group)
          .sort((a, b) => Math.abs(netWorthContribution(b)) - Math.abs(netWorthContribution(a)) || a.name.localeCompare(b.name));
        if (groupAccounts.length === 0) return null;
        const subtotal = groupAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
        const owedGroup = group === "credit" || group === "loan";
        return (
          <section key={group} className="account-group">
            <div className="account-group-head">
              <h2>{GROUP_LABELS[group]}</h2>
              <span className="account-group-total">{owedGroup ? `${formatAmount(-subtotal)} owed` : formatAmount(subtotal)}</span>
            </div>
            <div className="account-cards">
              {groupAccounts.map((a) => (
                <AccountCard key={a.id} account={a} {...rowProps} />
              ))}
            </div>
          </section>
        );
      })}
      {accounts.length === 0 && <p className="empty-state">No accounts yet.</p>}

      <PropertyAssetsSection
        assets={assets}
        familyMembers={familyMembers}
        onCreate={onCreateAsset}
        onUpdateValue={onUpdateAssetValue}
        onSetMember={onSetAssetMember}
        onDelete={onDeleteAsset}
      />

      {accountBeingEdited && (
        <AccountEditDialog
          account={accountBeingEdited}
          familyMembers={familyMembers}
          startWithDeleteConfirm={deletingFromMenu}
          onCancel={() => setEditingAccountId(null)}
          onSave={async (changes) => {
            const id = accountBeingEdited.id;
            setEditingAccountId(null);
            // One at a time: each handler saves and then reloads everything,
            // and overlapping reloads could land out of order and show the
            // older state.
            if (changes.accountType !== undefined) await onUpdateAccountType(id, changes.accountType);
            if (changes.memberId !== undefined) await onSetAccountMember(id, changes.memberId);
            if (changes.institution !== undefined || changes.mask !== undefined) {
              await onSetAccountDetails(id, changes.institution ?? null, changes.mask ?? null);
            }
          }}
          onDelete={() => {
            const id = accountBeingEdited.id;
            setEditingAccountId(null);
            onDeleteAccount(id);
          }}
        />
      )}
    </div>
  );
}
