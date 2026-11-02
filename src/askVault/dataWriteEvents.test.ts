import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RELEVANT_WRITE_COMMANDS, notifyDataWrite, onDataWrite } from "./dataWriteEvents";

/** Every other registered command, classified by hand: reads, interface preferences, profile and security, backups, mobile pairing, budgets and other data that cannot change an investment illustration. */
const NOT_RELEVANT: string[] = [
  "account_balance_history", "account_contribution_deltas", "account_value_history", "acknowledge_legal_notice", "add_bucket_contribution",
  "add_existing_profile", "add_tag", "average_monthly_spend", "begin_protection_setup", "begin_recovery", "begin_regenerate_recovery",
  "bill_aware_forecast", "budget_actuals_for_month", "budget_actuals_trend", "budget_alerts_for_month", "bulk_correct_category",
  "bulk_create_recurring_from_transactions", "bulk_set_transaction_member", "cancel_holding_import", "cancel_protection_setup",
  "cancel_statement_review", "cash_flow_for_range", "cash_flow_forecast", "category_spending_by_month", "category_spending_for_month", "change_password",
  "check_sinking_fund_contributions", "commit_protection_setup", "commit_recovery", "commit_regenerate_recovery", "correct_category",
  "count_import_signs", "create_asset", "create_backup_now", "create_bucket", "create_category", "create_family_member", "create_profile",
  "create_recurring", "daily_spending", "dashboard_insights", "debt_payoff_projection", "debug_advance_auto_lock", "debug_apply_system_session_event",
  "debug_apply_window_lock_trigger", "debug_check_reminders", "debug_mobile_authorization_race", "debug_mobile_database_digest", "debug_process_id",
  "debug_quit_app", "debug_recovery_code_unlocks", "debug_retirement_fixture_allowed", "debug_set_main_window_visible", "debug_start_mobile_asset_server", "debug_start_mobile_setup_server",
  "delete_asset", "delete_bucket", "delete_budget", "delete_category", "delete_family_member", "delete_profile", "delete_protection_leftovers",
  "delete_recurring", "delete_rule", "delete_statement_layout", "dismiss_anomaly_flag", "dismiss_recurring_candidate", "dismiss_recurring_price_change",
  "dismiss_transfer_candidates", "export_database", "fetch_latest_release", "fetch_live_quote", "finish_reconciliation",
  "finish_statement_reconciliation", "get_app_settings", "get_transaction_account_move", "get_ask_vault_baselines", "get_ask_vault_retirement_accounts",
  "get_ask_vault_retirement_context", "get_ask_vault_snapshot", "get_auto_lock_settings", "get_background_settings", "get_backup_copy_dir",
  "get_budget_snapshot", "get_cash_flow", "get_comparison_setup", "get_current_generation", "get_dashboard_snapshot", "get_data_file_location",
  "get_financial_comparisons", "get_inflation_pct", "get_legal_notice_acknowledgement", "get_live_price_settings", "get_profile_ui_state", "get_report",
  "get_report_range_snapshot", "get_report_summary_snapshot", "get_startup_state", "get_stats", "get_transaction_context", "get_transaction_snapshot",
  "get_transaction_snapshot_compact", "get_transaction_splits", "inspect_import_columns", "investment_accumulation", "is_ui_state_migrated", "last_reconciliation",
  "list_account_transactions", "list_accounts", "list_all_tags", "list_all_transfer_candidate_pairs", "list_allocation_targets", "list_anomaly_flags",
  "list_assets", "list_auto_linked_transfers", "list_backups", "list_buckets", "list_categories", "list_categories_with_icons", "list_family_members",
  "list_holding_import_files", "list_holdings", "list_investment_accumulation", "list_profiles", "list_protection_leftovers", "list_recurring",
  "list_recurring_candidates", "list_reviewed_months", "list_rules", "list_statement_layouts", "list_transaction_account_moves", "list_transactions", "list_transactions_by_ids",
  "list_transfer_candidates", "load_holding_import", "locate_data_file", "lock_current_profile", "mark_auto_links_reviewed", "mark_ui_state_migrated",
  "mobile_begin_pairing", "mobile_begin_setup", "mobile_cancel_pairing", "mobile_cancel_setup", "mobile_configure", "mobile_configure_guided",
  "mobile_decide_pairing", "mobile_disable", "mobile_export_certificate", "mobile_list_devices", "mobile_network_interfaces", "mobile_pairing_profiles",
  "mobile_pending_pairings", "mobile_public_certificate", "mobile_remove_grant", "mobile_reset_trust", "mobile_revoke_device", "mobile_saved_config",
  "mobile_server_status", "mobile_setup_status", "month_expense_detail", "month_review", "monthly_budget_actuals_by_member", "net_worth_history",
  "open_profile_at_launch", "path_looks_password_protected", "portfolio_history", "preview_holding_import", "preview_import", "preview_rule",
  "preview_setup_import", "preview_transaction_account_move", "quit_app", "read_statement", "recategorize_uncategorized", "reconcile_candidates", "reconcile_status", "recurring_matches",
  "recurring_totals", "relocate_data_file", "remove_protection", "remove_tag", "rename_bucket", "rename_category", "rename_family_member", "rename_profile",
  "rename_statement_layout", "retry_startup", "review_statement", "save_comparison_setup", "save_rule", "select_profile", "send_test_reminder",
  "set_account_excluded_from_debt_payoff", "set_account_hidden", "set_account_icon", "set_account_member", "set_allocation_target", "set_apply_to_debt_enabled",
  "save_report_pdf", "set_asset_member", "set_auto_lock_settings", "set_autostart_enabled", "set_backup_copy_dir", "set_bucket_member", "set_bucket_tracks_account",
  "set_budget", "set_budget_cap", "set_budget_rollover", "set_category_icon", "set_envelope_caps_enabled", "set_live_price_settings",
  "set_month_reviewed", "set_profile_icon", "set_profile_ui_state", "set_recurring_member", "set_recurring_status", "set_rollover_enabled",
  "set_safe_to_spend_enabled", "set_split_purchases_enabled", "set_transaction_member", "set_transaction_splits", "set_transactions_cleared",
  "set_tray_enabled", "show_profile_selector", "spending_this_month", "spending_transactions_for_category", "start_with_new_data_file",
  "start_with_new_profile_list", "statement_lines", "suggest_budgets", "switch_profile", "take_maintenance_summary", "teach_statement_layout",
  "transactions_for_category", "unlock_profile", "update_asset_value", "update_bucket_details", "update_recurring", "update_transaction_notes",
  "verify_current_password", "verify_recovery_code", "write_text_file", "year_over_year_cash_flow",
];

const registered = (): string[] => {
  const source = readFileSync("src-tauri/src/lib.rs", "utf8");
  return [...new Set([...source.slice(source.indexOf("generate_handler")).matchAll(/commands::(?:[a-z_0-9]+::)*([a-z_0-9]+)/g)].map(m => m[1]))];
};
const disposers: (() => void)[] = [];
afterEach(() => { while (disposers.length) disposers.pop()!(); });

describe("M5 write notification: classification", () => {
  it("every registered command is classified as a relevant write or as not relevant", () => {
    const unclassified = registered().filter(name => !RELEVANT_WRITE_COMMANDS.has(name) && !NOT_RELEVANT.includes(name));
    expect(unclassified, "classify new commands in dataWriteEvents.ts or in this test").toEqual([]);
  });
  it("lists no command that does not exist, and no command twice", () => {
    const all = new Set(registered());
    expect([...RELEVANT_WRITE_COMMANDS].filter(name => !all.has(name))).toEqual([]);
    expect(NOT_RELEVANT.filter(name => !all.has(name))).toEqual([]);
    expect(NOT_RELEVANT.filter(name => RELEVANT_WRITE_COMMANDS.has(name))).toEqual([]);
  });
  it.each(["set_investment_plan", "update_holding_price", "refresh_live_prices", "create_holding", "delete_holding", "commit_holding_import", "update_account_type", "set_account_details", "delete_account", "create_manual_transaction", "commit_import"])(
    "%s retires an open illustration", name => expect(RELEVANT_WRITE_COMMANDS.has(name)).toBe(true));
  it.each(["get_inflation_pct", "list_holdings", "get_ask_vault_retirement_context", "investment_accumulation", "set_profile_ui_state"])("%s does not", name => expect(RELEVANT_WRITE_COMMANDS.has(name)).toBe(false));
});

describe("M5 write notification: the bus", () => {
  it("a listener removed stops hearing", () => {
    const seen: string[] = []; const stop = onDataWrite(c => seen.push(c)); notifyDataWrite("set_investment_plan"); stop(); notifyDataWrite("set_investment_plan"); expect(seen).toEqual(["set_investment_plan"]);
  });
  it("a throwing listener cannot break the other listeners", () => {
    const seen: string[] = []; disposers.push(onDataWrite(() => { throw new Error("listener"); })); disposers.push(onDataWrite(c => seen.push(c)));
    expect(() => notifyDataWrite("create_holding")).not.toThrow(); expect(seen).toEqual(["create_holding"]);
  });
});
