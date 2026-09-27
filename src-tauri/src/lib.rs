mod auto_lock;
mod background;
mod backups;
mod commands;
mod config;
#[cfg(debug_assertions)]
mod debug_commands;
mod device_settings;
mod finnhub;
mod launch_commands;
mod legacy_migration;
mod live_price_provider;
mod live_prices;
mod maintenance;
mod profiles;
mod protection_commands;
mod protection_leftovers;
mod protection_lifecycle;
mod protection_session;
mod protection_transition;
mod runtime;
mod startup;
mod stockdata;
mod system_session;
mod twelve_data;
mod updater;
mod window_state;

use commands::AppStateHandle;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(background::handle_window_event)
        .setup(|app| {
            // Identifier (tauri.conf.json) and this filename were renamed
            // from "com.joeyf.meadow" / "meadow.db" to "com.joeyf.pennywise"
            // / "pennywise.db" alongside the Meadow -> Penny Wise rebrand,
            // again to "com.joeyf.pennyworth" / "pennyworth.db" alongside
            // the Penny Wise -> Penny Worth rebrand, and again to
            // "com.joeyf.vaultspend" / "vaultspend.db" alongside the Penny
            // Worth -> Vault Spend rebrand. Each time, the pre-existing
            // database was copied by hand from the old AppData folder into
            // the new one at rename time — this does not auto-migrate on
            // its own.
            //
            // VAULTSPEND_DB_DIR lets E2E tests (see e2e/) point the app at a
            // throwaway directory instead of the real AppData folder, so
            // automated UI testing never touches the user's real data —
            // this substitutes for the *whole* notion of "default
            // location" (including where config.json lives), not just the
            // final db_path, so a test that relocates/restores never
            // touches the real AppData folder's config.json either. Unset
            // in every normal launch, so real usage is unaffected.
            //
            // The default directory is where config.json lives (the one
            // fixed, discoverable location) even after the user relocates
            // their actual database elsewhere via the Reports tab's
            // Settings section — see startup::open_from_disk.
            //
            // **Debug builds default to a dev-only directory, never the
            // real AppData folder, even without VAULTSPEND_DB_DIR set** —
            // a real incident: `npm run tauri dev` (no env var, ordinary
            // local dev workflow) opened a real relocated production
            // database, because config.json is a single machine-wide file
            // keyed only by app identifier, shared by *any* build unless
            // something overrides it. `cfg!(debug_assertions)` is true for
            // every debug/dev build (including `tauri dev` and `tauri
            // build --debug`) and false for a real release build, so this
            // only changes untested local development, never what ships
            // to an actual user — release builds still resolve to the
            // real AppData folder exactly as before. Explicitly setting
            // VAULTSPEND_DB_DIR (E2E tests do) still wins over this.
            let is_real_installation = std::env::var_os("VAULTSPEND_DB_DIR").is_none() && !cfg!(debug_assertions);
            let default_dir = match std::env::var_os("VAULTSPEND_DB_DIR") {
                Some(dir) => std::path::PathBuf::from(dir),
                None if cfg!(debug_assertions) => std::env::temp_dir().join("vaultspend-dev-data"),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&default_dir)?;
            // Only against a real install's real AppData folder — never a
            // throwaway test/dev directory, which wouldn't have a genuine
            // sibling legacy-identifier folder to find anyway. A failure
            // here must never block launching the app (same "never let
            // this stop the user" treatment as the automatic backup just
            // below): worst case, nothing gets migrated and the app starts
            // exactly as it would have before this existed.
            if is_real_installation {
                if let Err(e) = legacy_migration::migrate_if_needed(&default_dir, config::DB_FILENAME) {
                    eprintln!("legacy install migration failed (continuing anyway): {e}");
                }
            }
            let config_path = default_dir.join("config.json");

            // This computer's settings (tray, start at sign-in, second backup folders) live in a file
            // beside config.json, so a start with no profile open can still decide what the tray and
            // the window do without a database.
            app.manage(device_settings::DeviceSettingsStore::load(default_dir.join(device_settings::DEVICE_SETTINGS_FILENAME)));
            app.manage::<AppStateHandle>(runtime::AppRuntime::no_profile_open());
            app.manage(config::AppPaths {
                config_path: config_path.clone(),
                db_path: Mutex::new(default_dir.join(config::DB_FILENAME)),
                generation: std::sync::atomic::AtomicU64::new(0),
            });
            app.manage(startup::LaunchStatus::new(default_dir.clone()));
            app.manage(protection_session::Sessions::new());
            app.manage(auto_lock::AutoLockController::new());

            if let Err(error) = system_session::install(app.handle()) {
                eprintln!("system session event hook could not be installed: {error}");
            }

            // Restores the window to whatever size (never position — a
            // saved position could sit on a monitor that's no longer
            // connected, leaving the window unreachable) it was last
            // closed at, instead of always reopening at the 800x600
            // default. Written into `default_dir`, the same directory as
            // config.json/the database, so it automatically gets the same
            // debug/E2E isolation the VAULTSPEND_DB_DIR handling above
            // already established — a plugin resolving its own path via
            // `app.path().app_data_dir()` would bypass that and reintroduce
            // the exact real-AppData leak that handling was written to fix.
            window_state::restore_and_track(app.handle(), &default_dir);

            // A profile that can't be opened never aborts the launch: the window shows why, and what the
            // person can do about it (launch_commands.rs). Nothing quietly opens a different file instead.
            // Resolved before anything else opens: an interrupted `enable_protection` (Phase C,
            // Task 5) must either finish or fully unwind before `config.json`'s current db_path is
            // trusted — see `protection_transition::recover_interrupted_operation`'s own doc
            // comment. A journal that cannot even be read is left for the person to see rather than
            // guessed at, the same "never silently open something else" treatment as a damaged
            // profiles.json.
            let handle = app.handle().clone();
            let protection_recovery = protection_transition::recover_interrupted_operation(&config_path)
                .and_then(|()| protection_lifecycle::recover_interrupted_rotation(&config_path))
                .and_then(|()| protection_lifecycle::recover_interrupted_removal(&config_path));
            if let Err(reason) = protection_recovery {
                eprintln!("couldn't recover an interrupted password-protection change: {reason}");
                app.state::<startup::LaunchStatus>().set_error(startup::LaunchError {
                    kind: startup::LaunchErrorKind::ProtectionJournalUnreadable,
                    message: "Vault Spend found an unfinished password-protection change it couldn't safely resolve. Your data files have not been changed.".to_string(),
                    details: reason,
                    db_path: None,
                    can_restore_registry: false,
                    other_profiles: Vec::new(),
                });
                background::sync_tray_with_settings(&handle);
            } else if !(profiles::registry_file_exists(&config_path) && profiles::registered_profiles_strict(&config_path).is_ok()) {
                // No registry at all, OR one that exists but can't even be read: unchanged
                // pre-Phase-C behavior either way — open whatever config.json (or the default
                // location) names directly. `open_from_disk` below already surfaces a damaged
                // registry as its own `RegistryUnreadable` launch error (it calls
                // `registered_profiles_strict` itself), exactly as it always has; that path must
                // keep running for a DAMAGED registry, only a genuinely READABLE one (found by
                // checking here, a real bug caught by Task 9's own e2e suite: checking existence
                // alone also skipped this for a damaged profiles.json, silently losing that error)
                // should skip straight to the selector logic below instead. Once a registry is
                // readable, ANY of its entries could be password protected, which can never be
                // auto-opened without asking first — so nothing here is opened at all; the
                // frontend's very first `get_startup_state` call (now registry-aware, see
                // `launch_commands::current`) shows the selector, a locked profile, or the
                // empty-registry escape instead, and opening only happens once the person actually
                // picks one.
                match startup::open_from_disk(&config_path, &default_dir) {
                    Ok(opened) => startup::activate(&handle, opened),
                    Err(error) => {
                        eprintln!("no profile could be opened at launch: {}", error.message);
                        app.state::<startup::LaunchStatus>().set_error(error);
                        background::sync_tray_with_settings(&handle);
                    }
                }
            } else {
                // A real registry exists and nothing was opened above — still bring the tray up
                // from this computer's settings, the same as every other no-profile-open branch,
                // so it's available while the selector/lock screen is showing.
                background::sync_tray_with_settings(&handle);
            }
            background::start_reminder_thread(handle.clone());
            auto_lock::start_timer_thread(handle.clone());
            background::hide_if_started_minimized(&handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_commands::get_startup_state,
            launch_commands::retry_startup,
            launch_commands::restore_registry_backup,
            launch_commands::open_profile_at_launch,
            launch_commands::locate_data_file,
            launch_commands::quit_app,
            launch_commands::start_with_new_data_file,
            launch_commands::start_with_new_profile_list,
            commands::write_text_file,
            commands::download_update_asset,
            commands::get_data_file_location,
            commands::relocate_data_file,
            commands::export_database,
            commands::list_backups,
            commands::create_backup_now,
            commands::get_backup_copy_dir,
            commands::get_background_settings,
            commands::set_tray_enabled,
            commands::set_autostart_enabled,
            commands::send_test_reminder,
            commands::set_backup_copy_dir,
            commands::restore_backup,
            commands::list_profiles,
            commands::create_profile,
            commands::add_existing_profile,
            commands::switch_profile,
            commands::rename_profile,
            commands::set_profile_icon,
            commands::delete_profile,
            commands::get_profile_ui_state,
            commands::set_profile_ui_state,
            commands::mark_ui_state_migrated,
            commands::is_ui_state_migrated,
            commands::get_current_generation,
            protection_commands::show_profile_selector,
            protection_commands::select_profile,
            protection_commands::unlock_profile,
            protection_commands::lock_current_profile,
            protection_commands::get_auto_lock_settings,
            protection_commands::set_auto_lock_settings,
            auto_lock::record_trusted_activity,
            protection_commands::verify_current_password,
            protection_commands::change_password,
            protection_commands::begin_regenerate_recovery,
            protection_commands::commit_regenerate_recovery,
            protection_commands::remove_protection,
            protection_commands::verify_recovery_code,
            protection_commands::begin_recovery,
            protection_commands::commit_recovery,
            protection_commands::begin_protection_setup,
            protection_commands::cancel_protection_setup,
            protection_commands::commit_protection_setup,
            protection_commands::list_protection_leftovers,
            protection_commands::delete_protection_leftovers,
            commands::preview_setup_import,
            commands::commit_setup_import,
            commands::preview_import,
            commands::commit_import,
            commands::create_manual_transaction,
            commands::list_transactions,
            commands::correct_category,
            commands::bulk_correct_category,
            commands::list_transfer_candidates,
            commands::link_transfer,
            commands::unlink_transfer,
            commands::list_auto_linked_transfers,
            commands::mark_auto_links_reviewed,
            commands::set_auto_link_transfers,
            commands::list_rules,
            commands::preview_rule,
            commands::save_rule,
            commands::delete_rule,
            commands::bulk_delete_transactions,
            commands::bulk_create_recurring_from_transactions,
            commands::get_stats,
            commands::create_account,
            commands::list_accounts,
            commands::set_account_starting_balance,
            commands::set_account_balance_override,
            commands::set_account_interest_rate,
            commands::set_account_excluded_from_debt_payoff,
            commands::update_account_type,
            commands::delete_account,
            commands::set_account_details,
            commands::set_account_member,
            commands::set_account_icon,
            commands::create_family_member,
            commands::list_family_members,
            commands::rename_family_member,
            commands::delete_family_member,
            commands::recategorize_uncategorized,
            commands::list_categories,
            commands::list_categories_with_icons,
            commands::create_category,
            commands::set_category_icon,
            commands::rename_category,
            commands::delete_category,
            commands::update_transaction_amount,
            commands::update_transaction_principal_amount,
            commands::update_transaction_account,
            commands::update_transaction_date,
            commands::update_transaction_description,
            commands::delete_transaction,
            commands::restore_transactions,
            commands::apply_debt_payment,
            commands::unapply_debt_payment,
            commands::get_transaction_splits,
            commands::set_transaction_splits,
            commands::add_tag,
            commands::remove_tag,
            commands::list_all_tags,
            commands::set_transaction_member,
            commands::bulk_set_transaction_member,
            commands::create_bucket,
            commands::list_buckets,
            commands::update_bucket_details,
            commands::set_bucket_member,
            commands::set_bucket_tracks_account,
            commands::add_bucket_contribution,
            commands::delete_bucket,
            commands::set_budget,
            commands::set_budget_cap,
            commands::set_budget_rollover,
            commands::delete_budget,
            commands::get_report,
            commands::budget_actuals_for_month,
            commands::monthly_budget_actuals_by_member,
            commands::budget_actuals_trend,
            commands::suggest_budgets,
            commands::month_review,
            commands::set_month_reviewed,
            commands::list_reviewed_months,
            commands::transactions_for_category,
            commands::budget_alerts_for_month,
            commands::dashboard_insights,
            commands::debt_payoff_projection,
            commands::list_anomaly_flags,
            commands::dismiss_anomaly_flag,
            commands::create_recurring,
            commands::update_recurring,
            commands::set_recurring_member,
            commands::set_recurring_status,
            commands::recurring_totals,
            commands::recurring_matches,
            commands::list_recurring,
            commands::delete_recurring,
            commands::list_recurring_candidates,
            commands::dismiss_recurring_candidate,
            commands::dismiss_recurring_price_change,
            commands::create_holding,
            commands::list_holdings,
            commands::update_holding_price,
            commands::portfolio_history,
            commands::account_balance_history,
            commands::category_spending_by_month,
            commands::daily_spending,
            commands::list_account_transactions,
            commands::reconcile_candidates,
            commands::set_transactions_cleared,
            commands::reconciliation_status,
            commands::finish_reconciliation,
            commands::last_reconciliation,
            commands::investment_accumulation,
            commands::list_investment_accumulation,
            commands::account_value_history,
            commands::set_investment_plan,
            commands::get_inflation_pct,
            commands::list_allocation_targets,
            commands::set_allocation_target,
            commands::delete_holding,
            commands::get_live_price_settings,
            commands::set_live_price_settings,
            commands::get_app_settings,
            commands::set_apply_to_debt_enabled,
            commands::set_split_purchases_enabled,
            commands::set_envelope_caps_enabled,
            commands::set_rollover_enabled,
            commands::fetch_live_quote,
            commands::refresh_live_prices,
            commands::create_asset,
            commands::list_assets,
            commands::update_asset_value,
            commands::set_asset_member,
            commands::delete_asset,
            commands::get_cash_flow,
            commands::cash_flow_for_range,
            commands::category_spending_for_month,
            commands::month_expense_detail,
            commands::year_over_year_cash_flow,
            commands::cash_flow_forecast,
            commands::bill_aware_forecast,
            commands::average_monthly_spend,
            commands::net_worth_history,
            commands::account_contribution_deltas,
            commands::spending_this_month,
            commands::take_maintenance_summary,
            commands::check_sinking_fund_contributions,
            #[cfg(debug_assertions)]
            debug_commands::debug_process_id,
            debug_commands::debug_recovery_code_unlocks,
            #[cfg(debug_assertions)]
            debug_commands::debug_advance_auto_lock,
            #[cfg(debug_assertions)]
            debug_commands::debug_apply_window_lock_trigger,
            #[cfg(debug_assertions)]
            debug_commands::debug_apply_system_session_event,
            #[cfg(debug_assertions)]
            debug_commands::debug_set_main_window_visible,
            #[cfg(debug_assertions)]
            debug_commands::debug_check_reminders,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
