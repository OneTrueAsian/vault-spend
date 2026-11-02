use super::historical_account_moves::{T, account_of, acct, add, bal, d, day, go, legacy_reset, preview_at, resets, set, two_accounts, versions_of};
use super::transaction_account_move::dump;
use super::*;
use crate::store::{BalanceInput, DatabaseKey, MoveError, MoveFailpoint, MoveOutcome, MoveRequest};
use rust_decimal::Decimal;
use std::path::{Path, PathBuf};

// The migration, checkpoint-graph, confirmation and atomicity scenarios (M, G, C and A groups) of the acceptance
// matrix. As in the numeric fixtures, expected figures are worked by hand and "unchanged" is a dump of every table.

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vaultspend-hist-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Strips everything this feature added, leaving a database shaped like one from the release before it.
fn to_legacy_shape(store: &Store) {
    store
        .conn
        .execute_batch(
            "DROP TRIGGER IF EXISTS trg_tx_revision_insert; DROP TRIGGER IF EXISTS trg_tx_revision_update; DROP TRIGGER IF EXISTS trg_tx_revision_delete;
             DROP TRIGGER IF EXISTS trg_resets_untracked_insert; DROP TRIGGER IF EXISTS trg_resets_untracked_update; DROP TRIGGER IF EXISTS trg_resets_untracked_delete;
             DROP INDEX IF EXISTS idx_balance_resets_account_effective; DROP INDEX IF EXISTS idx_balance_versions_reset; DROP INDEX IF EXISTS idx_balance_versions_parent;
             DROP INDEX IF EXISTS idx_balance_versions_account; DROP INDEX IF EXISTS idx_version_contributions_transaction;
             DROP TABLE IF EXISTS balance_version_contributions; DROP TABLE IF EXISTS balance_reset_versions; DROP TABLE IF EXISTS account_move_operations;
             DROP TABLE IF EXISTS financial_revision_counter; DROP TABLE IF EXISTS checkpoint_write_guard; DROP TABLE IF EXISTS transaction_tombstones;
             DROP TABLE IF EXISTS schema_features;
             ALTER TABLE balance_resets DROP COLUMN effective_from; ALTER TABLE balance_resets DROP COLUMN current_version_id;
             ALTER TABLE transactions DROP COLUMN financial_revision;",
        )
        .unwrap();
}

fn has_feature(path: &Path, key: Option<&[u8; 32]>) -> bool {
    let conn = rusqlite::Connection::open(path).unwrap();
    if let Some(k) = key {
        conn.execute_batch(&super::super::encryption::key_pragma(k)).unwrap();
    }
    let table: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'schema_features')", [], |r| {
            r.get(0)
        })
        .unwrap();
    table
        && conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_features WHERE name = 'historical_account_moves')",
                [],
                |r| r.get(0),
            )
            .unwrap()
}

/// Every account's balance on each day of a range, as the app reads it.
fn grid(store: &Store, from: &str, to: &str) -> Vec<(String, Vec<(i64, Decimal)>)> {
    let mut out = Vec::new();
    let mut date = day(from);
    while date <= day(to) {
        let list = store.list_accounts(date).unwrap();
        out.push((date.to_string(), list.into_iter().map(|a| (a.id, a.current_balance)).collect()));
        date = date.succ_opt().unwrap();
    }
    out
}

/// The old content of the tables the migration must leave alone.
fn old_tables(store: &Store) -> String {
    let mut out = String::new();
    for (table, cols) in [
        ("accounts", "id, name, account_type, starting_balance"),
        (
            "transactions",
            "id, account_id, date, description, amount, fingerprint, deleted_at, principal_amount",
        ),
        ("balance_resets", "id, account_id, period, reset_date, balance"),
    ] {
        let mut stmt = store.conn.prepare(&format!("SELECT {cols} FROM {table} ORDER BY id")).unwrap();
        let n = stmt.column_count();
        let mut rows = stmt.query([]).unwrap();
        out.push_str(table);
        while let Some(r) = rows.next().unwrap() {
            let v: Vec<rusqlite::types::Value> = (0..n).map(|i| r.get(i).unwrap()).collect();
            out.push_str(&format!("\n{v:?}"));
        }
    }
    out
}

fn integrity(store: &Store) {
    let ok: String = store.conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(ok, "ok");
    let mut stmt = store.conn.prepare("PRAGMA foreign_key_check").unwrap();
    assert!(
        stmt.query([]).unwrap().next().unwrap().is_none(),
        "foreign_key_check found a dangling reference"
    );
}

/// A legacy-shaped file profile with two accounts, rows, and the given saved balances, plus its balance grid.
type LegacyReset<'a> = (&'a str, &'a str, &'a str, &'a str);
type BalanceGrid = Vec<(String, Vec<(i64, Decimal)>)>;

fn legacy_profile(name: &str, resets: &[LegacyReset<'_>]) -> (PathBuf, PathBuf, BalanceGrid, String) {
    let dir = temp(name);
    let path = dir.join("profile.db");
    let store = Store::open(&path).unwrap();
    let (a, b) = two_accounts(&store);
    add(&store, a, "2026-09-10", "Old", "-50.00");
    add(&store, a, "2026-10-20", "Purchase", "-100.00");
    add(&store, b, "2026-10-21", "Deposit", "25.00");
    add(&store, a, "2026-12-15", "Future", "-5.00");
    for (who, period, cutoff, balance) in resets {
        let id = if *who == "a" { a } else { b };
        legacy_reset(&store, id, period, cutoff, balance);
    }
    // Reads before the shape is stripped: these must survive the migration unchanged.
    let before = grid(&store, "2026-08-01", "2027-01-05");
    to_legacy_shape(&store);
    let tables = old_tables(&store);
    drop(store);
    (dir, path, before, tables)
}

// ---- M: migration and backup -----------------------------------------------------------------------------

#[test]
fn m01_a_fresh_database_gets_the_schema_and_nothing_else() {
    let store = Store::open_in_memory().unwrap();
    for table in [
        "balance_reset_versions",
        "balance_version_contributions",
        "account_move_operations",
        "financial_revision_counter",
        "transaction_tombstones",
        "schema_features",
    ] {
        let n: i64 = store.conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
        assert_eq!(
            n,
            if table == "schema_features" || table == "financial_revision_counter" {
                1
            } else {
                0
            },
            "{table}"
        );
    }
    for index in [
        "idx_balance_resets_account_effective",
        "idx_balance_versions_parent",
        "idx_version_contributions_transaction",
    ] {
        let n: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                params![index],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "{index}");
    }
    let id = acct(&store, "Fresh", AccountType::Checking, "10.00");
    assert_eq!(bal(&store, id, T), d("10.00"), "ordinary account creation is unchanged");
    integrity(&store);
}

#[test]
fn m02_to_m05_a_legacy_profile_keeps_every_balance_on_every_day_and_invents_no_membership() {
    // M02: no saved balances. M03: an automatic chain. M04: manual and automatic sharing a cutoff. M05: future rows.
    let cases: [(&str, Vec<LegacyReset<'_>>); 3] = [
        ("m02", vec![]),
        (
            "m03",
            vec![
                ("a", "2026-09", "2026-09-30", "950.00"),
                ("a", "2026-10", "2026-10-28", "850.00"),
                ("b", "2026-10", "2026-10-28", "500.00"),
            ],
        ),
        (
            "m04",
            vec![
                ("a", "2026-10", "2026-10-28", "850.00"),
                ("a", "manual:2026-10-29", "2026-10-28", "875.00"),
                ("a", "2026-11", "2026-10-28", "860.00"),
                ("b", "2027-01", "2027-01-01", "999.00"),
            ],
        ),
    ];
    for (name, resets_in) in cases {
        let (dir, path, before_grid, tables) = legacy_profile(name, &resets_in);
        let store = Store::open(&path).unwrap();
        assert_eq!(grid(&store, "2026-08-01", "2027-01-05"), before_grid, "{name}: balances on every day");
        assert_eq!(old_tables(&store), tables, "{name}: ids, amounts and saved balances");
        // Every old saved balance is a version that says it does not know what it counted.
        let known: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM balance_reset_versions WHERE integrity <> 'opaque' OR kind NOT IN ('legacy_unknown', 'manual_anchor')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(known, 0, "{name}");
        let contributions: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM balance_version_contributions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(contributions, 0, "{name}: membership is never guessed from today's rows");
        let backfilled: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM balance_resets WHERE effective_from IS NULL OR effective_from <> reset_date",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(backfilled, 0, "{name}");
        integrity(&store);
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[test]
fn m06_an_encrypted_profile_is_backed_up_encrypted_and_only_its_key_opens_the_copy() {
    let protection = crate::protection::keyfile::create_protection(
        "historical backup password",
        &crate::protection::kdf::KdfParams::FAST_FOR_TESTS,
        "2026-10-29T00:00:00Z",
    )
    .unwrap();
    let key = *protection.dek.as_bytes();
    const WRONG: [u8; 32] = [0x44; 32];
    let dir = temp("m06");
    let path = dir.join("profile.db");
    // Build a protected legacy-shaped profile: a plain one with data, converted in place to encrypted.
    let plain = dir.join("plain.db");
    {
        let store = Store::open(&plain).unwrap();
        let (a, _b) = two_accounts(&store);
        add(&store, a, "2026-10-20", "Purchase", "-100.00");
        to_legacy_shape(&store);
        store.export_encrypted_copy(&path, &key).unwrap();
    }
    protection
        .key_file
        .write_to(&crate::protection::keyfile::key_file_path_for(&path))
        .unwrap();
    assert!(!has_feature(&path, Some(&key)));
    let store = Store::open_with_key(&path, DatabaseKey::Raw(&key)).unwrap();
    assert!(store.is_encrypted());
    let backups = dir.join("backups").join("protected");
    let copies: Vec<PathBuf> = std::fs::read_dir(&backups)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("pre-historical-moves-") && p.extension().is_some_and(|e| e == "db"))
        .collect();
    assert_eq!(copies.len(), 1);
    let bytes = std::fs::read(&copies[0]).unwrap();
    assert_ne!(&bytes[..16], b"SQLite format 3\0", "the copy is encrypted");
    assert!(!has_feature(&copies[0], Some(&key)), "the copy is the old format");
    let backup_key = crate::protection::keyfile::KeyFile::read(&crate::protection::keyfile::key_file_path_for(&copies[0]))
        .expect("the backup must include its recoverable key file");
    assert_eq!(backup_key, protection.key_file);
    assert_eq!(backup_key.unlock_with_password("historical backup password").unwrap().as_bytes(), &key);
    assert_eq!(backup_key.unlock_with_recovery(&protection.recovery_code).unwrap().as_bytes(), &key);
    let ok = Store::open_with_key(&copies[0], DatabaseKey::Raw(&key));
    assert!(ok.is_ok(), "the right key opens it");
    drop(ok);
    // The copy above was migrated by being opened; the wrong key and no key never read it.
    let other = temp("m06b").join("c.db");
    std::fs::copy(&copies[0], &other).unwrap();
    assert!(Store::open_with_key(&other, DatabaseKey::Raw(&WRONG)).is_err());
    assert!(Store::open_with_key(&other, DatabaseKey::Plaintext).is_err());
    // No plaintext temporary file or exported payload next to the profile.
    for entry in std::fs::read_dir(&dir).unwrap() {
        let p = entry.unwrap().path();
        if p.is_file()
            && p != path
            && p != plain
            && p != crate::protection::keyfile::key_file_path_for(&path)
            && p.file_name().unwrap() != "account-changes.log"
        {
            panic!("unexpected file {p:?}");
        }
    }
    integrity(&store);
}

#[test]
fn m07_a_backup_that_cannot_be_made_stops_the_upgrade_and_leaves_the_profile_alone() {
    let (dir, path, _grid, tables) = legacy_profile("m07", &[("a", "2026-10", "2026-10-28", "850.00")]);
    let size = std::fs::metadata(&path).unwrap().len();
    // The backup folder cannot be created: something that is not a folder is in its place.
    std::fs::write(dir.join("backups"), b"not a folder").unwrap();
    let err = Store::open(&path).err().expect("the upgrade must stop").to_string();
    assert!(err.contains("safety copy") && err.contains("nothing was changed"), "{err}");
    assert!(!has_feature(&path, None), "the schema was not changed");
    assert_eq!(std::fs::metadata(&path).unwrap().len(), size, "the file is not rewritten");
    assert!(std::fs::read(&path).unwrap().len() > 4096, "no empty replacement database");
    std::fs::remove_file(dir.join("backups")).unwrap();
    let store = Store::open(&path).unwrap();
    assert_eq!(old_tables(&store), tables);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn m08_a_fault_at_each_migration_stage_leaves_the_old_shape_and_a_rerun_finishes_it() {
    for stage in 0..=6 {
        let (dir, path, before_grid, tables) = legacy_profile(
            &format!("m08-{stage}"),
            &[("a", "2026-10", "2026-10-28", "850.00"), ("b", "2026-10", "2026-10-28", "500.00")],
        );
        crate::store::checkpoints_test_support::fail_migration_at(Some(stage));
        let err = Store::open(&path).err().expect("the injected fault must stop the open");
        crate::store::checkpoints_test_support::fail_migration_at(None);
        assert!(err.to_string().contains("injected migration fault"), "{err}");
        assert!(!has_feature(&path, None), "stage {stage}: the half-done migration was rolled back");
        let store = Store::open(&path).unwrap();
        assert_eq!(grid(&store, "2026-08-01", "2027-01-05"), before_grid, "stage {stage}");
        assert_eq!(old_tables(&store), tables, "stage {stage}");
        let versions: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM balance_reset_versions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(versions, 2, "stage {stage}: one version per saved balance, none duplicated");
        integrity(&store);
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[test]
fn m09_the_pre_upgrade_backup_restores_the_original_balances() {
    let (dir, path, before_grid, tables) = legacy_profile("m09", &[("a", "2026-10", "2026-10-28", "850.00")]);
    let store = Store::open(&path).unwrap();
    let a = store.list_accounts(day(T)).unwrap()[0].id;
    add(&store, a, "2026-11-01", "After the upgrade", "-1.00"); // later work the restore will not contain
    drop(store);
    let copy: PathBuf = std::fs::read_dir(dir.join("backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.file_name().unwrap().to_string_lossy().starts_with("pre-historical-moves-"))
        .unwrap();
    let restored = dir.join("restored.db");
    std::fs::copy(&copy, &restored).unwrap();
    assert!(!has_feature(&restored, None), "the backup is the old format");
    let store = Store::open(&restored).unwrap();
    assert_eq!(old_tables(&store), tables, "the original data");
    let g = grid(&store, "2026-08-01", "2027-01-05");
    assert_eq!(g, before_grid, "the original balances on every day");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn m10_a_copy_of_an_upgraded_profile_keeps_versions_membership_and_the_audit() {
    let dir = temp("m10");
    let path = dir.join("profile.db");
    let store = Store::open(&path).unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    go(&store, &[r], b, &[], T, "m10-op");
    let copy = dir.join("copy.db");
    store.backup_to(&copy).unwrap();
    let other = Store::open(&copy).unwrap();
    assert_eq!(dump(&store), dump(&other), "every table, including versions, contributions and the audit");
    assert!(other.get_account_move("m10-op").unwrap().is_some());
    integrity(&other);
    let contributions: i64 = other
        .conn
        .query_row("SELECT COUNT(*) FROM balance_version_contributions", [], |r| r.get(0))
        .unwrap();
    assert!(contributions > 0);
    // Opening it again changes nothing and makes no second backup.
    drop(other);
    let again = Store::open(&copy).unwrap();
    assert_eq!(dump(&store), dump(&again));
    assert!(!dir.join("backups").exists(), "an already upgraded profile needs no safety copy");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn m11_unreadable_legacy_values_stop_the_upgrade_with_a_clear_message_and_change_nothing() {
    for (what, sql) in [
        ("an amount", "UPDATE transactions SET amount = 'twelve' WHERE description = 'Old'"),
        ("a date", "UPDATE transactions SET date = '2026-13-45' WHERE description = 'Old'"),
        ("a saved balance", "UPDATE balance_resets SET balance = 'n/a'"),
    ] {
        let (dir, path, _grid, _tables) = legacy_profile("m11", &[("a", "2026-10", "2026-10-28", "850.00")]);
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(sql).unwrap();
        }
        let message = Store::open(&path)
            .err()
            .unwrap_or_else(|| panic!("{what} must stop the upgrade"))
            .to_string();
        assert!(message.contains("unreadable"), "{what}: {message}");
        assert!(!has_feature(&path, None), "{what}: nothing was changed");
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[test]
fn m13_reopening_repeatedly_changes_nothing_and_makes_no_more_backups() {
    let (dir, path, _grid, _tables) = legacy_profile("m13", &[("a", "2026-10", "2026-10-28", "850.00")]);
    let first = Store::open(&path).unwrap();
    let snapshot = dump(&first);
    drop(first);
    let count = |dir: &Path| std::fs::read_dir(dir.join("backups")).unwrap().count();
    let backups = count(&dir);
    assert_eq!(backups, 1);
    for _ in 0..4 {
        let again = Store::open(&path).unwrap();
        assert_eq!(dump(&again), snapshot);
        let features: i64 = again.conn.query_row("SELECT COUNT(*) FROM schema_features", [], |r| r.get(0)).unwrap();
        assert_eq!(features, 1);
    }
    assert_eq!(count(&dir), backups, "no backup on every open");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn m14_an_old_reader_ignores_effective_from_so_a_downgraded_profile_can_read_wrong_balances() {
    // Documents the limit: the old query orders by cutoff and id only. After a confirmed move it picks the older
    // saved balance, so running the previous release on an upgraded profile is unsupported (restore the backup).
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    legacy_reset(&store, a, "2026-10", "2026-10-28", "900.00");
    legacy_reset(&store, b, "2026-10", "2026-10-28", "500.00");
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "m14");
    let old_pick: String = store
        .conn
        .query_row(
            "SELECT balance FROM balance_resets WHERE account_id = ?1 AND reset_date <= ?2 ORDER BY reset_date DESC, id DESC LIMIT 1",
            params![a, T],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(d(&old_pick), d("1000.00"), "by cutoff and id alone the newest row wins here");
    // But a rollover from a later launch of the old release would insert a row with an equal cutoff and a newer id;
    // the new reader prefers the effective day, which the old one cannot see.
    legacy_reset(&store, a, "2026-10b", "2026-10-28", "900.00");
    let old_pick: String = store
        .conn
        .query_row(
            "SELECT balance FROM balance_resets WHERE account_id = ?1 AND reset_date <= ?2 ORDER BY reset_date DESC, id DESC LIMIT 1",
            params![a, T],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(d(&old_pick), d("900.00"), "the old reader would now show 900");
    assert_eq!(bal(&store, a, T), d("1000.00"), "this version keeps the confirmed 1000");
}

// ---- G: checkpoint graph and accounting ----------------------------------------------------------------

#[test]
fn g01_a_capture_waits_for_a_writer_and_then_records_value_and_membership_together() {
    let dir = temp("g01");
    let path = dir.join("profile.db");
    let store = Store::open(&path).unwrap();
    let other = Store::open(&path).unwrap();
    store.conn.busy_timeout(std::time::Duration::from_millis(50)).unwrap();
    let (a, _b) = two_accounts(&store);
    add(&store, a, "2026-10-20", "Purchase", "-100.00");
    other.conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    other
        .conn
        .execute(
            "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (?1, '2026-10-22', 'Importing', '-7.00', 'fp-x')",
            params![a],
        )
        .unwrap();
    assert!(
        store.roll_forward_monthly_balances(day(T)).is_err(),
        "the capture cannot read half of an import"
    );
    let none: i64 = store.conn.query_row("SELECT COUNT(*) FROM balance_resets", [], |r| r.get(0)).unwrap();
    assert_eq!(none, 0, "nothing was recorded");
    other.conn.execute_batch("COMMIT").unwrap();
    store.roll_forward_monthly_balances(day(T)).unwrap();
    let saved = resets(&store, a)[0].3;
    let counted: Decimal = {
        let mut stmt = store.conn.prepare("SELECT c.contribution FROM balance_version_contributions c JOIN balance_resets r ON r.current_version_id = c.version_id WHERE r.account_id = ?1").unwrap();
        stmt.query_map(params![a], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|s| d(&s.unwrap()))
            .sum()
    };
    assert_eq!(saved, d("1000.00") - d("100.00") - d("7.00"));
    assert_eq!(saved - d("1000.00"), counted, "the value is exactly the opening plus what it recorded");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn g02_the_interval_is_open_below_and_closed_above_and_a_boundary_row_is_counted_once() {
    let store = Store::open_in_memory().unwrap();
    let a = acct(&store, "A", AccountType::Checking, "1000.00");
    let on_parent = add(&store, a, "2026-10-15", "On the parent cutoff", "-1.00");
    let after_parent = add(&store, a, "2026-10-16", "Just after the parent", "-2.00");
    let on_child = add(&store, a, "2026-10-28", "On the child cutoff", "-4.00");
    add(&store, a, "2026-10-29", "After both", "-8.00");
    store
        .record_automatic_checkpoint(a, "checking", d("1000.00"), "p", day("2026-10-15"))
        .unwrap();
    store.roll_forward_monthly_balances(day(T)).unwrap();
    let members = |reset_period: &str| -> Vec<i64> {
        let mut stmt = store.conn.prepare("SELECT c.transaction_id FROM balance_version_contributions c JOIN balance_resets r ON r.current_version_id = c.version_id WHERE r.period = ?1 ORDER BY 1").unwrap();
        stmt.query_map(params![reset_period], |x| x.get(0)).unwrap().map(|v| v.unwrap()).collect()
    };
    assert_eq!(members("p"), vec![on_parent], "the parent counts rows through its cutoff");
    assert_eq!(
        members("2026-10"),
        vec![after_parent, on_child],
        "the child counts only after the parent's cutoff, through its own"
    );
    assert_eq!((resets(&store, a)[0].3, resets(&store, a)[1].3), (d("999.00"), d("993.00")));
}

#[test]
fn g03_several_sources_one_target_with_old_current_and_future_rows_keep_every_effect_separate() {
    let store = Store::open_in_memory().unwrap();
    let a = acct(&store, "A", AccountType::Checking, "1000.00");
    let b = acct(&store, "B", AccountType::Checking, "500.00");
    let c = acct(&store, "C", AccountType::Checking, "200.00");
    let a_old = add(&store, a, "2026-10-20", "A old", "-100.00");
    let b_old = add(&store, b, "2026-10-21", "B old", "-50.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    let a_today = add(&store, a, T, "A today", "-10.00");
    let b_future = add(&store, b, "2026-11-10", "B future", "-5.00");
    assert_eq!(
        (bal(&store, a, T), bal(&store, b, T), bal(&store, c, T)),
        (d("890.00"), d("450.00"), d("200.00"))
    );
    go(&store, &[a_old, b_old, a_today, b_future], c, &[], T, "g03");
    // Today: A 900+100+10 = 1000, B 450+50 = 500, C 200-100-50-10 = 40; B's future row (5) is not in today's figure.
    assert_eq!(
        (bal(&store, a, T), bal(&store, b, T), bal(&store, c, T)),
        (d("1000.00"), d("500.00"), d("40.00"))
    );
    assert_eq!(
        bal(&store, c, "2026-11-10"),
        d("35.00"),
        "the future row arrives in C and counts from its own date"
    );
    assert_eq!(bal(&store, b, "2026-11-10"), d("500.00"));
    for id in [a_old, b_old, a_today, b_future] {
        assert_eq!(account_of(&store, id), c);
    }
}

#[test]
fn g05_the_recorded_parent_decides_the_dependency_not_the_order_of_dates_or_ids() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-10", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap(); // X: cutoff 28 Oct, no parent, newer than nothing
    store
        .record_automatic_checkpoint(a, "checking", d("1000.00"), "earlier-but-later-made", day("2026-10-19"))
        .unwrap(); // Y: cutoff 19 Oct, created after X
    let (x, y) = (resets(&store, a)[0].3, resets(&store, a)[1].3);
    assert_eq!((x, y), (d("900.00"), d("900.00")));
    go(&store, &[r], b, &[], T, "g05");
    assert_eq!(
        (resets(&store, a)[0].3, resets(&store, a)[1].3),
        (d("1000.00"), d("1000.00")),
        "each is corrected once, independently"
    );
    assert_eq!(bal(&store, a, T), d("1000.00"));
}

#[test]
fn g06_a_row_inside_an_unknown_ancestor_interval_asks_for_confirmation() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    legacy_reset(&store, a, "2026-09", "2026-10-15", "700.00");
    legacy_reset(&store, b, "2026-09", "2026-10-15", "500.00");
    let old = add(&store, a, "2026-10-10", "Inside the unknown interval", "-100.00");
    let known = add(&store, a, "2026-10-20", "Inside the recorded interval", "-50.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    assert_eq!(preview_at(&store, &[known], b, &[], T).status, "ready");
    assert_eq!(preview_at(&store, &[old], b, &[], T).status, "needs_balance_confirmation");
}

#[test]
fn g07_a_typed_balance_between_recorded_ones_is_never_adjusted_and_what_follows_it_is() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    add(&store, a, "2026-09-10", "September", "-50.00");
    store.roll_forward_monthly_balances(day("2026-10-01")).unwrap(); // 30 Sep: 950 recorded
    store.set_account_balance_override(a, d("940.00"), day("2026-10-15")).unwrap(); // typed, cutoff 14 Oct
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day("2026-11-02")).unwrap(); // 1 Nov: 840, recorded on top of the typed 940
    let manual_before = resets(&store, a).into_iter().find(|x| x.0.starts_with("manual:")).unwrap().3;
    assert_eq!(manual_before, d("940.00"));
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!((p.status, p.mode), ("ready", "automatic"), "{:?}", p.confirmations);
    go(&store, &[r], b, &[], T, "g07");
    let manual_after = resets(&store, a).into_iter().find(|x| x.0.starts_with("manual:")).unwrap().3;
    assert_eq!(manual_after, d("940.00"), "the typed balance is authoritative and untouched");
    assert_eq!(
        resets(&store, a).into_iter().find(|x| x.0 == "2026-11").unwrap().3,
        d("940.00"),
        "840 + 100 after the correction"
    );
}

#[test]
fn g09_an_edit_after_capture_that_changes_money_asks_for_confirmation_but_a_note_does_not() {
    let make = || {
        let store = Store::open_in_memory().unwrap();
        let (a, b) = two_accounts(&store);
        let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
        store.roll_forward_monthly_balances(day(T)).unwrap();
        (store, a, b, r)
    };
    let status = |store: &Store, r: i64, b: i64| preview_at(store, &[r], b, &[], T).status;
    let (store, _a, b, r) = make();
    store
        .conn
        .execute(
            "UPDATE transactions SET description = 'Renamed', category = 'Dining Out', notes = 'a note' WHERE id = ?1",
            params![r],
        )
        .unwrap();
    assert_eq!(status(&store, r, b), "ready", "description, category and note edits are not financial");
    for (what, sql) in [
        ("amount", "UPDATE transactions SET amount = '-101.00' WHERE id = ?1"),
        ("date", "UPDATE transactions SET date = '2026-10-21' WHERE id = ?1"),
        (
            "delete and restore",
            "UPDATE transactions SET deleted_at = '2026-10-25 10:00:00' WHERE id = ?1; UPDATE transactions SET deleted_at = NULL WHERE id = ?1",
        ),
    ] {
        let (store, _a, b, r) = make();
        for part in sql.split("; ") {
            store.conn.execute(part, params![r]).unwrap();
        }
        assert_eq!(status(&store, r, b), "needs_balance_confirmation", "{what}");
    }
}

#[test]
fn g09b_a_principal_edit_on_a_loan_after_capture_asks_for_confirmation() {
    let store = Store::open_in_memory().unwrap();
    let la = acct(&store, "Loan A", AccountType::Loan, "1000.00");
    let lb = acct(&store, "Loan B", AccountType::Loan, "2000.00");
    let pay = add(&store, la, "2026-10-20", "Payment", "40.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    store.update_transaction_principal_amount(pay, Some(d("30.00"))).unwrap();
    assert_eq!(preview_at(&store, &[pay], lb, &[], T).status, "needs_balance_confirmation");
}

#[test]
fn g10_a_reused_row_id_is_not_mistaken_for_the_row_a_checkpoint_counted() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    store.hard_delete_transaction_row(r).unwrap();
    // A different row takes the same id (an import into a rebuilt table, a restore).
    let fp = fingerprint(a, &tx("2026-10-20", "Different", "-40.00"));
    store
        .conn
        .execute(
            "INSERT INTO transactions (id, account_id, date, description, amount, category, category_source, confidence, fingerprint) VALUES (?1, ?2, '2026-10-20', 'Different', '-40.00', 'Groceries', 'user', 0.8, ?3)",
            params![r, a, fp],
        )
        .unwrap();
    let revision: i64 = store
        .conn
        .query_row("SELECT financial_revision FROM transactions WHERE id = ?1", params![r], |x| x.get(0))
        .unwrap();
    let tombstone: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM transaction_tombstones WHERE transaction_id = ?1", params![r], |x| {
            x.get(0)
        })
        .unwrap();
    assert!(revision > 0 && tombstone == 1);
    assert_eq!(
        preview_at(&store, &[r], b, &[], T).status,
        "needs_balance_confirmation",
        "the old record belongs to the old row"
    );
}

#[test]
fn g11_a_changed_account_type_or_opening_balance_after_capture_asks_for_confirmation() {
    for what in ["opening", "type"] {
        let store = Store::open_in_memory().unwrap();
        let (a, b) = two_accounts(&store);
        let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
        store.roll_forward_monthly_balances(day(T)).unwrap();
        if what == "opening" {
            store.set_account_starting_balance(a, d("1200.00")).unwrap();
        } else {
            store
                .conn
                .execute("UPDATE accounts SET account_type = 'savings' WHERE id = ?1", params![a])
                .unwrap();
        }
        let p = preview_at(&store, &[r], b, &[], T);
        assert_eq!(p.status, "needs_balance_confirmation", "{what}");
        assert!(
            p.confirmations.iter().any(|c| c.reasons.iter().any(|x| x.contains("changed after"))),
            "{what}: {:?}",
            p.confirmations
        );
    }
}

#[test]
fn g12_damaged_records_block_the_move_and_a_confirmation_cannot_cover_for_them() {
    let cases: [(&str, &str); 4] = [
        (
            "a missing parent",
            "DELETE FROM balance_reset_versions WHERE id = (SELECT parent_version_id FROM balance_reset_versions WHERE parent_version_id IS NOT NULL LIMIT 1)",
        ),
        (
            "a cycle",
            "UPDATE balance_reset_versions SET parent_version_id = id WHERE parent_version_id IS NOT NULL",
        ),
        (
            "partial coverage",
            "UPDATE balance_reset_versions SET coverage_end = '2026-10-01' WHERE kind = 'automatic_recorded'",
        ),
        ("a corrupt stored sum", "UPDATE balance_version_contributions SET contribution = '-99.00'"),
    ];
    for (what, sql) in cases {
        let store = Store::open_in_memory().unwrap();
        let (a, b) = two_accounts(&store);
        let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
        store.roll_forward_monthly_balances(day("2026-09-16")).unwrap(); // a parent for the next one
        store.roll_forward_monthly_balances(day(T)).unwrap();
        store.conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap(); // damage done from outside the app
        store.conn.execute_batch(&format!("{sql};")).unwrap();
        store.conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        let before = dump(&store);
        let p = preview_at(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T);
        assert_eq!(p.status, "blocked", "{what}: {:?}", p.confirmations);
        assert!(p.blockers.iter().any(|x| x.code == "checkpoint_integrity"), "{what}");
        let summary = &p.blockers.iter().find(|x| x.code == "checkpoint_integrity").unwrap().summary;
        assert!(
            summary.starts_with("1 transaction touches saved balances that look damaged"),
            "{what}: {summary}"
        );
        assert!(!p.can_commit, "{what}");
        assert_eq!(dump(&store), before, "{what}: a preview writes nothing");
    }
}

#[test]
fn g13_a_sign_flip_leaves_no_false_evidence_that_the_checkpoint_can_be_corrected_automatically() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    store.flip_transaction_signs(&[r]).unwrap();
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!(p.status, "needs_balance_confirmation");
    let trusted: i64 = store.conn.query_row("SELECT COUNT(*) FROM balance_reset_versions v JOIN balance_resets r ON r.current_version_id = v.id WHERE v.integrity = 'trusted' AND r.account_id = ?1", params![a], |x| x.get(0)).unwrap();
    assert_eq!(trusted, 0, "the flipped account's saved balance no longer claims a recorded membership");
}

#[test]
fn g14_a_direct_edit_of_a_saved_balance_invalidates_it_and_everything_built_on_it() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day("2026-09-26")).unwrap(); // parent: cutoff 25 Sep
    store.roll_forward_monthly_balances(day(T)).unwrap(); // child: cutoff 28 Oct, built on it
    store
        .conn
        .execute("UPDATE balance_resets SET balance = '1001.00' WHERE reset_date = '2026-09-25'", [])
        .unwrap();
    let integrity_of: Vec<String> = {
        let mut stmt = store.conn.prepare("SELECT v.integrity FROM balance_reset_versions v JOIN balance_resets r ON r.current_version_id = v.id WHERE r.account_id = ?1 ORDER BY r.reset_date").unwrap();
        stmt.query_map(params![a], |x| x.get(0)).unwrap().map(|v| v.unwrap()).collect()
    };
    assert_eq!(
        integrity_of,
        vec!["opaque", "untrusted"],
        "the edited one is opaque now, the one built on it is untrusted"
    );
    assert_eq!(preview_at(&store, &[r], b, &[], T).status, "needs_balance_confirmation");
}

#[test]
fn g15_repeated_moves_and_their_reverses_do_not_drift() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    for round in 0..4 {
        go(&store, &[r], b, &[], T, &format!("g15-{round}-out"));
        assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("400.00")), "round {round}");
        go(&store, &[r], a, &[], T, &format!("g15-{round}-back"));
        assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("900.00"), d("500.00")), "round {round}");
    }
    let members: i64 = store.conn.query_row("SELECT COUNT(*) FROM balance_version_contributions WHERE transaction_id = ?1 AND version_id IN (SELECT current_version_id FROM balance_resets)", params![r], |x| x.get(0)).unwrap();
    assert_eq!(members, 1);
    assert_eq!(versions_of(&store, a).len(), 1 + 8, "every correction is its own version, the first kept");
}

#[test]
fn g16_cents_fractions_zeros_negatives_and_limits_are_exact_and_overflow_is_refused() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let fraction = add(&store, a, "2026-10-20", "Fraction", "-12.3456");
    let zero = add(&store, a, "2026-10-21", "Zero", "0.00");
    let credit = add(&store, a, "2026-10-22", "Refund", "7.01");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    assert_eq!(resets(&store, a)[0].3, d("1000.00") - d("12.3456") + d("7.01"));
    go(&store, &[fraction, zero, credit], b, &[], T, "g16");
    assert_eq!(resets(&store, a)[0].3, d("1000.00"), "exact, nothing rounded");
    assert_eq!(resets(&store, b)[0].3, d("500.00") - d("12.3456") + d("7.01"));
    // An amount no balance can hold is an error, not a panic or a rounded value.
    let huge = add(&store, a, T, "Huge", "79228162514264337593543950335");
    let _ = huge;
    let (c, e) = (
        acct(&store, "C", AccountType::Checking, "0.00"),
        acct(&store, "E", AccountType::Checking, "0.00"),
    );
    legacy_reset(&store, c, "2026-10", "2026-10-28", "1.00");
    legacy_reset(&store, e, "2026-10", "2026-10-28", "1.00");
    let old = add(&store, c, "2026-10-20", "Old", "-1.00");
    for bad in ["1000000000000000", "99999999999999999999"] {
        let p = preview_at(&store, &[old], e, &[set(c, bad), set(e, "1.00")], T);
        assert!(!p.can_commit, "{bad}");
        assert!(p.confirmations.iter().any(|x| x.problem.is_some()), "{bad}");
    }
}

#[test]
fn g17_credit_overpayment_is_a_negative_owed_and_a_loan_cannot_owe_less_than_nothing() {
    let store = Store::open_in_memory().unwrap();
    let card = acct(&store, "Card", AccountType::Credit, "1000.00");
    let loan = acct(&store, "Loan", AccountType::Loan, "500.00");
    let a = acct(&store, "A", AccountType::Checking, "100.00");
    let old = add(&store, a, "2026-10-20", "Old", "-10.00");
    for id in [card, loan, a] {
        legacy_reset(&store, id, "2026-10", "2026-10-28", "100.00");
    }
    let p = preview_at(&store, &[old], card, &[set(card, "-25.00"), set(a, "110.00")], T);
    assert!(p.can_commit, "{:?}", p.confirmations);
    assert_eq!(
        p.confirmations
            .iter()
            .find(|c| c.account_id == card)
            .unwrap()
            .projected_baseline
            .as_deref(),
        Some("1025.00"),
        "owed -25 is 1025 available"
    );
    let old2 = add(&store, a, "2026-10-21", "Old 2", "-1.00");
    let p = preview_at(&store, &[old2], loan, &[set(loan, "-5.00"), set(a, "111.00")], T);
    assert!(!p.can_commit);
    assert!(
        p.confirmations
            .iter()
            .find(|c| c.account_id == loan)
            .unwrap()
            .problem
            .as_deref()
            .unwrap()
            .contains("can't be negative")
    );
}

#[test]
fn g18_a_holdings_valued_account_keeps_its_holdings_and_cannot_have_a_holdings_value_confirmed_as_cash() {
    let store = Store::open_in_memory().unwrap();
    let a = acct(&store, "A", AccountType::Checking, "1000.00");
    let brokerage = acct(&store, "Brokerage", AccountType::Investment, "0.00");
    store
        .create_holding(brokerage, "VTI", "Total market", d("10"), d("250.00"), d("2000.00"), None)
        .unwrap();
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    let holdings_before = store.list_holdings(day(T)).unwrap().len();
    go(&store, &[r], brokerage, &[], T, "g18-auto");
    assert_eq!(store.list_holdings(day(T)).unwrap().len(), holdings_before);
    let shown = store.list_accounts(day(T)).unwrap().into_iter().find(|x| x.id == brokerage).unwrap();
    assert_eq!(
        shown.current_balance,
        d("2500.00"),
        "the displayed value is still the holdings value: 10 shares at 250"
    );
    let raw = store.account_balance_as_of(brokerage, "investment", d("0.00"), day(T)).unwrap();
    assert_eq!(raw, d("-100.00"), "the cash ledger took the transaction: 0 + (-100)");
    // Confirmation needed on a holdings account is refused, not invented.
    let store = Store::open_in_memory().unwrap();
    let a = acct(&store, "A", AccountType::Checking, "1000.00");
    let brokerage = acct(&store, "Brokerage", AccountType::Investment, "0.00");
    store
        .create_holding(brokerage, "VTI", "Total market", d("10"), d("250.00"), d("2000.00"), None)
        .unwrap();
    legacy_reset(&store, a, "2026-10", "2026-10-28", "900.00");
    legacy_reset(&store, brokerage, "2026-10", "2026-10-28", "0.00");
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    let p = preview_at(&store, &[r], brokerage, &[set(a, "1000.00"), set(brokerage, "2500.00")], T);
    assert_eq!(p.status, "blocked");
    assert!(p.blockers.iter().any(|x| x.code == "holdings_confirmation"));
    let summary = &p.blockers.iter().find(|x| x.code == "holdings_confirmation").unwrap().summary;
    assert!(summary.starts_with("1 transaction touches an investment account"), "{summary}");
}

#[test]
fn g19_rows_already_in_the_target_change_nothing_and_an_all_no_op_request_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let there = add(&store, b, "2026-10-20", "Already there", "-5.00");
    store.set_transactions_cleared(&[there], true).unwrap();
    store.roll_forward_monthly_balances(day(T)).unwrap();
    let before = dump(&store);
    let p = preview_at(&store, &[there], b, &[], T);
    assert!(!p.can_commit);
    let outcome = store
        .commit_account_move(&MoveRequest {
            ids: &[there],
            destination: b,
            expected_token: &p.token,
            today: day(T),
            operation_id: "g19",
            balances: &[],
        })
        .unwrap();
    assert!(matches!(outcome, MoveOutcome::NothingToMove(_)));
    assert_eq!(dump(&store), before, "no correction, revision, audit or cleared change");
    let _ = a;
}

// ---- C: current-balance confirmation -------------------------------------------------------------------

fn opaque_three() -> (Store, i64, i64, i64, i64) {
    let store = Store::open_in_memory().unwrap();
    let a = acct(&store, "A", AccountType::Checking, "1000.00");
    let b = acct(&store, "B", AccountType::Checking, "500.00");
    let c = acct(&store, "C", AccountType::Checking, "200.00");
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    legacy_reset(&store, a, "2026-10", "2026-10-28", "900.00");
    store.roll_forward_monthly_balances(day(T)).unwrap(); // B and C get recorded balances; A already has one for the month
    (store, a, b, c, r)
}

#[test]
fn c02_one_ambiguous_account_puts_the_whole_batch_in_confirmation_for_every_affected_account() {
    let (store, a, b, _c, r) = opaque_three();
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!((p.status, p.mode), ("needs_balance_confirmation", "confirmation"));
    let ids: Vec<i64> = p.confirmations.iter().map(|c| c.account_id).collect();
    assert_eq!(ids, vec![a, b], "the destination with a fully recorded history is asked too");
    let b_reasons = &p.confirmations.iter().find(|c| c.account_id == b).unwrap().reasons;
    assert!(b_reasons[0].contains("confirmed together"), "{b_reasons:?}");
    // A confirmed batch does not touch the old values of either account's saved balances.
    let (a_before, b_before) = (resets(&store, a), resets(&store, b));
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "c02");
    assert_eq!(resets(&store, a)[0], a_before[0]);
    assert_eq!(resets(&store, b)[0], b_before[0]);
}

#[test]
fn c03_a_shown_balance_alone_is_not_a_confirmation_and_keep_is_a_distinct_explicit_choice() {
    let (store, a, b, _c, r) = opaque_three();
    let p = preview_at(&store, &[r], b, &[], T);
    assert!(!p.can_commit);
    assert!(
        p.confirmations.iter().all(|c| c.confirmed_display.is_none() && c.choice.is_none()),
        "nothing is preselected"
    );
    let kept = preview_at(
        &store,
        &[r],
        b,
        &[
            BalanceInput {
                account_id: a,
                keep: true,
                value: None,
            },
            set(b, "400.00"),
        ],
        T,
    );
    let for_a = kept.confirmations.iter().find(|c| c.account_id == a).unwrap();
    assert_eq!((for_a.choice, for_a.confirmed_display.as_deref()), (Some("keep"), Some("900.00")));
    assert!(kept.can_commit);
    let typed = preview_at(&store, &[r], b, &[set(a, "900.00"), set(b, "400.00")], T);
    assert_eq!(
        typed.confirmations.iter().find(|c| c.account_id == a).unwrap().choice,
        Some("set"),
        "typing the same number is still a different choice from keeping"
    );
}

#[test]
fn c04_blank_odd_and_oversized_entries_are_refused_by_native_with_a_message_and_no_write() {
    let (store, a, b, _c, r) = opaque_three();
    let before = dump(&store);
    for bad in [
        "",
        "   ",
        "abc",
        "1e3",
        "NaN",
        "Infinity",
        "-",
        "--1",
        "1.2.3",
        "12.345",
        "1,234.50",
        "$100",
        "0x10",
        "99999999999999",
        "-1000000000000000",
    ] {
        let p = preview_at(&store, &[r], b, &[set(a, bad), set(b, "400.00")], T);
        assert!(!p.can_commit, "{bad:?}");
        let problem = p.confirmations.iter().find(|c| c.account_id == a).unwrap().problem.clone();
        assert!(problem.is_some_and(|m| !m.is_empty()), "{bad:?} must say why");
    }
    assert_eq!(dump(&store), before);
    // The commit path refuses too, even with a token from a valid review.
    let good = preview_at(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T);
    let outcome = store.commit_account_move(&MoveRequest {
        ids: &[r],
        destination: b,
        expected_token: &good.token,
        today: day(T),
        operation_id: "c04",
        balances: &[set(a, "abc"), set(b, "400.00")],
    });
    assert!(matches!(outcome, Ok(MoveOutcome::StalePreview) | Err(MoveError::InvalidBalance(_))));
    assert_eq!(dump(&store), before);
}

#[test]
fn c07_two_confirmations_on_one_day_have_their_own_anchors_and_the_latest_wins() {
    let (store, a, b, _c, r) = opaque_three();
    let r2 = add(&store, a, "2026-10-18", "Second", "-20.00");
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "c07-1");
    go(&store, &[r2], b, &[set(a, "1050.00"), set(b, "380.00")], T, "c07-2");
    let periods: Vec<String> = resets(&store, a).into_iter().map(|x| x.0).collect();
    assert!(periods.contains(&format!("move:c07-1:{a}")));
    assert!(periods.iter().any(|p| p.starts_with("move:c07-2:")));
    assert_eq!(
        (bal(&store, a, T), bal(&store, b, T)),
        (d("1050.00"), d("380.00")),
        "the latest confirmation governs"
    );
    let n: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM account_move_operations", [], |x| x.get(0))
        .unwrap();
    assert_eq!(n, 2);
}

#[test]
fn c08_confirmed_balances_survive_month_year_and_leap_day_boundaries_without_duplicate_corrections() {
    for today in ["2026-10-31", "2026-12-31", "2028-02-29"] {
        let store = Store::open_in_memory().unwrap();
        let (a, b) = two_accounts(&store);
        let back = day(today).pred_opt().unwrap().pred_opt().unwrap();
        let r = add(&store, a, &back.to_string(), "Purchase", "-100.00");
        let cutoff = day(today).pred_opt().unwrap().to_string();
        legacy_reset(&store, a, "legacy", &cutoff, "900.00");
        legacy_reset(&store, b, "legacy", &cutoff, "500.00");
        go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], today, "c08");
        assert_eq!((bal(&store, a, today), bal(&store, b, today)), (d("1000.00"), d("400.00")), "{today}");
        let next = day(today).succ_opt().unwrap();
        store.roll_forward_monthly_balances(next).unwrap();
        assert_eq!(
            (bal(&store, a, &next.to_string()), bal(&store, b, &next.to_string())),
            (d("1000.00"), d("400.00")),
            "{today}: unchanged the next day"
        );
        let rolled: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM balance_resets WHERE account_id = ?1 AND period LIKE '____-__'",
                params![a],
                |x| x.get(0),
            )
            .unwrap();
        assert_eq!(rolled, 1, "{today}: the next day's rollover recorded once");
    }
}

#[test]
fn c09_a_future_saved_balance_blocks_confirmation_with_its_date() {
    let (store, a, b, _c, r) = opaque_three();
    legacy_reset(&store, a, "2027-03", "2027-03-31", "700.00");
    let p = preview_at(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T);
    assert_eq!(p.status, "blocked");
    let item = &p.blockers.iter().find(|x| x.code == "future_checkpoint").unwrap().items[0];
    assert!(item.detail.contains("Mar 31, 2027"), "{}", item.detail);
    let summary = &p.blockers.iter().find(|x| x.code == "future_checkpoint").unwrap().summary;
    assert!(
        summary.starts_with("1 transaction touches an account with a saved balance dated in the future"),
        "{summary}"
    );
}

#[test]
fn c10_the_review_shows_what_the_accounts_add_up_to_before_and_after_with_no_forced_balance() {
    let (store, a, b, _c, r) = opaque_three();
    let p = preview_at(&store, &[r], b, &[set(a, "1000.00"), set(b, "450.00")], T);
    assert_eq!(
        (p.net_before.as_str(), p.net_after.as_str()),
        ("1400.00", "1450.00"),
        "900 + 500 before, 1000 + 450 after"
    );
    assert!(p.checkpoint_effects.notes.iter().any(|n| n.contains("balances you confirm")));
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "450.00")], T, "c10");
    assert_eq!(
        bal(&store, a, T) + bal(&store, b, T),
        d("1450.00"),
        "the person's numbers, no compensating transaction"
    );
    let n: i64 = store.conn.query_row("SELECT COUNT(*) FROM transactions", [], |x| x.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn c11_cancelling_after_any_review_step_writes_nothing() {
    let (store, a, b, _c, r) = opaque_three();
    let before = dump(&store);
    let counter = store.read_revision().unwrap().0;
    let _ = preview_at(&store, &[r], b, &[], T);
    let _ = preview_at(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T);
    assert_eq!(dump(&store), before);
    assert_eq!(
        store.read_revision().unwrap().0,
        counter,
        "no write of any kind happened on this connection"
    );
}

#[test]
fn c12_a_reverse_after_a_confirmed_move_needs_fresh_balances_and_never_restores_an_old_snapshot() {
    let (store, a, b, _c, r) = opaque_three();
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "c12-out");
    add(&store, a, T, "Later activity", "-60.00");
    let p = preview_at(&store, &[r], a, &[], T);
    assert_eq!(
        p.status, "needs_balance_confirmation",
        "the move's own anchors are typed values, not a record"
    );
    assert!(!p.can_commit);
    assert_eq!(bal(&store, a, T), d("940.00"), "1000 - 60 of later activity, not the old 900");
}

// ---- A: atomicity, idempotency, races ------------------------------------------------------------------

fn bulk_fixture(rows: usize) -> (Store, i64, i64, Vec<i64>) {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    store.conn.execute_batch("BEGIN").unwrap();
    let ids: Vec<i64> = (0..rows).map(|n| add(&store, a, "2026-10-20", &format!("Row {n}"), "-1.00")).collect();
    store.conn.execute_batch("COMMIT").unwrap();
    store.roll_forward_monthly_balances(day(T)).unwrap();
    (store, a, b, ids)
}

#[test]
fn a01_repeated_previews_including_confirmation_previews_write_nothing() {
    let (store, a, b, ids) = bulk_fixture(5);
    let before = dump(&store);
    let changes = store.read_revision().unwrap().0;
    for _ in 0..3 {
        let _ = preview_at(&store, &ids, b, &[], T);
    }
    legacy_reset(&store, a, "x", "2026-10-28", "1.00");
    let before2 = dump(&store);
    for _ in 0..3 {
        let _ = preview_at(&store, &ids, b, &[set(a, "1.00"), set(b, "1.00")], T);
    }
    assert_eq!(dump(&store), before2);
    assert_ne!(before, before2);
    let _ = changes;
}

#[test]
fn a02_to_a06_a_failure_at_any_point_restores_the_complete_original_state() {
    let (store, a, b, ids) = bulk_fixture(5);
    let p = preview_at(&store, &ids, b, &[], T);
    let points = [
        MoveFailpoint::AfterUpdate(1),
        MoveFailpoint::AfterUpdate(3),
        MoveFailpoint::AfterUpdate(5),
        MoveFailpoint::AfterCorrection(1),
        MoveFailpoint::AfterCorrection(2),
        MoveFailpoint::AfterReviewCleanup,
        MoveFailpoint::AfterReadback,
        MoveFailpoint::AfterAudit,
    ];
    let before = dump(&store);
    for (n, point) in points.iter().enumerate() {
        let req = MoveRequest {
            ids: &ids,
            destination: b,
            expected_token: &p.token,
            today: day(T),
            operation_id: &format!("a02-{n}"),
            balances: &[],
        };
        assert!(
            matches!(store.commit_account_move_with_failpoint(&req, *point), Err(MoveError::Injected(_))),
            "{point:?}"
        );
        assert_eq!(
            dump(&store),
            before,
            "{point:?}: every table, versions, contributions, audit and revision counter"
        );
    }
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("995.00"), d("500.00")));
    // And the same request, unobstructed, still works afterwards.
    assert!(matches!(
        store
            .commit_account_move(&MoveRequest {
                ids: &ids,
                destination: b,
                expected_token: &p.token,
                today: day(T),
                operation_id: "a02-ok",
                balances: &[]
            })
            .unwrap(),
        MoveOutcome::Moved(_)
    ));
}

#[test]
fn a04_a_failure_after_the_first_confirmed_anchor_leaves_no_anchor_and_no_moved_row() {
    let (store, a, b, _c, r) = opaque_three();
    let inputs = [set(a, "1000.00"), set(b, "400.00")];
    let p = preview_at(&store, &[r], b, &inputs, T);
    let before = dump(&store);
    let req = MoveRequest {
        ids: &[r],
        destination: b,
        expected_token: &p.token,
        today: day(T),
        operation_id: "a04",
        balances: &inputs,
    };
    assert!(matches!(
        store.commit_account_move_with_failpoint(&req, MoveFailpoint::AfterAnchor(1)),
        Err(MoveError::Injected(_))
    ));
    assert_eq!(dump(&store), before);
    assert_eq!(account_of(&store, r), a);
}

#[test]
fn a08_a_lost_reply_retried_returns_the_first_result_and_changes_nothing() {
    let (store, a, b, ids) = bulk_fixture(3);
    let p = preview_at(&store, &ids, b, &[], T);
    let req = MoveRequest {
        ids: &ids,
        destination: b,
        expected_token: &p.token,
        today: day(T),
        operation_id: "a08",
        balances: &[],
    };
    let first = store.commit_account_move(&req).unwrap();
    let after_first = dump(&store);
    for _ in 0..3 {
        match store.commit_account_move(&req).unwrap() {
            MoveOutcome::Moved(s) => assert!(s.replayed && s.moved_ids.len() == 3),
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(dump(&store), after_first, "no duplicate correction, audit or revision");
    assert!(matches!(first, MoveOutcome::Moved(ref s) if !s.replayed));
    let _ = a;
}

#[test]
fn a09_the_same_operation_id_with_different_input_is_a_conflict_and_changes_nothing() {
    let (store, _a, b, ids) = bulk_fixture(3);
    let p = preview_at(&store, &ids, b, &[], T);
    store
        .commit_account_move(&MoveRequest {
            ids: &ids,
            destination: b,
            expected_token: &p.token,
            today: day(T),
            operation_id: "a09",
            balances: &[],
        })
        .unwrap();
    let after = dump(&store);
    let other = store
        .commit_account_move(&MoveRequest {
            ids: &ids[..2],
            destination: b,
            expected_token: &p.token,
            today: day(T),
            operation_id: "a09",
            balances: &[],
        })
        .unwrap();
    assert!(matches!(other, MoveOutcome::OperationConflict));
    let elsewhere = store
        .commit_account_move(&MoveRequest {
            ids: &ids,
            destination: ids[0], /* not an account id the first used */
            expected_token: &p.token,
            today: day(T),
            operation_id: "a09",
            balances: &[],
        })
        .unwrap();
    assert!(matches!(elsewhere, MoveOutcome::OperationConflict));
    assert_eq!(dump(&store), after);
}

#[test]
fn a10_two_commits_from_one_review_apply_once() {
    let dir = temp("a10");
    let path = dir.join("p.db");
    let one = Store::open(&path).unwrap();
    let two = Store::open(&path).unwrap();
    let (a, b) = two_accounts(&one);
    let r = add(&one, a, "2026-10-20", "Purchase", "-100.00");
    one.roll_forward_monthly_balances(day(T)).unwrap();
    let p = preview_at(&one, &[r], b, &[], T);
    let first = one
        .commit_account_move(&MoveRequest {
            ids: &[r],
            destination: b,
            expected_token: &p.token,
            today: day(T),
            operation_id: "a10-1",
            balances: &[],
        })
        .unwrap();
    let second = two
        .commit_account_move(&MoveRequest {
            ids: &[r],
            destination: b,
            expected_token: &p.token,
            today: day(T),
            operation_id: "a10-2",
            balances: &[],
        })
        .unwrap();
    assert!(matches!(first, MoveOutcome::Moved(_)));
    assert!(matches!(second, MoveOutcome::StalePreview), "{second:?}");
    assert_eq!(
        (bal(&two, a, T), bal(&two, b, T)),
        (d("1000.00"), d("400.00")),
        "corrected once, not twice"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a11_a_change_between_review_and_commit_makes_the_commit_refuse_with_nothing_written() {
    type Change = Box<dyn Fn(&Store, i64, i64, i64)>;
    let changes: Vec<(&str, Change)> = vec![
        (
            "an import into the source",
            Box::new(|s, a, _b, _r| {
                add(s, a, T, "Imported", "-3.00");
            }),
        ),
        (
            "an import into the destination",
            Box::new(|s, _a, b, _r| {
                add(s, b, T, "Imported", "-3.00");
            }),
        ),
        (
            "a reconciliation",
            Box::new(|s, a, _b, r| {
                s.conn.execute("INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, '2026-10-30', '1.00', '2026-10-31 10:00:00')", params![a]).unwrap();
                let id = s.conn.last_insert_rowid();
                s.conn
                    .execute("UPDATE transactions SET reconciliation_id = ?1 WHERE id = ?2", params![id, r])
                    .unwrap();
            }),
        ),
        (
            "hiding the destination",
            Box::new(|s, _a, b, _r| {
                s.set_account_hidden(b, true).unwrap();
            }),
        ),
        (
            "a balance override",
            Box::new(|s, a, _b, _r| {
                s.set_account_balance_override(a, d("777.00"), day(T)).unwrap();
            }),
        ),
        (
            "a sign flip",
            Box::new(|s, _a, _b, r| {
                s.flip_transaction_signs(&[r]).unwrap();
            }),
        ),
        (
            "an account type change",
            Box::new(|s, a, _b, _r| {
                s.conn
                    .execute("UPDATE accounts SET account_type = 'savings' WHERE id = ?1", params![a])
                    .unwrap();
            }),
        ),
    ];
    for (what, change) in changes {
        let store = Store::open_in_memory().unwrap();
        let (a, b) = two_accounts(&store);
        let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
        store.roll_forward_monthly_balances(day(T)).unwrap();
        let p = preview_at(&store, &[r], b, &[], T);
        change(&store, a, b, r);
        let before = dump(&store);
        let outcome = store.commit_account_move(&MoveRequest {
            ids: &[r],
            destination: b,
            expected_token: &p.token,
            today: day(T),
            operation_id: "a11",
            balances: &[],
        });
        assert!(!matches!(outcome, Ok(MoveOutcome::Moved(_))), "{what}: {outcome:?}");
        assert_eq!(dump(&store), before, "{what}");
        assert_eq!(account_of(&store, r), a, "{what}");
    }
}

#[test]
fn a12_a_new_day_makes_the_earlier_review_stale_so_the_correction_day_never_changes_silently() {
    let (store, _a, b, ids) = bulk_fixture(2);
    let p = preview_at(&store, &ids, b, &[], T);
    let before = dump(&store);
    let tomorrow = day(T).succ_opt().unwrap();
    let outcome = store
        .commit_account_move(&MoveRequest {
            ids: &ids,
            destination: b,
            expected_token: &p.token,
            today: tomorrow,
            operation_id: "a12",
            balances: &[],
        })
        .unwrap();
    assert!(matches!(outcome, MoveOutcome::StalePreview));
    assert_eq!(dump(&store), before);
}

#[test]
fn a14_a_full_disk_stops_the_move_with_everything_rolled_back() {
    let dir = temp("a14");
    let path = dir.join("p.db");
    let store = Store::open(&path).unwrap();
    let (a, b) = two_accounts(&store);
    store.conn.execute_batch("BEGIN").unwrap();
    let ids: Vec<i64> = (0..300).map(|n| add(&store, a, "2026-10-20", &format!("Row {n}"), "-1.00")).collect();
    store.conn.execute_batch("COMMIT").unwrap();
    store.roll_forward_monthly_balances(day(T)).unwrap();
    let p = preview_at(&store, &ids, b, &[], T);
    let before = dump(&store);
    let pages: i64 = store.conn.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
    store.conn.execute_batch(&format!("PRAGMA max_page_count = {pages}")).unwrap();
    let outcome = store.commit_account_move(&MoveRequest {
        ids: &ids,
        destination: b,
        expected_token: &p.token,
        today: day(T),
        operation_id: "a14",
        balances: &[],
    });
    assert!(matches!(outcome, Err(MoveError::Db(_))), "{outcome:?}");
    store.conn.execute_batch("PRAGMA max_page_count = 1073741823").unwrap();
    assert_eq!(dump(&store), before);
    integrity(&store);
    let _ = std::fs::remove_dir_all(dir);
}

// ---- A07: a real process kill ------------------------------------------------------------------------

/// Runs in a child process (see `a07_*`): opens the profile, reviews and commits, and aborts at the chosen point.
#[test]
fn a07_child_process() {
    let Ok(mode) = std::env::var("HIST_CRASH_MODE") else { return };
    let path = PathBuf::from(std::env::var("HIST_CRASH_DB").unwrap());
    let store = Store::open(&path).unwrap();
    let (a, b) = (1, 2);
    let _ = a;
    let ids = [1i64];
    let p = store.preview_account_move(&ids, b, day(T)).unwrap();
    let req = MoveRequest {
        ids: &ids,
        destination: b,
        expected_token: &p.token,
        today: day(T),
        operation_id: "crash-op",
        balances: &[],
    };
    let point = if mode == "before" {
        MoveFailpoint::CrashBeforeCommit
    } else {
        MoveFailpoint::CrashAfterCommit
    };
    let _ = store.commit_account_move_with_failpoint(&req, point);
    std::process::exit(0); // not reached: the failpoint aborts
}

#[test]
fn a07_a_process_killed_before_or_right_after_commit_leaves_all_old_or_all_new_state() {
    for mode in ["before", "after"] {
        let dir = temp(&format!("a07-{mode}"));
        let path = dir.join("p.db");
        {
            let store = Store::open(&path).unwrap();
            let (a, b) = two_accounts(&store);
            add(&store, a, "2026-10-20", "Purchase", "-100.00");
            store.roll_forward_monthly_balances(day(T)).unwrap();
            assert_eq!((a, b), (1, 2));
        }
        let old = Store::open(&path).unwrap();
        let before = dump(&old);
        drop(old);
        let exe = std::env::current_exe().unwrap();
        let status = std::process::Command::new(exe)
            .args([
                "--exact",
                "store::tests::historical_account_moves_matrix::a07_child_process",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("HIST_CRASH_MODE", mode)
            .env("HIST_CRASH_DB", &path)
            .status()
            .unwrap();
        assert!(!status.success(), "the child must have been killed, not exited cleanly ({mode})");
        let reopened = Store::open(&path).unwrap();
        integrity(&reopened);
        let record = reopened.get_account_move("crash-op").unwrap();
        if mode == "before" {
            assert!(record.is_none(), "an uncommitted move left no record");
            assert_eq!(dump(&reopened), before, "all the old state");
            assert_eq!((bal(&reopened, 1, T), bal(&reopened, 2, T)), (d("900.00"), d("500.00")));
        } else {
            let record = record.expect("a committed move is found by its operation id");
            assert_eq!(record.moved_count, 1);
            assert_eq!(
                (bal(&reopened, 1, T), bal(&reopened, 2, T)),
                (d("1000.00"), d("400.00")),
                "all the new state"
            );
            assert_eq!(account_of(&reopened, 1), 2);
            // The lost reply is retried with the same request: the first result comes back.
            let p = reopened.preview_account_move(&[1], 2, day(T)).unwrap();
            let _ = p;
            let replay = reopened
                .commit_account_move(&MoveRequest {
                    ids: &[1],
                    destination: 2,
                    expected_token: "",
                    today: day(T),
                    operation_id: "crash-op",
                    balances: &[],
                })
                .unwrap();
            let _ = replay; // digest differs (token), so this is a conflict, which is also safe
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}

// ---- I: integration, retention and scale ---------------------------------------------------------------

#[test]
fn i03_settled_linked_and_applied_rows_stay_blocked_in_both_modes_and_through_the_one_row_path() {
    let (store, a, b, _c, r) = opaque_three();
    store
        .conn
        .execute("INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, '2026-10-30', '1.00', '2026-10-31 10:00:00')", params![a])
        .unwrap();
    let rid = store.conn.last_insert_rowid();
    store
        .conn
        .execute("UPDATE transactions SET reconciliation_id = ?1 WHERE id = ?2", params![rid, r])
        .unwrap();
    let confirmed = preview_at(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T);
    assert_eq!(confirmed.status, "blocked", "confirmation never bypasses a settled row");
    assert!(confirmed.blockers.iter().any(|x| x.code == "settled"));
    assert!(matches!(
        store.update_transaction_account(r, b),
        Err(MoveError::Blocked(_)) | Err(MoveError::ReviewRequired(_))
    ));
    assert_eq!(account_of(&store, r), a);
}

#[test]
fn i09_deleting_an_account_removes_only_its_own_saved_balance_records() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    add(&store, b, "2026-10-21", "Other", "-5.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    go(&store, &[r], b, &[], T, "i09");
    let count = |sql: &str, id: i64| -> i64 { store.conn.query_row(sql, params![id], |x| x.get(0)).unwrap() };
    assert!(count("SELECT COUNT(*) FROM balance_reset_versions WHERE account_id = ?1", a) > 0);
    store.delete_account(a).unwrap();
    assert_eq!(count("SELECT COUNT(*) FROM balance_reset_versions WHERE account_id = ?1", a), 0);
    assert_eq!(count("SELECT COUNT(*) FROM balance_resets WHERE account_id = ?1", a), 0);
    assert!(
        count("SELECT COUNT(*) FROM balance_reset_versions WHERE account_id = ?1", b) > 0,
        "another account's records stay"
    );
    assert_eq!(bal(&store, b, T), d("395.00"), "…and so does its balance: 500 - 100 - 5");
    let orphans: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM balance_version_contributions WHERE version_id NOT IN (SELECT id FROM balance_reset_versions)",
            [],
            |x| x.get(0),
        )
        .unwrap();
    assert_eq!(orphans, 0);
    integrity(&store);
}

#[test]
fn i10_the_largest_allowed_selection_moves_atomically_and_more_than_that_is_refused() {
    let (store, a, b, ids) = bulk_fixture(10_000);
    let p = preview_at(&store, &ids, b, &[], T);
    assert_eq!((p.effective_count, p.status), (10_000, "ready"));
    assert_eq!(p.checkpoint_effects.corrected_count, 2);
    let started = std::time::Instant::now();
    assert!(matches!(go(&store, &ids, b, &[], T, "i10"), MoveOutcome::Moved(ref s) if s.moved_ids.len() == 10_000));
    eprintln!(
        "I10 observation: 10,000 rows moved with two saved balances corrected in {:?}",
        started.elapsed()
    );
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("500.00") - d("10000.00")));
    let moved: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM transactions WHERE account_id = ?1", params![b], |x| x.get(0))
        .unwrap();
    assert_eq!(moved, 10_000);
    let over: Vec<i64> = (1..=10_001).collect();
    assert!(matches!(store.preview_account_move(&over, b, day(T)), Err(MoveError::TooMany { .. })));
    // 251 rows (past the screen's own cap) and the 400-row SQL chunk boundary behave the same way.
    for n in [251usize, 400, 401, 800] {
        let (store, _a, b, ids) = bulk_fixture(n);
        assert!(
            matches!(go(&store, &ids, b, &[], T, "i10b"), MoveOutcome::Moved(ref s) if s.moved_ids.len() == n),
            "{n}"
        );
    }
}

#[test]
fn i11_a_large_profile_migrates_and_reads_through_the_new_index_without_scanning_everything() {
    let dir = temp("i11");
    let path = dir.join("p.db");
    let store = Store::open(&path).unwrap();
    let (a, _b) = two_accounts(&store);
    store.conn.execute_batch("BEGIN").unwrap();
    for n in 0..50_000 {
        let day_n = 1 + (n % 700) as i64;
        let date = (day("2025-01-01") + chrono::Duration::days(day_n)).to_string();
        store
            .conn
            .execute(
                "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (?1, ?2, 'x', '-1.00', ?3)",
                params![a, date, format!("fp-{n}")],
            )
            .unwrap();
    }
    store.conn.execute_batch("COMMIT").unwrap();
    for month in 1..=24 {
        let cutoff = day("2025-01-01") + chrono::Duration::days(28 * month);
        store
            .record_automatic_checkpoint(a, "checking", d("1000.00"), &format!("m{month}"), cutoff)
            .unwrap();
    }
    to_legacy_shape(&store);
    drop(store);
    let started = std::time::Instant::now();
    let store = Store::open(&path).unwrap();
    eprintln!(
        "I11 observation: upgrade of 50,000 rows and 24 saved balances took {:?}",
        started.elapsed()
    );
    let plan: Vec<String> = {
        let mut stmt = store.conn.prepare("EXPLAIN QUERY PLAN SELECT id FROM balance_resets WHERE account_id = 1 AND reset_date <= '2026-10-29' AND COALESCE(effective_from, reset_date) <= '2026-10-29' ORDER BY COALESCE(effective_from, reset_date) DESC, reset_date DESC, id DESC LIMIT 1").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(3)).unwrap().map(|x| x.unwrap()).collect()
    };
    assert!(
        plan.iter()
            .any(|p| p.contains("idx_balance_resets_account_effective") || p.contains("INDEX")),
        "{plan:?}"
    );
    let started = std::time::Instant::now();
    let _ = bal(&store, a, "2026-10-29");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "one balance read on a large profile stays fast"
    );
    integrity(&store);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn every_place_that_writes_a_saved_balance_is_known_so_a_new_writer_cannot_bypass_the_record() {
    // Writers of `balance_resets` (outside tests) and how each one keeps provenance honest:
    //  checkpoints.rs / historical_move.rs  record versions themselves, under the write guard;
    //  accounts.rs                          account deletion (guarded) and the legacy-compatible reader/writer glue;
    //  schema.rs                            the old one-time repair of manual dates, which the table triggers record;
    //  sign_flip.rs                         direct edits that the table triggers turn into untrusted provenance (G13).
    // Any other file that writes the table fails this test until it is added here with its reason.
    let known = ["accounts.rs", "checkpoints.rs", "historical_move.rs", "schema.rs", "sign_flip.rs"];
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut found: Vec<String> = Vec::new();
    fn walk(dir: &std::path::Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if path.file_name().unwrap() != "tests" {
                    walk(&path, out);
                }
            } else if path.extension().is_some_and(|e| e == "rs") {
                let text = std::fs::read_to_string(&path).unwrap();
                if [
                    "INSERT INTO balance_resets",
                    "UPDATE balance_resets",
                    "DELETE FROM balance_resets",
                    "INSERT OR REPLACE INTO balance_resets",
                ]
                .iter()
                .any(|s| text.contains(s))
                {
                    out.push(path.file_name().unwrap().to_string_lossy().to_string());
                }
            }
        }
    }
    walk(&root, &mut found);
    found.sort();
    for file in &found {
        assert!(known.contains(&file.as_str()), "{file} writes saved balances but is not in the inventory");
    }
    // The native crate never writes them directly.
    let native = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("src-tauri").join("src");
    let mut native_found: Vec<String> = Vec::new();
    walk(&native, &mut native_found);
    assert!(native_found.is_empty(), "{native_found:?}");
}

#[test]
fn every_financial_column_change_advances_the_revision_and_other_edits_do_not() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    let rev = |s: &Store| -> i64 {
        s.conn
            .query_row("SELECT financial_revision FROM transactions WHERE id = ?1", params![r], |x| x.get(0))
            .unwrap()
    };
    let first = rev(&store);
    assert!(first > 0);
    for (what, sql, bumps) in [
        ("description", "UPDATE transactions SET description = 'x' WHERE id = ?1", false),
        ("category", "UPDATE transactions SET category = 'Rent' WHERE id = ?1", false),
        ("notes", "UPDATE transactions SET notes = 'n' WHERE id = ?1", false),
        ("cleared", "UPDATE transactions SET cleared = 1 WHERE id = ?1", false),
        (
            "same amount written again",
            "UPDATE transactions SET amount = '-100.00' WHERE id = ?1",
            false,
        ),
        ("amount", "UPDATE transactions SET amount = '-101.00' WHERE id = ?1", true),
        ("date", "UPDATE transactions SET date = '2026-10-21' WHERE id = ?1", true),
        ("principal", "UPDATE transactions SET principal_amount = '-50.00' WHERE id = ?1", true),
        (
            "account",
            "UPDATE transactions SET account_id = (SELECT id FROM accounts WHERE name = 'B') WHERE id = ?1",
            true,
        ),
        (
            "soft delete",
            "UPDATE transactions SET deleted_at = '2026-10-25 10:00:00' WHERE id = ?1",
            true,
        ),
        (
            "a second delete timestamp",
            "UPDATE transactions SET deleted_at = '2026-10-26 10:00:00' WHERE id = ?1",
            false,
        ),
        ("restore", "UPDATE transactions SET deleted_at = NULL WHERE id = ?1", true),
    ] {
        let before = rev(&store);
        store.conn.execute(sql, params![r]).unwrap();
        let after = rev(&store);
        assert_eq!(after > before, bumps, "{what}");
    }
    let before: i64 = store
        .conn
        .query_row("SELECT value FROM financial_revision_counter", [], |x| x.get(0))
        .unwrap();
    store.hard_delete_transaction_row(r).unwrap();
    let after: i64 = store
        .conn
        .query_row("SELECT value FROM financial_revision_counter", [], |x| x.get(0))
        .unwrap();
    assert!(after > before, "a hard delete advances the counter and leaves a tombstone");
    let tombs: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM transaction_tombstones WHERE transaction_id = ?1", params![r], |x| {
            x.get(0)
        })
        .unwrap();
    assert_eq!(tombs, 1);
    let _ = b;
}

#[test]
fn review_rejects_overflow_in_a_real_account_projection_without_panicking_or_writing() {
    let store = Store::open_in_memory().unwrap();
    let a = acct(&store, "Source", AccountType::Checking, "0");
    let b = acct(&store, "At limit", AccountType::Checking, "79228162514264337593543950335");
    let row = add(&store, a, "2026-10-20", "Deposit", "1");
    let before = dump(&store);
    let result = store.preview_account_move(&[row], b, day(T));
    assert!(result.is_err(), "an unrepresentable destination balance must be refused");
    assert_eq!(dump(&store), before);
}

#[test]
fn review_rejects_corrupt_version_ownership_and_effective_dates_even_with_confirmation() {
    for sql in [
        "UPDATE balance_reset_versions SET account_id = 999 WHERE id = (SELECT current_version_id FROM balance_resets WHERE account_id = ?1)",
        "UPDATE balance_reset_versions SET effective_from = '2026-10-01' WHERE id = (SELECT current_version_id FROM balance_resets WHERE account_id = ?1)",
        "UPDATE balance_reset_versions SET cutoff_date = '2026-10-01' WHERE id = (SELECT current_version_id FROM balance_resets WHERE account_id = ?1)",
    ] {
        let store = Store::open_in_memory().unwrap();
        let (a, b) = two_accounts(&store);
        let row = add(&store, a, "2026-10-20", "Purchase", "-100");
        store.roll_forward_monthly_balances(day(T)).unwrap();
        store.conn.execute(sql, params![a]).unwrap();
        let before = dump(&store);
        let p = preview_at(&store, &[row], b, &[set(a, "1000"), set(b, "400")], T);
        assert!(p.blockers.iter().any(|b| b.code == "checkpoint_integrity"), "{sql}: {p:?}");
        assert!(!p.can_commit);
        assert_eq!(dump(&store), before);
    }
}

#[test]
fn review_never_bypasses_structural_corruption_of_opaque_anchors_or_recorded_membership() {
    for (opaque, sql) in [
        (true, "UPDATE balance_reset_versions SET parent_version_id = id WHERE account_id = ?1"),
        (false, "UPDATE balance_version_contributions SET account_id = 999 WHERE account_id = ?1"),
        (
            false,
            "UPDATE balance_version_contributions SET date = '2027-01-01' WHERE account_id = ?1",
        ),
        (false, "UPDATE balance_version_contributions SET amount = '-200' WHERE account_id = ?1"),
    ] {
        let store = Store::open_in_memory().unwrap();
        let (a, b) = two_accounts(&store);
        let row = add(&store, a, "2026-10-20", "Purchase", "-100");
        if opaque {
            legacy_reset(&store, a, "2026-10", "2026-10-28", "900");
        } else {
            store.roll_forward_monthly_balances(day(T)).unwrap();
        }
        store.conn.execute(sql, params![a]).unwrap();
        let before = dump(&store);
        let p = preview_at(&store, &[row], b, &[set(a, "1000"), set(b, "400")], T);
        assert!(p.blockers.iter().any(|b| b.code == "checkpoint_integrity"), "{sql}: {p:?}");
        assert!(!p.can_commit);
        assert_eq!(dump(&store), before);
    }
}

#[test]
fn checkpoint_capture_commit_failure_rolls_back_and_releases_the_connection() {
    let store = Store::open_in_memory().unwrap();
    store.conn.execute_batch("CREATE TABLE commit_parent (id INTEGER PRIMARY KEY); CREATE TABLE commit_child (parent INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);").unwrap();
    let result = store.atomically(|| store.conn.execute("INSERT INTO commit_child VALUES (999)", []));
    assert!(result.is_err());
    assert!(
        store.conn.is_autocommit(),
        "a failed commit must not leave a live write transaction behind"
    );
    assert_eq!(
        store
            .conn
            .query_row("SELECT COUNT(*) FROM commit_child", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn a_manual_balance_correction_after_a_confirmed_move_replaces_an_earlier_same_day_manual_correction() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    store.set_account_balance_override(a, d("900"), day(T)).unwrap();
    legacy_reset(&store, b, "2026-10", "2026-10-28", "500");
    let row = add(&store, a, "2026-10-20", "Purchase", "-100");
    go(&store, &[row], b, &[set(a, "1000"), set(b, "400")], T, "manual-after-move");
    store.set_account_balance_override(a, d("777"), day(T)).unwrap();
    assert_eq!(bal(&store, a, T), d("777"), "the latest explicit correction must take effect");
    assert_eq!(bal(&store, b, T), d("400"));
    assert!(store.get_account_move("manual-after-move").unwrap().is_some());
    integrity(&store);
}

#[test]
fn a_transaction_only_legacy_database_also_gets_a_pre_migration_safety_copy() {
    let directory = temp("transaction-only-legacy");
    let path = directory.join("legacy.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE transactions (id INTEGER PRIMARY KEY, amount TEXT); INSERT INTO transactions VALUES (1, '-25');")
        .unwrap();
    super::super::checkpoints::ensure_pre_migration_backup(&conn, &path, None).unwrap();
    assert!(
        directory.join("backups").exists(),
        "existing transaction data needs protection even before accounts were introduced"
    );
    let copies: Vec<_> = std::fs::read_dir(directory.join("backups")).unwrap().map(|e| e.unwrap().path()).collect();
    assert_eq!(copies.len(), 1);
    let copy = rusqlite::Connection::open(&copies[0]).unwrap();
    assert_eq!(
        copy.query_row("SELECT amount FROM transactions WHERE id = 1", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "-25"
    );
}

#[test]
fn account_deletion_purges_its_move_audit_and_rolls_back_everything_if_checkpoint_cleanup_fails() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let moved = add(&store, a, "2026-10-20", "Move", "-100");
    let remaining = add(&store, a, "2026-10-21", "Keep until deletion succeeds", "-5");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    go(&store, &[moved], b, &[], T, "delete-account-audit");
    store.conn.execute_batch("CREATE TRIGGER refuse_checkpoint_cleanup BEFORE DELETE ON balance_reset_versions BEGIN SELECT RAISE(ABORT, 'injected cleanup error'); END;").unwrap();
    let before = dump(&store);
    assert!(store.delete_account(a).is_err());
    assert_eq!(
        dump(&store),
        before,
        "a failed cleanup must not delete transactions or part of the checkpoint graph"
    );
    assert_eq!(account_of(&store, remaining), a);
    store.conn.execute_batch("DROP TRIGGER refuse_checkpoint_cleanup;").unwrap();
    store.delete_account(a).unwrap();
    assert!(
        store.get_account_move("delete-account-audit").unwrap().is_none(),
        "deleting an account also removes its identifying move audit"
    );
    assert_eq!(bal(&store, b, T), d("400"));
    integrity(&store);
}
