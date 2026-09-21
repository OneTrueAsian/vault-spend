//! Encrypted-database support for `Store`: opening with a key now, copying between plaintext and
//! encrypted files in the next task. It lives beside `store.rs` so it can reach `Store`'s private
//! fields (plan v2 sections 4.2 and 4.6).
use super::Store;
use std::fmt;
use std::path::Path;
use zeroize::Zeroizing;

pub enum DatabaseKey<'a> {
    Plaintext,
    Raw(&'a [u8; 32]),
}

#[derive(Debug)]
pub enum StoreOpenError {
    /// The file is not there. Unlike `Store::open`, opening with a key never creates one.
    Missing,
    /// SQLCipher cannot tell a wrong key from a file that is not a database. A caller that holds a
    /// key it has just unwrapped can treat this as a damaged or mismatched file.
    NotADatabaseOrWrongKey,
    Sqlite(rusqlite::Error),
}

impl fmt::Display for StoreOpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreOpenError::Missing => write!(f, "the data file was not found"),
            StoreOpenError::NotADatabaseOrWrongKey => write!(f, "the data file could not be opened with this key"),
            StoreOpenError::Sqlite(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for StoreOpenError {}

/// `PRAGMA key` with a raw 32-byte key in SQLCipher's `x'<hex>'` form. The hex of the key is the
/// only thing ever formatted into the statement; a password never reaches SQL.
pub(super) fn key_pragma(key: &[u8; 32]) -> String {
    let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    format!("PRAGMA key = \"x'{hex}'\";")
}

impl Store {
    /// Opens an existing database, plaintext or encrypted, and runs the normal migrations only
    /// after the key has been proven right by a real read.
    pub fn open_with_key(path: impl AsRef<Path>, key: DatabaseKey<'_>) -> Result<Store, StoreOpenError> {
        let path = path.as_ref();
        if !path.exists() {
            return Err(StoreOpenError::Missing);
        }
        let conn = rusqlite::Connection::open(path).map_err(StoreOpenError::Sqlite)?;
        let db_key = match key {
            DatabaseKey::Plaintext => None,
            DatabaseKey::Raw(bytes) => {
                conn.execute_batch(&key_pragma(bytes)).map_err(StoreOpenError::Sqlite)?;
                Some(Zeroizing::new(*bytes))
            }
        };
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0))
            .map_err(|e| match e {
                rusqlite::Error::SqliteFailure(failure, _) if failure.code == rusqlite::ErrorCode::NotADatabase => {
                    StoreOpenError::NotADatabaseOrWrongKey
                }
                other => StoreOpenError::Sqlite(other),
            })?;
        // The debug-only activity log holds account names and balances in plain text, so an
        // encrypted profile never gets one.
        let activity_log_path = if cfg!(debug_assertions) && db_key.is_none() {
            path.parent().map(|dir| dir.join("account-changes.log"))
        } else {
            None
        };
        let store = Store {
            conn,
            activity_log_path,
            db_key,
        };
        store.init_schema().map_err(StoreOpenError::Sqlite)?;
        Ok(store)
    }

    pub fn is_encrypted(&self) -> bool {
        self.db_key.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::path::PathBuf;

    const KEY_A: [u8; 32] = [0x11; 32];
    const KEY_B: [u8; 32] = [0x22; 32];

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-store-enc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An empty encrypted database file, made with plain rusqlite so these tests do not depend
    /// on the copy primitives added in the next task.
    fn make_encrypted_file(path: &Path, key: &[u8; 32]) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(&key_pragma(key)).unwrap();
        conn.execute_batch("CREATE TABLE seed(x TEXT);").unwrap();
    }

    #[test]
    fn opening_with_a_key_refuses_a_missing_file_and_does_not_create_it() {
        let dir = temp_dir("missing");
        let path = dir.join("nope.db");

        for key in [DatabaseKey::Plaintext, DatabaseKey::Raw(&KEY_A)] {
            assert!(matches!(Store::open_with_key(&path, key), Err(StoreOpenError::Missing)));
        }
        assert!(!path.exists());
    }

    #[test]
    fn an_encrypted_file_opens_with_its_key_and_keeps_what_is_written() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("enc.db");
        make_encrypted_file(&path, &KEY_A);

        {
            let store = Store::open_with_key(&path, DatabaseKey::Raw(&KEY_A)).unwrap();
            assert!(store.is_encrypted());
            store.create_category("Groceries", None).unwrap();
        }

        let reopened = Store::open_with_key(&path, DatabaseKey::Raw(&KEY_A)).unwrap();
        assert!(reopened.list_categories().unwrap().contains(&"Groceries".to_string()));
        let header = std::fs::read(&path).unwrap();
        assert_ne!(&header[..16], b"SQLite format 3\0", "the file on disk stays encrypted");
    }

    #[test]
    fn the_wrong_key_or_no_key_fails_the_same_way() {
        let dir = temp_dir("wrong");
        let path = dir.join("enc.db");
        make_encrypted_file(&path, &KEY_A);

        for key in [DatabaseKey::Raw(&KEY_B), DatabaseKey::Plaintext] {
            assert!(matches!(Store::open_with_key(&path, key), Err(StoreOpenError::NotADatabaseOrWrongKey)));
        }
    }

    #[test]
    fn a_key_on_a_plaintext_file_fails() {
        let dir = temp_dir("plain-with-key");
        let path = dir.join("plain.db");
        drop(Store::open(&path).unwrap());

        assert!(matches!(
            Store::open_with_key(&path, DatabaseKey::Raw(&KEY_A)),
            Err(StoreOpenError::NotADatabaseOrWrongKey)
        ));
    }

    #[test]
    fn a_plaintext_file_opens_through_the_keyed_api_and_is_not_encrypted() {
        let dir = temp_dir("plain");
        let path = dir.join("plain.db");
        drop(Store::open(&path).unwrap());

        let store = Store::open_with_key(&path, DatabaseKey::Plaintext).unwrap();

        assert!(!store.is_encrypted());
    }

    #[test]
    fn an_encrypted_store_never_writes_the_plaintext_debug_activity_log() {
        let dir = temp_dir("log");
        let path = dir.join("enc.db");
        make_encrypted_file(&path, &KEY_A);

        let store = Store::open_with_key(&path, DatabaseKey::Raw(&KEY_A)).unwrap();

        assert!(store.activity_log_path.is_none());
    }

    #[test]
    fn the_key_pragma_is_the_hex_of_the_raw_key_and_nothing_else() {
        assert_eq!(key_pragma(&[0xab; 32]), format!("PRAGMA key = \"x'{}'\";", "ab".repeat(32)));
    }
}
