// Task O/R guard: every command the app calls that writes data must have a recorded freshness
// decision. A new write fails this test until someone says which views it can make stale and how
// they find out, instead of the decision being skipped by accident.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { financialMutations } from "./applicationContracts";

const sourceDir = new URL("./", import.meta.url);
const sources = readdirSync(sourceDir)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name))
  .map((name) => readFileSync(new URL(name, sourceDir), "utf8"));

const callPattern = /\b(?:invoke|invokeProfile|callTransaction|call|rawTransactionCall)(?:<[^>(]*>)?\(\s*["']([a-z_0-9]+)["']/g;
const writeVerb =
  /^(create|update|delete|set|add|commit|dismiss|rename|apply|unapply|link|unlink|import|restore|flip|save|merge|split|categorize|mark|reset|undo|remove|toggle|bulk|accept|reject|finish|refresh|relocate|move)_/;
const calledWrites = new Set(
  sources.flatMap((text) => [...text.matchAll(callPattern)].map((match) => match[1])).filter((name) => writeVerb.test(name)),
);

/** Writes to transactions, accounts and their settings: the caller refreshes the shared snapshot
 *  (or the command's own review list), and that publishes a new revision to every active view. */
const refreshesSharedSnapshot = new Set([
  "add_tag", "remove_tag", "apply_debt_payment", "unapply_debt_payment", "bulk_correct_category",
  "bulk_create_recurring_from_transactions", "bulk_delete_transactions", "bulk_set_transaction_member",
  "commit_import", "commit_holding_import", "create_account", "delete_account", "create_manual_transaction",
  "delete_transaction", "flip_transaction_signs", "move_transactions_to_account", "link_transfer", "unlink_transfer", "restore_transactions",
  "set_transaction_member", "set_transaction_splits", "update_transaction_account", "update_transaction_amount",
  "update_transaction_date", "update_transaction_description", "update_transaction_notes",
  "update_transaction_principal_amount", "set_account_balance_override", "set_account_details",
  "set_account_excluded_from_debt_payoff", "set_account_icon", "set_account_interest_rate",
  "set_account_starting_balance", "update_account_type", "set_auto_link_transfers", "save_rule", "delete_rule",
  "dismiss_anomaly_flag", "dismiss_transfer_candidates", "restore_transfer_candidates", "mark_auto_links_reviewed",
  "finish_reconciliation", "finish_statement_reconciliation", "set_transactions_cleared",
]);
/** Writes that only change how a screen is offered or a reminder is remembered. Nothing computed
 *  from the financial data reads them. */
const presentationOnly = new Set([
  "set_apply_to_debt_enabled", "set_split_purchases_enabled", "set_month_reviewed", "set_investment_plan",
  "set_profile_ui_state", "mark_ui_state_migrated", "set_profile_icon", "set_tray_enabled", "set_autostart_enabled",
  "set_auto_lock_settings", "set_backup_copy_dir", "create_backup_now",
  // The banks whose statements the app has learned to read: only Settings and the next statement upload read them.
  "rename_statement_layout", "delete_statement_layout",
  // Reports > Save as PDF writes a file outside the profile; no screen reads it back.
  "save_report_pdf",
]);
/** Profile, protection and file-location changes replace or remount the whole profile, so every view
 *  starts from a new session instead of being told to refresh. */
const remountsProfile = new Set([
  "add_existing_profile", "create_profile", "rename_profile", "delete_profile", "commit_protection_setup",
  "commit_recovery", "commit_regenerate_recovery", "delete_protection_leftovers", "remove_protection",
  "relocate_data_file", "restore_backup", "restore_registry_backup",
]);

describe("write commands and view freshness", () => {
  it("gives every write command the app calls exactly one recorded freshness decision", () => {
    const groups = { financialMutations, refreshesSharedSnapshot, presentationOnly, remountsProfile };
    const unclassified = [...calledWrites].filter((name) => !Object.values(groups).some((group) => group.has(name)));
    expect(unclassified.sort()).toEqual([]);
    const doubled = [...calledWrites].filter((name) => Object.values(groups).filter((group) => group.has(name)).length > 1);
    expect(doubled.sort()).toEqual([]);
  });

  it("records no write command the app no longer calls or the backend no longer has", () => {
    const rust = readdirSync(new URL("../src-tauri/src/", import.meta.url), { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".rs"))
      .map((name) => readFileSync(new URL(`../src-tauri/src/${name}`, import.meta.url), "utf8"))
      .join("\n");
    const backend = new Set([...rust.matchAll(/#\[tauri::command\][\s\S]*?\bfn\s+([a-z_0-9]+)/g)].map((match) => match[1]));
    const recorded = [...financialMutations, ...refreshesSharedSnapshot, ...presentationOnly, ...remountsProfile];
    expect(recorded.filter((name) => !backend.has(name)).sort()).toEqual([]);
    expect([...financialMutations].filter((name) => !calledWrites.has(name)).sort()).toEqual([]);
  });
});
