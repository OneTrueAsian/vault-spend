//! Debug-only, disposable-fixture stage evidence. No financial payloads or request-schema changes.
use crate::commands::AppStateHandle;
use crate::config::AppPaths;
use serde::Serialize;
use std::cell::RefCell;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Command {
    #[serde(rename = "get_ask_vault_retirement_accounts")]
    Accounts,
    #[serde(rename = "get_ask_vault_retirement_context")]
    Context,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    ordinal: u32,
    command: Command,
    handler_ms: f64,
    lock_ms: f64,
    read_ms: Option<f64>,
    ok: bool,
}
#[derive(Serialize)]
pub struct Snapshot {
    sample: u64,
    rows: Vec<Row>,
    overflow: bool,
}
struct Buffer {
    sample: u64,
    owner: (u64, u64),
    rows: Vec<Row>,
    overflow: bool,
    next: u32,
}
impl Buffer {
    fn begin(sample: u64, owner: (u64, u64)) -> Result<Self, String> {
        if sample == 0 || sample > 9_007_199_254_740_991 {
            return Err("Invalid diagnostic sample".into());
        }
        Ok(Self {
            sample,
            owner,
            rows: Vec::with_capacity(64),
            overflow: false,
            next: 0,
        })
    }
    fn push(&mut self, owner: (u64, u64), row: Row) {
        if owner != self.owner
            || self.rows.len() >= 64
            || row.ordinal as usize != self.rows.len() + 1
            || !row.handler_ms.is_finite()
            || !row.lock_ms.is_finite()
            || row.read_ms.is_some_and(|n| !n.is_finite())
        {
            self.overflow = true;
            return;
        }
        self.rows.push(row);
    }
    fn finish(self, owner: (u64, u64)) -> Result<Snapshot, String> {
        if owner != self.owner {
            return Err("Diagnostic session retired".into());
        }
        Ok(Snapshot {
            sample: self.sample,
            rows: self.rows,
            overflow: self.overflow,
        })
    }
}
fn eligible(enabled: bool, fixture: bool, open: bool, expected: (u64, u64), actual: (u64, u64)) -> bool {
    enabled && fixture && open && expected == actual
}

fn buffer() -> &'static Mutex<Option<Buffer>> {
    static BUFFER: OnceLock<Mutex<Option<Buffer>>> = OnceLock::new();
    BUFFER.get_or_init(|| Mutex::new(None))
}
fn require(state: &AppStateHandle, paths: &AppPaths, expected: (u64, u64)) -> Result<(), String> {
    let directory = std::env::var_os("VAULTSPEND_DB_DIR").map(std::path::PathBuf::from);
    let fixture = {
        let db = paths.db_path.lock().unwrap_or_else(|e| e.into_inner());
        crate::debug_commands::retirement_fixture_paths_allowed(directory.as_deref(), &paths.config_path, &db)
    };
    if eligible(
        std::env::var("VAULTSPEND_STAGE_TRACE").ok().as_deref() == Some("1"),
        fixture,
        state.lock().is_ok(),
        expected,
        (paths.current_generation(), state.current_revision()),
    ) {
        Ok(())
    } else {
        *buffer().lock().unwrap_or_else(|e| e.into_inner()) = None;
        Err("Diagnostic fixture unavailable".into())
    }
}
#[tauri::command]
pub fn debug_retirement_stage_begin(
    sample: u64,
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<AppPaths>,
) -> Result<(), String> {
    let owner = (expected_generation, expected_session_revision);
    require(&state, &paths, owner)?;
    let mut current = buffer().lock().unwrap_or_else(|e| e.into_inner());
    if current.is_some() {
        return Err("Diagnostic sample already active".into());
    }
    *current = Some(Buffer::begin(sample, owner)?);
    Ok(())
}
#[tauri::command]
pub fn debug_retirement_stage_drain(
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<AppPaths>,
) -> Result<Snapshot, String> {
    let owner = (expected_generation, expected_session_revision);
    require(&state, &paths, owner)?;
    buffer()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or_else(|| "No diagnostic sample".to_string())?
        .finish(owner)
}

struct Draft {
    sample: u64,
    owner: (u64, u64),
    started: Instant,
    row: Row,
}
thread_local! { static CURRENT: RefCell<Option<Draft>> = const { RefCell::new(None) }; }
struct CallGuard(bool);
impl Drop for CallGuard {
    fn drop(&mut self) {
        if !self.0 {
            return;
        }
        if let Some(mut draft) = CURRENT.with(|c| c.borrow_mut().take()) {
            draft.row.handler_ms = draft.started.elapsed().as_secs_f64() * 1000.0;
            if let Some(b) = buffer().lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                if b.sample == draft.sample {
                    b.push(draft.owner, draft.row);
                }
            }
        }
    }
}
pub fn native_call<T, E>(command: Command, generation: u64, session: u64, f: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
    let owner = (generation, session);
    let draft = {
        let mut slot = buffer().lock().unwrap_or_else(|e| e.into_inner());
        slot.as_mut().and_then(|b| {
            if b.owner != owner {
                b.overflow = true;
                return None;
            }
            b.next += 1;
            Some(Draft {
                sample: b.sample,
                owner,
                started: Instant::now(),
                row: Row {
                    ordinal: b.next,
                    command,
                    handler_ms: 0.0,
                    lock_ms: 0.0,
                    read_ms: None,
                    ok: false,
                },
            })
        })
    };
    let guard = CallGuard(CURRENT.with(|c| {
        if draft.is_none() {
            false
        } else if c.borrow().is_some() {
            if let Some(b) = buffer().lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                b.overflow = true;
            }
            false
        } else {
            *c.borrow_mut() = draft;
            true
        }
    }));
    let result = f();
    if guard.0 {
        CURRENT.with(|c| {
            if let Some(d) = c.borrow_mut().as_mut() {
                d.row.ok = result.is_ok();
            }
        });
    }
    drop(guard);
    result
}
pub fn lock_span<T>(f: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let result = f();
    CURRENT.with(|c| {
        if let Some(d) = c.borrow_mut().as_mut() {
            d.row.lock_ms = start.elapsed().as_secs_f64() * 1000.0;
        }
    });
    result
}
pub fn read_span<T>(f: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let result = f();
    CURRENT.with(|c| {
        if let Some(d) = c.borrow_mut().as_mut() {
            d.row.read_ms = Some(start.elapsed().as_secs_f64() * 1000.0);
        }
    });
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(ordinal: u32) -> Row {
        Row {
            ordinal,
            command: Command::Context,
            handler_ms: 3.0,
            lock_ms: 1.0,
            read_ms: Some(2.0),
            ok: true,
        }
    }
    #[test]
    fn stage_trace_requires_optin_fixture_open_and_exact_live_session() {
        assert!(eligible(true, true, true, (1, 2), (1, 2)));
        for (enabled, fixture, open, actual) in [
            (false, true, true, (1, 2)),
            (true, false, true, (1, 2)),
            (true, true, false, (1, 2)),
            (true, true, true, (2, 2)),
            (true, true, true, (1, 3)),
        ] {
            assert!(!eligible(enabled, fixture, open, (1, 2), actual));
        }
    }
    #[test]
    fn stage_trace_refuses_non_generated_or_unrepresentable_sample_ids() {
        assert!(Buffer::begin(0, (1, 2)).is_err());
        assert!(Buffer::begin(9_007_199_254_740_992, (1, 2)).is_err());
    }
    #[test]
    fn stage_trace_retains_order_error_and_safe_metadata() {
        let mut b = Buffer::begin(17, (1, 2)).unwrap();
        b.push((1, 2), row(1));
        let mut failed = row(2);
        failed.ok = false;
        failed.read_ms = None;
        b.push((1, 2), failed);
        let s = b.finish((1, 2)).unwrap();
        assert_eq!(s.rows.len(), 2);
        assert_eq!(s.rows[0].ordinal, 1);
        assert!(!s.rows[1].ok);
        assert!(s.rows[1].read_ms.is_none());
        let json = serde_json::to_value(s).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 3);
        assert_eq!(json["rows"][0].as_object().unwrap().len(), 6);
    }
    #[test]
    fn stage_trace_session_retirement_refuses_and_never_relabels_old_rows() {
        let mut b = Buffer::begin(1, (1, 2)).unwrap();
        b.push((1, 2), row(1));
        assert!(b.finish((2, 3)).is_err());
        let mut b = Buffer::begin(2, (2, 3)).unwrap();
        b.push((1, 2), row(1));
        assert!(b.finish((2, 3)).unwrap().overflow);
    }
    #[test]
    fn stage_trace_overflow_and_bad_ordinals_never_form_valid_evidence() {
        let mut b = Buffer::begin(1, (1, 2)).unwrap();
        for i in 1..=65 {
            b.push((1, 2), row(i));
        }
        let s = b.finish((1, 2)).unwrap();
        assert!(s.overflow);
        assert_eq!(s.rows.len(), 64);
        let mut b = Buffer::begin(1, (1, 2)).unwrap();
        b.push((1, 2), row(2));
        assert!(b.finish((1, 2)).unwrap().overflow);
    }
}
