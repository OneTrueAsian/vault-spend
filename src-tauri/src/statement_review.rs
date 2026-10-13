//! The one statement review in progress. In memory only, bound to the profile generation, the account's
//! review signature and a 10-minute lifetime. A profile switch, lock, expiry or change to the account
//! ends it with one plain message. The statement's text lines are kept here only while the review is
//! open (teaching needs them); they never touch disk and are dropped on finish, cancel, expiry, a
//! profile change or the next upload.

use budget_core::statement::layout::StatementLayout;
use budget_core::statement::matching::AccountKind;
use budget_core::statement::select::LayoutOrigin;
use budget_core::statement::{Period, StatementLine, StatementRow};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const LIFETIME: Duration = Duration::from_secs(600);
pub const STALE: &str = "Your data changed while you were reviewing. Please read the statement again.";
const NOT_OPEN: &str = "Could not open the statement review.";

pub enum Source {
    Pdf,
    /// A CSV/OFX/QFX/QIF download; `flip` is the account's remembered import direction.
    Download {
        flip: bool,
    },
}

pub struct Session {
    pub token: String,
    pub generation: u64,
    pub created: Instant,
    pub signature: String,
    pub account_id: i64,
    pub kind: AccountKind,
    pub period: Period,
    pub source: Source,
    pub lines: Vec<StatementLine>,
    pub download_rows: Vec<StatementRow>,
    pub download_dropped: usize,
    pub layout: Option<StatementLayout>,
    pub origin: Option<LayoutOrigin>,
    pub recognized: bool,
    pub recognized_but_failed: bool,
    pub taught: bool,
    pub section: usize,
    pub flip: bool,
}

#[derive(Default)]
pub struct Sessions(pub Mutex<Option<Session>>);

impl Sessions {
    /// Starts a new review, ending any other one.
    pub fn replace(&self, session: Session) -> Result<(), String> {
        *self.0.lock().map_err(|_| NOT_OPEN)? = Some(session);
        Ok(())
    }

    /// Runs `f` on the open review when `token` and `generation` are its own and it has not expired.
    /// Otherwise the review (if any) ends and the plain "data changed" message comes back.
    pub fn with<T>(&self, token: &str, generation: u64, f: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.0.lock().map_err(|_| NOT_OPEN)?;
        let valid = guard
            .as_ref()
            .is_some_and(|s| s.token == token && s.generation == generation && s.created.elapsed() < LIFETIME);
        if !valid {
            *guard = None;
            return Err(STALE.to_string());
        }
        f(guard.as_mut().expect("checked above"))
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(token: &str, generation: u64, created: Instant) -> Session {
        Session {
            token: token.into(),
            generation,
            created,
            signature: String::new(),
            account_id: 1,
            kind: AccountKind::Cash,
            period: Period::new("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap()).unwrap(),
            source: Source::Pdf,
            lines: vec![],
            download_rows: vec![],
            download_dropped: 0,
            layout: None,
            origin: None,
            recognized: false,
            recognized_but_failed: false,
            taught: false,
            section: 0,
            flip: false,
        }
    }

    #[test]
    fn the_open_review_is_used_only_with_its_own_token_and_generation() {
        let sessions = Sessions::default();
        sessions.replace(session("abc", 3, Instant::now())).unwrap();
        assert_eq!(sessions.with("abc", 3, |s| Ok(s.account_id)), Ok(1));
        assert_eq!(sessions.with("abc", 4, |s| Ok(s.account_id)).unwrap_err(), STALE);
        // A refused call ends the review, so even the right token no longer works.
        assert_eq!(sessions.with("abc", 3, |s| Ok(s.account_id)).unwrap_err(), STALE);
    }

    #[test]
    fn an_expired_or_cleared_review_is_refused() {
        let sessions = Sessions::default();
        let Some(long_ago) = Instant::now().checked_sub(LIFETIME + Duration::from_secs(1)) else {
            return; // The clock started too recently to go back that far; nothing to check.
        };
        sessions.replace(session("old", 1, long_ago)).unwrap();
        assert_eq!(sessions.with("old", 1, |_| Ok(())).unwrap_err(), STALE);

        sessions.replace(session("new", 1, Instant::now())).unwrap();
        sessions.clear();
        assert_eq!(sessions.with("new", 1, |_| Ok(())).unwrap_err(), STALE);
    }
}
