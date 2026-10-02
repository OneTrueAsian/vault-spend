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
    let queue = CommandQueue::start();
    move |invoke: Invoke<R>| {
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
}
