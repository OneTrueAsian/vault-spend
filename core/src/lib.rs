//! Core categorization/learning engine for Vault Spend. No Tauri/webview
//! dependencies here on purpose, so `cargo test -p budget_core` stays fast.

pub mod categorizer;
pub mod classifier;
pub mod csv_loader;
pub mod importer;
pub mod learner;
pub mod models;
pub mod ofx_loader;
pub mod qif_loader;
pub mod rules;
pub mod setup_import;
pub mod store;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
