use super::*;

#[test]
fn live_price_settings_default_when_never_set() {
    let store = Store::open_in_memory().unwrap();

    let settings = store.get_live_price_settings().unwrap();

    assert_eq!(settings.api_key, None);
    assert_eq!(settings.provider, "alpha_vantage");
    assert_eq!(settings.last_refreshed_at, None);
}

#[test]
fn set_live_price_settings_then_get_returns_provider_and_key_matrix() {
    let cases = [("alpha_vantage", "demo-key"), ("finnhub", "fh-key")];

    for (provider, api_key) in cases {
        let store = Store::open_in_memory().unwrap();

        store.set_live_price_settings(provider, Some(api_key)).unwrap();

        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(settings.provider, provider, "case: {provider}");
        assert_eq!(settings.api_key, Some(api_key.to_string()), "case: {provider}");
    }
}

#[test]
fn set_live_price_settings_none_key_clears_it_but_keeps_the_provider() {
    let store = Store::open_in_memory().unwrap();
    store.set_live_price_settings("finnhub", Some("fh-key")).unwrap();

    store.set_live_price_settings("finnhub", None).unwrap();

    let settings = store.get_live_price_settings().unwrap();
    assert_eq!(settings.api_key, None);
    assert_eq!(settings.provider, "finnhub", "disabling should still remember the last-used provider");
}

#[test]
fn set_live_prices_last_refreshed_persists_timestamp() {
    let store = Store::open_in_memory().unwrap();
    let at = NaiveDateTime::parse_from_str("2026-08-30 14:05:00", "%Y-%m-%d %H:%M:%S").unwrap();

    store.set_live_prices_last_refreshed(at).unwrap();

    let settings = store.get_live_price_settings().unwrap();
    assert_eq!(settings.last_refreshed_at, Some(at));
}

#[test]
fn app_settings_default_to_every_feature_enabled_before_anything_is_ever_set() {
    let store = Store::open_in_memory().unwrap();

    let settings = store.get_app_settings().unwrap();

    assert!(settings.apply_to_debt_enabled);
    assert!(settings.split_purchases_enabled);
    assert!(settings.envelope_caps_enabled);
}

#[test]
fn setting_one_app_feature_flag_does_not_disturb_the_others() {
    let store = Store::open_in_memory().unwrap();

    store.set_split_purchases_enabled(false).unwrap();

    let settings = store.get_app_settings().unwrap();
    assert!(!settings.split_purchases_enabled);
    assert!(settings.apply_to_debt_enabled, "unrelated flags must keep their default");
    assert!(settings.envelope_caps_enabled, "unrelated flags must keep their default");
}

#[test]
fn app_settings_flags_persist_across_repeated_toggles() {
    let store = Store::open_in_memory().unwrap();

    store.set_apply_to_debt_enabled(false).unwrap();
    store.set_envelope_caps_enabled(false).unwrap();
    store.set_apply_to_debt_enabled(true).unwrap();

    let settings = store.get_app_settings().unwrap();
    assert!(settings.apply_to_debt_enabled);
    assert!(!settings.envelope_caps_enabled);
}

#[test]
fn live_price_requests_used_today_is_zero_when_never_recorded() {
    let store = Store::open_in_memory().unwrap();
    let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();

    assert_eq!(store.live_price_requests_used_today(today).unwrap(), 0);
}

#[test]
fn record_live_price_request_increments_and_returns_the_new_count() {
    let store = Store::open_in_memory().unwrap();
    let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();

    assert_eq!(store.record_live_price_request(today).unwrap(), 1);
    assert_eq!(store.record_live_price_request(today).unwrap(), 2);
    assert_eq!(store.record_live_price_request(today).unwrap(), 3);
    assert_eq!(store.live_price_requests_used_today(today).unwrap(), 3);
}

#[test]
fn record_live_price_request_resets_to_one_on_a_new_day() {
    let store = Store::open_in_memory().unwrap();
    let yesterday = NaiveDate::from_ymd_opt(2026, 8, 29).unwrap();
    let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
    store.record_live_price_request(yesterday).unwrap();
    store.record_live_price_request(yesterday).unwrap();

    let count = store.record_live_price_request(today).unwrap();

    assert_eq!(count, 1);
    assert_eq!(store.live_price_requests_used_today(today).unwrap(), 1);
    assert_eq!(store.live_price_requests_used_today(yesterday).unwrap(), 0);
}

#[test]
fn opening_a_pre_request_tracking_database_migrates_it_without_losing_the_api_key() {
    // Simulates a database from before the daily request counter
    // existed: a `live_price_settings` table with just the original two
    // columns, already holding a saved API key.
    let dir = std::env::temp_dir().join(format!("vaultspend-live-price-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_request_tracking.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE live_price_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    api_key TEXT,
                    last_refreshed_at TEXT
                );",
        )
        .unwrap();
        conn.execute("INSERT INTO live_price_settings (id, api_key) VALUES (1, 'saved-key')", [])
            .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    let settings = store.get_live_price_settings().unwrap();
    assert_eq!(
        settings.api_key,
        Some("saved-key".to_string()),
        "the saved API key must survive the migration"
    );

    let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
    assert_eq!(store.live_price_requests_used_today(today).unwrap(), 0);
    assert_eq!(store.record_live_price_request(today).unwrap(), 1);

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn opening_a_pre_provider_column_database_migrates_it_to_alpha_vantage_without_losing_the_api_key() {
    // Simulates a database from before Finnhub existed: a
    // `live_price_settings` table with the request-tracking columns
    // but no `provider` column yet, already holding a saved API key —
    // necessarily an Alpha Vantage key, since Finnhub didn't exist.
    let dir = std::env::temp_dir().join(format!("vaultspend-live-price-provider-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_provider_column.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE live_price_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    api_key TEXT,
                    last_refreshed_at TEXT,
                    requests_used_today INTEGER NOT NULL DEFAULT 0,
                    requests_count_date TEXT
                );",
        )
        .unwrap();
        conn.execute("INSERT INTO live_price_settings (id, api_key) VALUES (1, 'saved-key')", [])
            .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    let settings = store.get_live_price_settings().unwrap();
    assert_eq!(
        settings.api_key,
        Some("saved-key".to_string()),
        "the saved API key must survive the migration"
    );
    assert_eq!(settings.provider, "alpha_vantage");

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn auto_linking_is_off_until_switched_on_and_leaves_the_other_switches_alone() {
    let store = Store::open_in_memory().unwrap();
    assert!(!store.get_app_settings().unwrap().auto_link_transfers);

    store.set_auto_link_transfers(true).unwrap();

    let settings = store.get_app_settings().unwrap();
    assert!(settings.auto_link_transfers);
    assert!(settings.apply_to_debt_enabled && settings.split_purchases_enabled && settings.rollover_enabled);
    store.set_auto_link_transfers(false).unwrap();
    assert!(!store.get_app_settings().unwrap().auto_link_transfers);
}

#[test]
fn backup_copy_dir_starts_unset_and_can_be_set_and_cleared() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(store.get_backup_copy_dir().unwrap(), None);

    store.set_backup_copy_dir(Some("D:\\OneDrive\\Backups")).unwrap();
    assert_eq!(store.get_backup_copy_dir().unwrap(), Some("D:\\OneDrive\\Backups".to_string()));

    store.set_backup_copy_dir(None).unwrap();
    assert_eq!(store.get_backup_copy_dir().unwrap(), None);
}

#[test]
fn a_blank_backup_copy_dir_counts_as_unset() {
    let store = Store::open_in_memory().unwrap();
    store.set_backup_copy_dir(Some("   ")).unwrap();

    assert_eq!(store.get_backup_copy_dir().unwrap(), None);
}

#[test]
fn setting_the_backup_copy_dir_leaves_the_feature_toggles_alone() {
    let store = Store::open_in_memory().unwrap();
    store.set_envelope_caps_enabled(false).unwrap();
    store.set_backup_copy_dir(Some("E:\\Backups")).unwrap();

    let settings = store.get_app_settings().unwrap();
    assert!(!settings.envelope_caps_enabled, "an earlier toggle must survive");
    assert!(
        settings.apply_to_debt_enabled && settings.split_purchases_enabled,
        "untouched toggles keep their default"
    );
}

#[test]
fn opening_a_database_from_before_the_backup_copy_dir_existed_adds_the_column() {
    let dir = std::env::temp_dir().join(format!("meadow-backup-copy-dir-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_backup_copy_dir.db");
    let _ = std::fs::remove_file(&db_path);
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    apply_to_debt_enabled INTEGER NOT NULL DEFAULT 1,
                    split_purchases_enabled INTEGER NOT NULL DEFAULT 1,
                    envelope_caps_enabled INTEGER NOT NULL DEFAULT 1,
                    loan_sign_convention_migrated INTEGER NOT NULL DEFAULT 0,
                    default_rules_seeded INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO app_settings (id, envelope_caps_enabled) VALUES (1, 0);",
        )
        .unwrap();
    }

    let store = Store::open(&db_path).unwrap();

    assert_eq!(store.get_backup_copy_dir().unwrap(), None);
    store.set_backup_copy_dir(Some("F:\\Safe")).unwrap();
    assert_eq!(store.get_backup_copy_dir().unwrap(), Some("F:\\Safe".to_string()));
    assert!(!store.get_app_settings().unwrap().envelope_caps_enabled, "the existing row must survive");
}

#[test]
fn the_rollover_feature_is_on_by_default_and_its_setting_persists() {
    let store = Store::open_in_memory().unwrap();
    assert!(
        store.get_app_settings().unwrap().rollover_enabled,
        "existing users keep today's behaviour until they choose otherwise"
    );

    store.set_rollover_enabled(false).unwrap();
    let settings = store.get_app_settings().unwrap();
    assert!(!settings.rollover_enabled);
    assert!(
        settings.envelope_caps_enabled && settings.apply_to_debt_enabled,
        "other toggles are untouched"
    );

    store.set_rollover_enabled(true).unwrap();
    assert!(store.get_app_settings().unwrap().rollover_enabled);
}

#[test]
fn opening_a_database_from_before_the_rollover_setting_existed_keeps_rollover_on() {
    let dir = std::env::temp_dir().join(format!("meadow-rollover-setting-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_rollover_setting.db");
    let _ = std::fs::remove_file(&db_path);
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    apply_to_debt_enabled INTEGER NOT NULL DEFAULT 1,
                    split_purchases_enabled INTEGER NOT NULL DEFAULT 1,
                    envelope_caps_enabled INTEGER NOT NULL DEFAULT 1,
                    loan_sign_convention_migrated INTEGER NOT NULL DEFAULT 0,
                    default_rules_seeded INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO app_settings (id, envelope_caps_enabled) VALUES (1, 0);",
        )
        .unwrap();
    }

    let store = Store::open(&db_path).unwrap();

    let settings = store.get_app_settings().unwrap();
    assert!(settings.rollover_enabled, "an upgraded profile behaves exactly as before");
    assert!(!settings.envelope_caps_enabled, "the existing row's choices survive");
}

#[test]
fn reminder_projection_keeps_future_dates_and_stable_private_identity() {
    let store = Store::open_in_memory().unwrap();
    let id = bill(&store, "Secret merchant", "-123.45", "2026-09-30");
    bill(&store, "Income", "3000", "2026-09-20");
    let canceled = bill(&store, "Canceled", "-10", "2026-09-20");
    store.set_recurring_status(canceled, "canceled").unwrap();
    let rows = store.reminder_projection(day("2026-09-18")).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].due_date, day("2026-09-30"));
    assert_eq!(rows[0].opaque_id.len(), 32);
    let opaque = rows[0].opaque_id.clone();
    assert_ne!(opaque, id.to_string());
    store.mark_reminder_sent(id, day("2026-09-30"), day("2026-09-27")).unwrap();
    let rows = store.reminder_projection(day("2026-09-28")).unwrap();
    assert_eq!(rows[0].opaque_id, opaque);
    assert_eq!(rows[0].last_notified, Some(day("2026-09-27")));
    let rows = store.reminder_projection(day("2026-10-01")).unwrap();
    assert_eq!(rows[0].opaque_id, opaque);
    assert_eq!(rows[0].last_notified, None);
    store.delete_recurring(id).unwrap();
    assert!(store.reminder_projection(day("2026-09-18")).unwrap().is_empty());
}

#[test]
fn a_reminder_is_sent_once_per_due_date_and_returns_for_the_next_cycle() {
    let store = Store::open_in_memory().unwrap();
    let id = bill(&store, "Geico Auto", "-120.00", "2026-09-20");
    assert_eq!(reminder_names(&store, "2026-09-18", 3), vec!["Geico Auto"]);

    store.mark_reminder_sent(id, day("2026-09-20"), day("2026-09-18")).unwrap();

    assert!(reminder_names(&store, "2026-09-18", 3).is_empty());
    assert!(reminder_names(&store, "2026-09-19", 3).is_empty(), "still the same due date");
    // A month later the next due date is a fresh reminder.
    assert_eq!(reminder_names(&store, "2026-10-18", 3), vec!["Geico Auto"]);
}

#[test]
fn a_reminder_carries_what_the_notification_needs() {
    let store = Store::open_in_memory().unwrap();
    let id = bill(&store, "Geico Auto", "-120.00", "2026-09-20");

    let reminders = store.reminders_to_send(day("2026-09-18"), 3).unwrap();

    assert_eq!(reminders.len(), 1);
    assert_eq!(reminders[0].recurring_id, id);
    assert_eq!(reminders[0].amount, dec("-120.00"));
    assert_eq!(reminders[0].due_date, day("2026-09-20"));
}

#[test]
fn background_settings_start_off_and_are_set_independently() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(
        store.get_background_settings().unwrap(),
        BackgroundSettings {
            tray_enabled: false,
            autostart_enabled: false
        }
    );

    store.set_tray_enabled(true).unwrap();
    assert_eq!(
        store.get_background_settings().unwrap(),
        BackgroundSettings {
            tray_enabled: true,
            autostart_enabled: false
        }
    );

    store.set_autostart_enabled(true).unwrap();
    store.set_tray_enabled(false).unwrap();
    assert_eq!(
        store.get_background_settings().unwrap(),
        BackgroundSettings {
            tray_enabled: false,
            autostart_enabled: true
        }
    );
}

#[test]
fn background_settings_leave_the_feature_toggles_alone() {
    let store = Store::open_in_memory().unwrap();
    store.set_envelope_caps_enabled(false).unwrap();

    store.set_tray_enabled(true).unwrap();

    assert!(!store.get_app_settings().unwrap().envelope_caps_enabled);
}

#[test]
fn safe_to_spend_setting_defaults_on_and_survives_schema_upgrade() {
    let store = Store::open_in_memory().unwrap();
    assert!(store.get_app_settings().unwrap().safe_to_spend_enabled);
    store.set_safe_to_spend_enabled(false).unwrap();
    assert!(!store.get_app_settings().unwrap().safe_to_spend_enabled);
    store.set_envelope_caps_enabled(false).unwrap();
    store
        .conn
        .execute_batch("ALTER TABLE app_settings DROP COLUMN safe_to_spend_enabled;")
        .unwrap();
    store.init_schema().unwrap();
    let settings = store.get_app_settings().unwrap();
    assert!(settings.safe_to_spend_enabled);
    assert!(!settings.envelope_caps_enabled);
}
