import type { Account } from "./types";
import { GROUP_LABELS, GROUP_ORDER, groupOf } from "./accountGroups";
import { usePopover } from "./usePopover";

/** `"all"` means no filter is applied (every account shown) — kept as a
 * distinct sentinel rather than always expanding it to a concrete set of
 * every account id, so the filter doesn't need updating every time an
 * account is added or removed. */
export type AccountFilterValue = Set<number> | "all";

function isSelected(value: AccountFilterValue, accountId: number): boolean {
  return value === "all" || value.has(accountId);
}

/** A button that opens a checkbox list of every account, grouped the same
 * way the Reports tab groups them (Cash / Credit Cards / Loans /
 * Investments / Other Assets) — lets the user filter the Transactions tab down to
 * several accounts at once instead of picking exactly one. */
export function AccountFilterDropdown({
  accounts,
  value,
  onChange,
}: {
  accounts: Account[];
  value: AccountFilterValue;
  onChange: (next: AccountFilterValue) => void;
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover();

  function toggleAccount(accountId: number) {
    const next = new Set(value === "all" ? accounts.map((a) => a.id) : value);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    // Collapse back to the "all" sentinel once every account ends up
    // checked again, so the button label reads "All accounts" rather than
    // a redundant "N accounts" where N happens to equal the total.
    onChange(next.size === accounts.length ? "all" : next);
  }

  function toggleGroup(groupAccounts: Account[], everyChecked: boolean) {
    const next = new Set(value === "all" ? accounts.map((a) => a.id) : value);
    for (const a of groupAccounts) {
      if (everyChecked) next.delete(a.id);
      else next.add(a.id);
    }
    onChange(next.size === accounts.length ? "all" : next);
  }

  const selectedCount = value === "all" ? accounts.length : value.size;
  const label =
    value === "all" || selectedCount === accounts.length
      ? "All accounts"
      : selectedCount === 0
        ? "No accounts"
        : selectedCount === 1
          ? (accounts.find((a) => isSelected(value, a.id))?.name ?? "1 account")
          : `${selectedCount} accounts`;

  return (
    <div className="account-filter" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-filter-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {label}
        <span className="account-filter-caret">▾</span>
      </button>
      {open && (
        <div className="account-filter-panel">
          <div className="account-filter-panel-actions">
            <button type="button" className="modal-secondary" onClick={() => onChange("all")}>
              Select all
            </button>
            <button type="button" className="modal-secondary" onClick={() => onChange(new Set())}>
              Clear all
            </button>
          </div>
          {GROUP_ORDER.map((group) => {
            const groupAccounts = accounts.filter((a) => groupOf(a.account_type) === group);
            if (groupAccounts.length === 0) return null;
            const everyChecked = groupAccounts.every((a) => isSelected(value, a.id));
            const noneChecked = groupAccounts.every((a) => !isSelected(value, a.id));
            return (
              <div key={group} className="account-filter-group">
                <label className="account-filter-group-label">
                  <input
                    type="checkbox"
                    checked={everyChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = !everyChecked && !noneChecked;
                    }}
                    onChange={() => toggleGroup(groupAccounts, everyChecked)}
                  />
                  {GROUP_LABELS[group]}
                </label>
                {groupAccounts.map((a) => (
                  <label key={a.id} className="account-filter-option">
                    <input type="checkbox" checked={isSelected(value, a.id)} onChange={() => toggleAccount(a.id)} />
                    {a.name}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
