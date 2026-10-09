//! Opt-in command timing, for measuring where launch and data loading spend their time.
//!
//! Set `VAULTSPEND_PERF_LOG` to a file path and every command the page invokes appends one JSON line:
//! `{"cmd":"list_transactions","start_ms":812.4,"ms":95.1,"main_thread":true}`. `start_ms` counts from
//! the first command, so lines from one launch line up on one clock. A synchronous command runs inside
//! the handler, so `ms` is its whole run (including the wait for the state lock). An `async` command is
//! only dispatched there, so its `ms` is just the hand-off. Unset (the default), the handler runs as is.
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::ipc::Invoke;
use tauri::Runtime;

struct PerfLog {
    path: PathBuf,
    origin: Instant,
    write: Mutex<()>,
}

fn perf_log() -> Option<&'static PerfLog> {
    static LOG: OnceLock<Option<PerfLog>> = OnceLock::new();
    LOG.get_or_init(|| {
        let path = std::env::var_os("VAULTSPEND_PERF_LOG").filter(|p| !p.is_empty())?;
        Some(PerfLog {
            path: PathBuf::from(path),
            origin: Instant::now(),
            write: Mutex::new(()),
        })
    })
    .as_ref()
}

/// One log line, as JSON (command names are Rust identifiers, so they need no escaping).
fn line(cmd: &str, start_ms: f64, ms: f64, main_thread: bool) -> String {
    format!("{{\"cmd\":\"{cmd}\",\"start_ms\":{start_ms:.1},\"ms\":{ms:.1},\"main_thread\":{main_thread}}}\n")
}

/// Wraps the command handler so each invoke is timed when `VAULTSPEND_PERF_LOG` is set.
pub fn timed<R, H>(handler: H) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    H: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke: Invoke<R>| {
        let Some(log) = perf_log() else {
            return handler(invoke);
        };
        let cmd = invoke.message.command().to_string();
        // A count identifies full versus targeted reads without recording financial identifiers.
        let requested_rows = if cmd == "get_transaction_snapshot" {
            match invoke.message.payload() {
                tauri::ipc::InvokeBody::Json(value) => value.get("ids").and_then(|ids| ids.as_array()).map(Vec::len),
                _ => None,
            }
        } else {
            None
        };
        let started = Instant::now();
        let handled = handler(invoke);
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        let start_ms = started.duration_since(log.origin).as_secs_f64() * 1000.0;
        let main_thread = std::thread::current().name() == Some("main");
        let _guard = log.write.lock().unwrap_or_else(|e| e.into_inner());
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log.path) {
            let mut entry = line(&cmd, start_ms, ms, main_thread);
            if cmd == "get_transaction_snapshot" {
                entry.truncate(entry.len() - 2);
                entry.push_str(&format!(
                    ",\"requested_rows\":{}}}\n",
                    requested_rows.map(|n| n.to_string()).unwrap_or_else(|| "null".into())
                ));
            }
            let _ = file.write_all(entry.as_bytes());
        }
        handled
    }
}

#[cfg(test)]
mod tests {
    use super::line;

    #[test]
    fn a_line_is_one_json_object() {
        let text = line("list_transactions", 812.44, 95.06, true);
        assert_eq!(
            text,
            "{\"cmd\":\"list_transactions\",\"start_ms\":812.4,\"ms\":95.1,\"main_thread\":true}\n"
        );
        let parsed: serde_json::Value = serde_json::from_str(text.trim()).unwrap();
        assert_eq!(parsed["cmd"], "list_transactions");
    }
}
