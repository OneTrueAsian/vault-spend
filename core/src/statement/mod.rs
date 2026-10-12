//! Reading bank, card, loan and brokerage statements into rows, balances and holdings, and checking
//! that the reading adds up. Every bank-specific choice comes from a `StatementLayout` (data); nothing
//! in this module names a bank. See docs/STATEMENT-RECONCILE.md.

pub mod fixture_pdf;
pub mod layout;
pub mod model;
pub mod text;
pub mod tokens;

pub use model::*;
