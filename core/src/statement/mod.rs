//! Reading bank, card, loan and brokerage statements into rows, balances and holdings, and checking
//! that the reading adds up. Every bank-specific choice comes from a `StatementLayout` (data); nothing
//! in this module names a bank. See docs/STATEMENT-RECONCILE.md.

pub mod checks;
pub mod fixture_pdf;
pub mod holdings;
pub mod layout;
pub mod learn;
pub mod matching;
pub mod model;
pub mod pdf_text;
pub mod rows;
pub mod sections;
pub mod select;
pub mod text;
pub mod tokens;

pub use model::*;
