//! Guards the SQLCipher behaviour the profile password-protection design relies on
//! (plan v2, section 4.2). These run on every platform Vault Spend is built for: if the
//! engine is ever switched back to plain SQLite, or a SQLCipher upgrade changes one of
//! these behaviours, this file fails before anything built on top of it does.
use rusqlite::{Connection, backup::Backup};
use std::path::{Path, PathBuf};
use std::time::Duration;

const KEY_A: [u8; 32] = [0x11; 32];
const KEY_B: [u8; 32] = [0x22; 32];
const MARKER: &str = "SECRET-MARKER-XYZ";
const ROWS: usize = 2_000;

fn test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vaultspend-sqlcipher-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `PRAGMA key` with a raw 32-byte key (SQLCipher's `x'<hex>'` form, so no password
/// derivation happens inside SQLCipher).
fn apply_key(conn: &Connection, key: &[u8; 32]) {
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex(key))).unwrap();
}

fn sql_quote(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

fn make_plain(path: &Path) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(&format!(
        "CREATE TABLE accounts(id INTEGER PRIMARY KEY, name TEXT);
         CREATE TABLE transactions(id INTEGER PRIMARY KEY, account_id INTEGER, description TEXT, amount TEXT);
         INSERT INTO accounts(name) VALUES('Checking {MARKER}');
         PRAGMA user_version = 7;"
    ))
    .unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    {
        let mut insert = tx
            .prepare("INSERT INTO transactions(account_id, description, amount) VALUES (1, ?1, ?2)")
            .unwrap();
        for i in 0..ROWS {
            insert
                .execute((format!("Merchant {i} {MARKER}"), format!("{}.{:02}", i % 500, i % 100)))
                .unwrap();
        }
    }
    tx.commit().unwrap();
}

fn count_rows(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT count(*) FROM transactions", [], |row| row.get(0))
}

fn has_plain_sqlite_header(path: &Path) -> bool {
    let bytes = std::fs::read(path).unwrap();
    bytes.len() >= 16 && &bytes[..16] == b"SQLite format 3\0"
}

fn contains_marker(path: &Path) -> bool {
    let bytes = std::fs::read(path).unwrap();
    bytes.windows(MARKER.len()).any(|window| window == MARKER.as_bytes())
}

/// Plaintext -> encrypted, the way "turn protection on" will do it. `user_version` is set
/// explicitly afterwards because the export is not relied on to carry it.
fn export_encrypted(plain: &Path, dest: &Path, key: &[u8; 32]) {
    let conn = Connection::open(plain).unwrap();
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
    conn.execute_batch(&format!("ATTACH DATABASE '{}' AS enc KEY \"x'{}'\";", sql_quote(dest), hex(key)))
        .unwrap();
    conn.query_row("SELECT sqlcipher_export('enc')", [], |_| Ok(())).unwrap();
    conn.execute_batch(&format!("PRAGMA enc.user_version = {user_version}; DETACH DATABASE enc;"))
        .unwrap();
}

fn open_encrypted(path: &Path, key: &[u8; 32]) -> Connection {
    let conn = Connection::open(path).unwrap();
    apply_key(&conn, key);
    conn
}

fn online_backup(from: &Connection, to: &mut Connection) -> rusqlite::Result<()> {
    Backup::new(from, to)?.run_to_completion(i32::MAX, Duration::ZERO, None)
}

#[test]
fn the_linked_engine_is_sqlcipher_not_plain_sqlite() {
    let conn = Connection::open_in_memory().unwrap();

    let version: String = conn
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .expect("plain SQLite has no cipher_version, so the build must link SQLCipher");

    assert!(!version.is_empty());
}

#[test]
fn an_exported_copy_is_unreadable_without_the_key_and_complete_with_it() {
    let dir = test_dir("export");
    let (plain, enc) = (dir.join("plain.db"), dir.join("enc.db"));
    make_plain(&plain);

    export_encrypted(&plain, &enc, &KEY_A);

    assert!(
        has_plain_sqlite_header(&plain),
        "the source stays plaintext, or the check below proves nothing"
    );
    assert!(
        !has_plain_sqlite_header(&enc),
        "an encrypted file must not start with the plain SQLite header"
    );
    assert!(
        contains_marker(&plain) && !contains_marker(&enc),
        "no stored text may appear in the encrypted file"
    );
    let with_key = open_encrypted(&enc, &KEY_A);
    assert_eq!(count_rows(&with_key).unwrap(), ROWS as i64);
    assert_eq!(with_key.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0)).unwrap(), 7);
    assert_eq!(
        with_key.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0)).unwrap(),
        "ok"
    );
    let cipher_problems = with_key
        .prepare("PRAGMA cipher_integrity_check")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .count();
    assert_eq!(cipher_problems, 0);
    assert!(count_rows(&Connection::open(&enc).unwrap()).is_err(), "no key must fail");
    assert!(count_rows(&open_encrypted(&enc, &KEY_B)).is_err(), "the wrong key must fail");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_online_backup_copies_between_two_encrypted_databases_with_the_same_key() {
    let dir = test_dir("backup-enc");
    let (plain, enc, copy) = (dir.join("plain.db"), dir.join("enc.db"), dir.join("copy.db"));
    make_plain(&plain);
    export_encrypted(&plain, &enc, &KEY_A);
    let source = open_encrypted(&enc, &KEY_A);
    let mut destination = open_encrypted(&copy, &KEY_A);

    online_backup(&source, &mut destination).unwrap();
    drop(destination);

    assert!(!has_plain_sqlite_header(&copy));
    assert_eq!(count_rows(&open_encrypted(&copy, &KEY_A)).unwrap(), ROWS as i64);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_online_backup_refuses_to_cross_between_plaintext_and_encrypted() {
    // Why "turn protection on" and "remove protection" go through `sqlcipher_export`
    // instead of `Store::backup_to`. If a SQLCipher upgrade lifts this, this test says so.
    let dir = test_dir("backup-cross");
    let (plain, enc) = (dir.join("plain.db"), dir.join("enc.db"));
    make_plain(&plain);
    export_encrypted(&plain, &enc, &KEY_A);

    let mut into_encrypted = open_encrypted(&dir.join("into-enc.db"), &KEY_A);
    let to_encrypted = online_backup(&Connection::open(&plain).unwrap(), &mut into_encrypted);
    let mut into_plain = Connection::open(dir.join("into-plain.db")).unwrap();
    let to_plain = online_backup(&open_encrypted(&enc, &KEY_A), &mut into_plain);

    for (direction, result) in [("plaintext -> encrypted", to_encrypted), ("encrypted -> plaintext", to_plain)] {
        let error = result.expect_err(direction).to_string();
        assert!(error.contains("not supported with encrypted databases"), "{direction}: {error}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn two_backups_of_an_unchanged_encrypted_database_differ_byte_for_byte() {
    // Cloud sync must not decide "nothing changed" by hashing the file.
    let dir = test_dir("backup-differ");
    let (plain, enc) = (dir.join("plain.db"), dir.join("enc.db"));
    make_plain(&plain);
    export_encrypted(&plain, &enc, &KEY_A);
    let source = open_encrypted(&enc, &KEY_A);
    let (first, second) = (dir.join("first.db"), dir.join("second.db"));

    for path in [&first, &second] {
        let mut destination = open_encrypted(path, &KEY_A);
        online_backup(&source, &mut destination).unwrap();
    }

    assert_ne!(std::fs::read(&first).unwrap(), std::fs::read(&second).unwrap());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_encrypted_database_can_be_exported_back_to_plaintext() {
    // "Remove protection".
    let dir = test_dir("to-plain");
    let (plain, enc, back) = (dir.join("plain.db"), dir.join("enc.db"), dir.join("back.db"));
    make_plain(&plain);
    export_encrypted(&plain, &enc, &KEY_A);
    let conn = open_encrypted(&enc, &KEY_A);

    conn.execute_batch(&format!("ATTACH DATABASE '{}' AS plaintext KEY '';", sql_quote(&back)))
        .unwrap();
    conn.query_row("SELECT sqlcipher_export('plaintext')", [], |_| Ok(())).unwrap();
    conn.execute_batch("DETACH DATABASE plaintext;").unwrap();

    assert!(has_plain_sqlite_header(&back));
    assert_eq!(count_rows(&Connection::open(&back).unwrap()).unwrap(), ROWS as i64);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rekeying_replaces_the_key_and_the_old_key_stops_working() {
    let dir = test_dir("rekey");
    let (plain, enc) = (dir.join("plain.db"), dir.join("enc.db"));
    make_plain(&plain);
    export_encrypted(&plain, &enc, &KEY_A);
    let conn = open_encrypted(&enc, &KEY_A);

    conn.execute_batch(&format!("PRAGMA rekey = \"x'{}'\";", hex(&KEY_B))).unwrap();
    drop(conn);

    assert_eq!(count_rows(&open_encrypted(&enc, &KEY_B)).unwrap(), ROWS as i64);
    assert!(count_rows(&open_encrypted(&enc, &KEY_A)).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}
