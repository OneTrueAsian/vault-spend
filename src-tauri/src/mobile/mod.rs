//! The phone-access service, one concern per file: `server` (HTTPS listener and assets), `api` (the
//! authenticated routes), `bootstrap` (guided setup page, embedded from `setup/`), `certificates`,
//! `devices` (pairing and grants), `discovery` and `secrets`. The Tauri command adapters over these
//! stay in `mobile_commands.rs`.

pub(crate) mod api;
pub(crate) mod bootstrap;
pub(crate) mod certificates;
pub(crate) mod devices;
pub(crate) mod discovery;
#[cfg(debug_assertions)]
pub(crate) mod race;
pub(crate) mod secrets;
pub(crate) mod server;
