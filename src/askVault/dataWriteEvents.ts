/**
 * Notification of successful in-app writes that can change an open retirement illustration (M5 owner decision 2a).
 * The native data revision already exposes every write, but only when something reads it; this bus retires an open
 * review or result the moment such a write succeeds. It carries the command name only: no arguments, no results.
 * src/tauriInvoke.ts raises it after a successful call; the build aliases "@tauri-apps/api/core" to that file.
 */
export const RELEVANT_WRITE_COMMANDS: ReadonlySet<string> = new Set([
  // Investment plans, holdings, prices (the shared inflation setting is saved with the plan).
  "set_investment_plan", "create_holding", "update_holding_price", "delete_holding", "commit_holding_import", "refresh_live_prices",
  // Accounts: renamed, retyped, deleted, opening values.
  "create_account", "delete_account", "update_account_type", "set_account_details", "set_account_starting_balance", "set_account_balance_override", "set_account_interest_rate",
  // Transactions and transfers on any account. A principal amount counts instead of the full amount in an investment account's value when it holds no holdings (core ask_vault_retirement.rs).
  "create_manual_transaction", "delete_transaction", "bulk_delete_transactions", "restore_transactions", "flip_transaction_signs",
  "update_transaction_account", "update_transaction_amount", "update_transaction_principal_amount", "update_transaction_date", "update_transaction_description",
  "unapply_debt_payment", "apply_debt_payment", "commit_import", "commit_setup_import", "link_transfer", "unlink_transfer", "restore_transfer_candidates", "set_auto_link_transfers",
  // Whole-profile replacement.
  "restore_backup", "restore_registry_backup",
]);

type Listener = (command: string) => void;
const listeners = new Set<Listener>();

/** Hear every relevant write until the returned function is called. */
export function onDataWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyDataWrite(command: string): void {
  for (const listener of [...listeners]) {
    try { listener(command); } catch { /* one listener cannot break a write or another listener */ }
  }
}
