//! Runs the app's commands on one worker thread instead of the main thread.
//!
//! Tauri runs a synchronous command on the main thread, which also runs the window. While a command
//! worked (reading 50,000 transactions takes over a second), the window could not repaint or take a
//! click: the startup reads froze it for about 2.6 s. The commands now go, in the order the page sent
//! them, to a single worker that runs them one at a time, exactly as the main thread did. Keeping one
//! thread keeps that order: a write and the read sent after it still run in that sequence, and no two
//! commands contend for the state lock.
//!
//! Window, tray and menu calls a command makes are forwarded to the main thread by Tauri itself, and
//! the main thread never waits on this worker, so the two cannot deadlock. Plugin commands (dialogs,
//! the app version, notifications) are not app commands and are not routed here.
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;

use tauri::ipc::Invoke;
use tauri::Runtime;

pub const THREAD_NAME: &str = "vaultspend-commands";

type Job = Box<dyn FnOnce() + Send>;

/// A single worker thread that runs jobs in the order they were queued.
#[derive(Clone)]
pub struct CommandQueue {
    jobs: Sender<Job>,
}

impl CommandQueue {
    pub fn start() -> Self {
        let (jobs, queue) = channel::<Job>();
        std::thread::Builder::new()
            .name(THREAD_NAME.to_string())
            .spawn(move || {
                for job in queue {
                    // A panicking command must not take every later command down with it.
                    if catch_unwind(AssertUnwindSafe(job)).is_err() {
                        eprintln!("a command panicked; later commands still run");
                    }
                }
            })
            .expect("the command thread could start");
        Self { jobs }
    }

    /// Queues `job`. If the worker is gone, runs it here instead, as before this queue existed.
    pub fn run(&self, job: Job) {
        if let Err(returned) = self.jobs.send(job) {
            (returned.0)();
        }
    }
}

/// Wraps the command handler so every app command runs on the command thread.
pub fn off_main_thread<R, H>(handler: H) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    H: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    let handler = Arc::new(handler);
    move |invoke: Invoke<R>| {
        use tauri::Manager;
        let queue = invoke.message.webview().app_handle().state::<CommandQueue>().inner().clone();
        let handler = Arc::clone(&handler);
        let resolver = invoke.resolver.clone();
        let command = invoke.message.command().to_string();
        queue.run(Box::new(move || {
            let outcome = catch_unwind(AssertUnwindSafe(|| handler(invoke)));
            match outcome {
                // Tauri rejects an unknown command after the handler returns false; the handler now
                // returns before the command runs, so the worker rejects it in the same words.
                Ok(false) => resolver.reject(format!("Command {command} not found")),
                Ok(true) => {}
                Err(_) => resolver.reject(format!("{command} failed unexpectedly")),
            }
        }));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::sync::Mutex;
    use std::time::Duration;

    #[test]
    fn jobs_run_in_the_order_they_were_queued_on_the_command_thread() {
        let queue = CommandQueue::start();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (done, finished) = channel();
        for i in 0..50 {
            let seen = Arc::clone(&seen);
            queue.run(Box::new(move || {
                seen.lock().unwrap().push((i, std::thread::current().name().map(str::to_string)));
            }));
        }
        queue.run(Box::new(move || done.send(()).unwrap()));
        finished.recv_timeout(Duration::from_secs(5)).unwrap();

        let seen = seen.lock().unwrap();
        assert_eq!(seen.iter().map(|(i, _)| *i).collect::<Vec<_>>(), (0..50).collect::<Vec<_>>());
        assert!(seen.iter().all(|(_, thread)| thread.as_deref() == Some(THREAD_NAME)));
    }

    #[test]
    fn a_panicking_job_does_not_stop_the_ones_after_it() {
        let queue = CommandQueue::start();
        let (done, finished) = channel();
        queue.run(Box::new(|| panic!("a command went wrong")));
        queue.run(Box::new(move || done.send("still running").unwrap()));
        assert_eq!(finished.recv_timeout(Duration::from_secs(5)).unwrap(), "still running");
    }

    #[test]
    fn queuing_does_not_wait_for_the_job() {
        let queue = CommandQueue::start();
        let (release, gate) = channel::<()>();
        let (done, finished) = channel();
        queue.run(Box::new(move || {
            gate.recv().unwrap();
            done.send(()).unwrap();
        }));
        // run() returned while the job is still blocked; let it finish
        release.send(()).unwrap();
        finished.recv_timeout(Duration::from_secs(5)).unwrap();
    }

    /// Disposable in-memory ledgers; measures the real command worker behind a desktop ledger read.
    /// Run explicitly with --ignored --nocapture. No application/profile paths are opened.
    #[test]
    #[ignore = "manual mobile projection baseline"]
    fn mobile_snapshot_queue_baseline() {
        use budget_core::{
            models::{AccountType, Transaction},
            store::{MobileSnapshotContext, Store},
        };
        use chrono::{NaiveDate, TimeZone, Utc};
        use rust_decimal::Decimal;
        use std::time::Instant;
        let today = NaiveDate::from_ymd_opt(2026, 10, 4).unwrap();
        for count in [5000, 50000] {
            let store = Store::open_in_memory().unwrap();
            let mut ids = Vec::new();
            for (i, kind) in [
                AccountType::Checking,
                AccountType::Savings,
                AccountType::Credit,
                AccountType::Loan,
                AccountType::Investment,
                AccountType::Other,
            ]
            .into_iter()
            .enumerate()
            {
                let account = store.get_or_create_account(&format!("Account {i}"), kind).unwrap();
                ids.push(account);
            }
            for (i, account) in ids.iter().enumerate() {
                let rows: Vec<_> = (0..count)
                    .filter(|n| n % 6 == i)
                    .map(|n| Transaction {
                        date: today - chrono::Duration::days((n % 2000) as i64),
                        description: format!("Merchant {}", n % 60),
                        amount: Decimal::from(if n % 5 == 0 { 100 } else { -20 }),
                        category: Some(format!("Category {}", n % 10)),
                    })
                    .collect();
                store.save_transactions(*account, &rows).unwrap();
            }
            for i in 0..10 {
                store
                    .set_budget(&format!("Category {i}"), "2021-01", Decimal::from(500), "flexible")
                    .unwrap();
            }
            let store = Arc::new(Mutex::new(store));
            let queue = CommandQueue::start();
            for repetition in 0..3 {
                let queued = Instant::now();
                let desktop = Arc::clone(&store);
                queue.run(Box::new(move || {
                    let rows = desktop.lock().unwrap().all_transactions().unwrap();
                    assert_eq!(rows.len(), count);
                }));
                let store = Arc::clone(&store);
                let (done, finished) = channel();
                queue.run(Box::new(move || {
                    let wait = queued.elapsed();
                    let context = MobileSnapshotContext {
                        installation_id: "benchmark-installation".into(),
                        profile_id: "benchmark-profile".into(),
                        profile_name: "Disposable baseline".into(),
                        profile_icon: None,
                        epoch: "benchmark-epoch".into(),
                        sequence: 1,
                        generated_at: Utc.with_ymd_and_hms(2026, 10, 4, 12, 0, 0).unwrap(),
                        alias_key: [11; 32],
                    };
                    let started = Instant::now();
                    let snapshot = store.lock().unwrap().build_mobile_snapshot(&context, today).unwrap();
                    let build = started.elapsed();
                    let started = Instant::now();
                    let json = budget_core::mobile_snapshot::serialize_mobile_snapshot(&snapshot).unwrap();
                    done.send((wait, build, started.elapsed(), json.len(), snapshot.history.months.len()))
                        .unwrap();
                }));
                let (wait, build, serialize, bytes, months) = finished.recv_timeout(Duration::from_secs(120)).unwrap();
                println!(
                    "MOBILE_BASELINE rows={count} run={repetition} queue_ms={} build_validate_ms={} serialize_validate_ms={} bytes={bytes} months={months}",
                    wait.as_millis(),
                    build.as_millis(),
                    serialize.as_millis()
                );
            }
        }
    }
}
