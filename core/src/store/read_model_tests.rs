use super::*;
use crate::models::AccountType;
struct Temp(std::path::PathBuf);
impl Temp {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "vault-read-model-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn fixture(store: &Store, description: &str, day: u32) -> i64 {
    let account = store.get_or_create_account("Fixture", AccountType::Checking).unwrap();
    store
        .create_transaction(
            account,
            &Transaction {
                date: NaiveDate::from_ymd_opt(2026, 10, day).unwrap(),
                description: description.into(),
                amount: Decimal::from(-20),
                category: Some("Food".into()),
            },
            None,
        )
        .unwrap()
}

#[test]
fn snapshots_reject_and_roll_back_accidental_writes() {
    let store = Store::open_in_memory().unwrap();
    let count = store.all_transactions().unwrap().len();
    let result = store.read_snapshot(|store| {
        store.conn.execute("INSERT INTO categories(name) VALUES ('Accidental')", [])?;
        Ok(())
    });
    assert!(result.is_err());
    assert_eq!(store.all_transactions().unwrap().len(), count);
    assert!(!store.list_categories().unwrap().contains(&"Accidental".to_string()));
    assert!(store.conn.is_autocommit());
}

#[test]
fn a_cache_computed_from_rolled_back_rows_is_never_reused() {
    let store = Store::open_in_memory().unwrap();
    fixture(&store, "Fixture market", 1);
    fixture(&store, "Fixture market", 2);
    assert_eq!(store.anomaly_flags().unwrap().len(), 2);
    assert!(
        store
            .read_snapshot(|store| {
                store.conn.execute("UPDATE transactions SET deleted_at = '2026-10-08 10:00:00'", [])?;
                assert!(store.anomaly_flags()?.is_empty());
                Ok(())
            })
            .is_err()
    );
    assert_eq!(store.anomaly_flags().unwrap().len(), 2);
}

#[test]
fn anomaly_cache_invalidates_on_local_edits_deletion_restore_and_dismissal() {
    let store = Store::open_in_memory().unwrap();
    let first = fixture(&store, "Fixture market", 1);
    fixture(&store, "Fixture market", 2);
    let flags = store.anomaly_flags().unwrap();
    assert_eq!(flags.len(), 2);
    let cache = store.anomaly_cache.borrow().as_ref().unwrap().revision;
    assert_eq!(store.anomaly_flags().unwrap(), flags);
    assert_eq!(store.anomaly_cache.borrow().as_ref().unwrap().revision, cache);
    store.dismiss_anomaly(first, "duplicate").unwrap();
    assert_eq!(store.open_anomaly_flags().unwrap().len(), 1);
    assert_eq!(store.anomaly_flags().unwrap().len(), 2);
    store.delete_transaction(first, chrono::Local::now().naive_local()).unwrap();
    assert!(store.anomaly_flags().unwrap().is_empty());
    store.restore_transactions(&[first]).unwrap();
    assert_eq!(store.anomaly_flags().unwrap().len(), 2);
    store.update_transaction_amount(first, Decimal::from(-21)).unwrap();
    assert!(store.anomaly_flags().unwrap().is_empty());
}

#[test]
fn external_commits_do_not_mix_a_snapshot_or_leave_a_warm_cache_stale() {
    let temp = Temp::new();
    let path = temp.path().join("fixture.db");
    let store = Store::open(&path).unwrap();
    store.conn.execute_batch("PRAGMA journal_mode=WAL").unwrap();
    fixture(&store, "Fixture market", 1);
    fixture(&store, "Fixture market", 2);
    assert_eq!(store.anomaly_flags().unwrap().len(), 2);
    let external = Connection::open(&path).unwrap();
    let before = store.read_revision().unwrap();
    store
        .read_snapshot(|store| {
            let count = store.all_transactions()?.len();
            external.execute("UPDATE transactions SET deleted_at = '2026-10-08 10:00:00'", [])?;
            assert_eq!(store.all_transactions()?.len(), count);
            assert_eq!(store.anomaly_flags()?.len(), 2);
            Ok(())
        })
        .unwrap();
    assert_ne!(store.read_revision().unwrap().1, before.1);
    assert!(store.anomaly_flags().unwrap().is_empty());
    drop(store);
    let reopened = Store::open(path).unwrap();
    assert!(reopened.anomaly_cache.borrow().is_none());
    assert!(reopened.anomaly_flags().unwrap().is_empty());
}

#[test]
fn protected_reopen_never_reuses_a_previous_store_cache() {
    let temp = Temp::new();
    let path = temp.path().join("protected.db");
    let key = [37; 32];
    Store::open_in_memory().unwrap().export_encrypted_copy(&path, &key).unwrap();
    let store = Store::open_with_key(&path, DatabaseKey::Raw(&key)).unwrap();
    fixture(&store, "Fixture market", 1);
    fixture(&store, "Fixture market", 2);
    assert_eq!(store.anomaly_flags().unwrap().len(), 2);
    drop(store);
    let store = Store::open_with_key(path, DatabaseKey::Raw(&key)).unwrap();
    assert!(store.anomaly_cache.borrow().is_none());
    assert_eq!(store.anomaly_flags().unwrap().len(), 2);
}
