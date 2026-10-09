//! Origin-session metadata for migrated synchronous IPC commands. Legacy callers remain compatible.
//! Runtime validates under its slot mutex, not just when the worker dequeues the request.
use std::cell::Cell;

thread_local! { static EXPECTED: Cell<Option<u64>> = const { Cell::new(None) }; }

pub(crate) struct RequestSession {
    previous: Option<u64>,
}
pub(crate) fn enter(expected: Option<u64>) -> RequestSession {
    RequestSession {
        previous: EXPECTED.with(|current| current.replace(expected)),
    }
}
pub(crate) fn expected() -> Option<u64> {
    EXPECTED.with(Cell::get)
}
impl Drop for RequestSession {
    fn drop(&mut self) {
        EXPECTED.with(|current| current.set(self.previous));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_restores_metadata_after_success_and_unwind() {
        assert_eq!(expected(), None);
        {
            let _outer = enter(Some(1));
            assert_eq!(expected(), Some(1));
            let _ = std::panic::catch_unwind(|| {
                let _inner = enter(Some(2));
                panic!("fixture");
            });
            assert_eq!(expected(), Some(1));
        }
        assert_eq!(expected(), None);
    }
}
