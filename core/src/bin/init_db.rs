// Headless schema/migration initializer for E2E test fixtures (see
// e2e/lib/seed.mjs). Calls the exact same `Store::open` migration path the
// real app and every Rust test already use, then exits immediately — no
// need to launch the full Tauri app and sleep for an arbitrary "probably
// done by now" duration just to get a fresh, migrated vaultspend.db.
use std::path::PathBuf;

fn main() {
    let dir = std::env::args().nth(1).expect("usage: init_db <dir>");
    let db_path = PathBuf::from(dir).join("vaultspend.db");
    budget_core::store::Store::open(&db_path).expect("failed to initialize database");
}
