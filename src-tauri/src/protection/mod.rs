//! Password-protection runtime, one concern per file: `session` (unlock attempts, delays, the in-memory
//! session), `transition` (the journaled conversion to a protected profile), `lifecycle` (password
//! rotation, removal, recovery) and `leftovers` (files a conversion left behind). The Tauri command
//! adapters over these stay in `protection_commands.rs`.

pub(crate) mod leftovers;
pub(crate) mod lifecycle;
pub(crate) mod session;
pub(crate) mod transition;
