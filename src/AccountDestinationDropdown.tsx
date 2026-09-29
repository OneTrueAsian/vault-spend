import { useEffect, useId } from "react";
import type { Account } from "./types";
import { usePopover } from "./usePopover";

export function AccountDestinationDropdown({ accounts, value, disabled, onChange }: {
  accounts: Account[];
  value: number | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover();
  const menuId = useId();
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled, setOpen]);
  useEffect(() => {
    if (open) {
      const panel = rootRef.current;
      (panel?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
        panel?.querySelector<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]'))?.focus();
    }
  }, [open, rootRef]);
  function choose(next: string) {
    setOpen(false);
    triggerRef.current?.focus();
    onChange(next);
  }
  return <div className="account-filter account-destination" ref={rootRef}
    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <button id="ledger-account-select" type="button" ref={triggerRef}
      className="account-filter-toggle" disabled={disabled}
      aria-label={`Add to: ${accounts.find((a) => a.id === value)?.name ?? "No accounts yet"}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }}>
      <span className="account-destination-name">{accounts.find((a) => a.id === value)?.name ?? "No accounts yet"}</span>
      <span className="account-filter-caret" aria-hidden="true">▾</span>
    </button>
    {open && <div id={menuId} className="account-filter-panel account-destination-panel" role="menu" aria-label="Add to account"
      onKeyDown={(e) => {
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 :
          e.key === "ArrowDown" ? (index + 1) % buttons.length : e.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : -1;
        if (next >= 0) { e.preventDefault(); buttons[next]?.focus(); }
      }}>
      {accounts.map((account) => <button key={account.id} type="button" role="menuitemradio"
        aria-checked={account.id === value} className="account-destination-option"
        onClick={() => choose(String(account.id))}>
        <span>{account.name}</span><span aria-hidden="true">{account.id === value ? "✓" : ""}</span>
      </button>)}
      <button type="button" role="menuitem" className="account-destination-option account-destination-new"
        onClick={() => choose("__new__")}>+ New account…</button>
    </div>}
  </div>;
}
