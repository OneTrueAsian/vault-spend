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

fn hex(key: &[u8; 32]) -> String {
    key.iter().map(|b| format!("{b:02x}")).collect()
}

/// `PRAGMA key` with a raw 32-byte key in SQLCipher's `x'<hex>'` form. The hex of the key is the
/// only thing ever formatted into the statement; a password never reaches SQL.
pub(super) fn key_pragma(key: &[u8; 32]) -> String {
    format!("PRAGMA key = \"x'{}'\";", hex(key))
}

fn has_plain_header(path: &Path) -> std::io::Result<bool> {
    use std::io::Read;
    let mut header = [0u8; 16];
    let read = std::fs::File::open(path)?.read(&mut header)?;
    Ok(read == 16 && &header == b"SQLite format 3\0")
}

fn quote_path(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

fn refuse_existing(dest: &Path) -> rusqlite::Result<()> {
    if dest.exists() {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
            Some(format!("{} already exists; a copy never overwrites a file", dest.display())),
        ));
    }
    Ok(())
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

impl Store {
    /// A new encrypted file holding everything in this database, under `new_key`. Works from a
    /// plaintext or an encrypted store, so it enables protection and re-keys. Never overwrites.
    pub fn export_encrypted_copy(&self, dest: &Path, new_key: &[u8; 32]) -> rusqlite::Result<()> {
        self.export_to(dest, &format!("\"x'{}'\"", hex(new_key)))
    }

    /// A new plaintext file holding everything in this database (used to remove protection).
    pub fn export_plaintext_copy(&self, dest: &Path) -> rusqlite::Result<()> {
        self.export_to(dest, "''")
    }

    fn export_to(&self, dest: &Path, key_clause: &str) -> rusqlite::Result<()> {
        refuse_existing(dest)?;
        // `sqlcipher_export` copies the tables and indexes but not `user_version`.
        let user_version: i64 = self.conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        self.conn
            .execute_batch(&format!("ATTACH DATABASE '{}' AS export_target KEY {key_clause};", quote_path(dest)))?;
        let copied = self
            .conn
            .query_row("SELECT sqlcipher_export('export_target')", [], |_| Ok(()))
            .and_then(|_| self.conn.execute_batch(&format!("PRAGMA export_target.user_version = {user_version};")));
        let detached = self.conn.execute_batch("DETACH DATABASE export_target;");
        if copied.is_err() {
            let _ = std::fs::remove_file(dest); // never leave a half-written copy behind
        }
        copied.and(detached)
    }

    /// Read-only check that `dest` is a faithful copy of this database in the expected form:
    /// right kind of file, healthy, same `user_version`, same tables, same row counts.
    pub fn verify_copy(&self, dest: &Path, key: DatabaseKey<'_>) -> Result<(), String> {
        let plain_header = has_plain_header(dest).map_err(|e| e.to_string())?;
        match (&key, plain_header) {
            (DatabaseKey::Plaintext, false) => return Err("the copy is not a plaintext database".to_string()),
            (DatabaseKey::Raw(_), true) => return Err("the encrypted copy has a plaintext header".to_string()),
            _ => {}
        }
        let sql = |e: rusqlite::Error| e.to_string();
        let copy = rusqlite::Connection::open_with_flags(dest, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(sql)?;
        if let DatabaseKey::Raw(bytes) = key {
            copy.execute_batch(&key_pragma(bytes)).map_err(sql)?;
        }
        let integrity: String = copy.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(sql)?;
        if integrity != "ok" {
            return Err(format!("the copy failed its integrity check: {integrity}"));
        }
        if matches!(key, DatabaseKey::Raw(_)) {
            let mut check = copy.prepare("PRAGMA cipher_integrity_check").map_err(sql)?;
            let problems = check.query_map([], |row| row.get::<_, String>(0)).map_err(sql)?.count();
            if problems > 0 {
                return Err("the copy failed the encryption integrity check".to_string());
            }
        }
        let version = |conn: &rusqlite::Connection| conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0)).map_err(sql);
        if version(&self.conn)? != version(&copy)? {
            return Err("the copy has a different user_version".to_string());
        }
        let list_tables = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
        let names = |conn: &rusqlite::Connection| -> Result<Vec<String>, String> {
            let mut statement = conn.prepare(list_tables).map_err(sql)?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(sql)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(sql)
        };
        let (source_tables, copy_tables) = (names(&self.conn)?, names(&copy)?);
        if source_tables != copy_tables {
            return Err("the copy has a different set of tables".to_string());
        }
        for table in &source_tables {
            let count = format!("SELECT count(*) FROM \"{}\"", table.replace('"', "\"\""));
            let in_source: i64 = self.conn.query_row(&count, [], |row| row.get(0)).map_err(sql)?;
            let in_copy: i64 = copy.query_row(&count, [], |row| row.get(0)).map_err(sql)?;
            if in_source != in_copy {
                return Err(format!("table {table} has {in_source} rows in the source and {in_copy} in the copy"));
            }
        }
        Ok(())
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

    const MARKER: &str = "SECRET-CATEGORY-XYZ";

    fn plain_store_with_marker(path: &Path) -> Store {
        let store = Store::open(path).unwrap();
        store.create_category(MARKER, None).unwrap();
        store.conn.execute_batch("PRAGMA user_version = 7;").unwrap();
        store
    }

    fn has_plain_header(path: &Path) -> bool {
        let bytes = std::fs::read(path).unwrap();
        &bytes[..16] == b"SQLite format 3\0"
    }

    fn file_contains_marker(path: &Path) -> bool {
        std::fs::read(path).unwrap().windows(MARKER.len()).any(|w| w == MARKER.as_bytes())
    }

    fn user_version(store: &Store) -> i64 {
        store.conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn a_plaintext_store_exports_an_encrypted_copy_that_verifies() {
        let dir = temp_dir("export-enc");
        let (source, dest) = (dir.join("plain.db"), dir.join("enc.db"));
        let store = plain_store_with_marker(&source);

        store.export_encrypted_copy(&dest, &KEY_A).unwrap();

        assert!(!has_plain_header(&dest));
        assert!(file_contains_marker(&source) && !file_contains_marker(&dest));
        store.verify_copy(&dest, DatabaseKey::Raw(&KEY_A)).unwrap();
        let copy = Store::open_with_key(&dest, DatabaseKey::Raw(&KEY_A)).unwrap();
        assert!(copy.list_categories().unwrap().contains(&MARKER.to_string()));
        assert_eq!(user_version(&copy), 7);
    }

    #[test]
    fn an_encrypted_store_exports_a_plaintext_copy_that_verifies() {
        let dir = temp_dir("export-plain");
        let (source, enc, plain_copy) = (dir.join("plain.db"), dir.join("enc.db"), dir.join("copy.db"));
        plain_store_with_marker(&source).export_encrypted_copy(&enc, &KEY_A).unwrap();
        let encrypted = Store::open_with_key(&enc, DatabaseKey::Raw(&KEY_A)).unwrap();

        encrypted.export_plaintext_copy(&plain_copy).unwrap();

        assert!(has_plain_header(&plain_copy));
        encrypted.verify_copy(&plain_copy, DatabaseKey::Plaintext).unwrap();
        let copy = Store::open(&plain_copy).unwrap();
        assert!(copy.list_categories().unwrap().contains(&MARKER.to_string()));
        assert_eq!(user_version(&copy), 7);
    }

    #[test]
    fn exporting_under_a_new_key_re_keys_the_copy() {
        let dir = temp_dir("rekey");
        let (source, enc_a, enc_b) = (dir.join("plain.db"), dir.join("a.db"), dir.join("b.db"));
        plain_store_with_marker(&source).export_encrypted_copy(&enc_a, &KEY_A).unwrap();
        let store_a = Store::open_with_key(&enc_a, DatabaseKey::Raw(&KEY_A)).unwrap();

        store_a.export_encrypted_copy(&enc_b, &KEY_B).unwrap();

        store_a.verify_copy(&enc_b, DatabaseKey::Raw(&KEY_B)).unwrap();
        assert!(Store::open_with_key(&enc_b, DatabaseKey::Raw(&KEY_B)).is_ok());
        assert!(matches!(
            Store::open_with_key(&enc_b, DatabaseKey::Raw(&KEY_A)),
            Err(StoreOpenError::NotADatabaseOrWrongKey)
        ));
    }

    #[test]
    fn an_export_never_overwrites_an_existing_file_or_leaves_a_half_written_one() {
        let dir = temp_dir("no-overwrite");
        let store = plain_store_with_marker(&dir.join("plain.db"));
        let taken = dir.join("taken.db");
        std::fs::write(&taken, b"keep me").unwrap();
        let missing_folder = dir.join("no-such-folder").join("out.db");

        assert!(store.export_encrypted_copy(&taken, &KEY_A).is_err());
        assert!(store.export_plaintext_copy(&taken).is_err());
        assert_eq!(std::fs::read(&taken).unwrap(), b"keep me");
        assert!(store.export_encrypted_copy(&missing_folder, &KEY_A).is_err());
        assert!(!missing_folder.exists());
    }

    #[test]
    fn verification_catches_a_copy_that_lost_data_or_is_the_wrong_kind() {
        let dir = temp_dir("verify");
        let (source, enc) = (dir.join("plain.db"), dir.join("enc.db"));
        let store = plain_store_with_marker(&source);
        store.export_encrypted_copy(&enc, &KEY_A).unwrap();
        {
            let copy = Store::open_with_key(&enc, DatabaseKey::Raw(&KEY_A)).unwrap();
            copy.conn.execute_batch("DELETE FROM categories;").unwrap();
        }

        let lost = store.verify_copy(&enc, DatabaseKey::Raw(&KEY_A)).unwrap_err();
        assert!(lost.contains("categories"), "{lost}");
        assert!(
            store.verify_copy(&enc, DatabaseKey::Plaintext).is_err(),
            "an encrypted file is not a plaintext copy"
        );
        assert!(
            store.verify_copy(&source, DatabaseKey::Raw(&KEY_A)).is_err(),
            "a plaintext file is not an encrypted copy"
        );
        assert!(store.verify_copy(&enc, DatabaseKey::Raw(&KEY_B)).is_err(), "the wrong key cannot verify");
    }

    #[test]
    fn backup_to_keeps_an_encrypted_store_encrypted_under_the_same_key() {
        let dir = temp_dir("backup");
        let (source, enc, backup) = (dir.join("plain.db"), dir.join("enc.db"), dir.join("backup.db"));
        plain_store_with_marker(&source).export_encrypted_copy(&enc, &KEY_A).unwrap();
        let store = Store::open_with_key(&enc, DatabaseKey::Raw(&KEY_A)).unwrap();

        store.backup_to(&backup).unwrap();

        assert!(!has_plain_header(&backup));
        let copy = Store::open_with_key(&backup, DatabaseKey::Raw(&KEY_A)).unwrap();
        assert!(copy.list_categories().unwrap().contains(&MARKER.to_string()));
    }
}
