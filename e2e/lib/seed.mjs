// Seeds a throwaway test database with fixture data, using a small headless
// binary (core/src/bin/init_db.rs — the exact same Store::open migration
// path the real app and every Rust test already use) once to create the
// schema, then writing fixture rows directly via Python's sqlite3 module
// (the same direct-sqlite technique used all session to verify the user's
// real data). Avoids needing to drive native file-picker dialogs (CSV
// import) just to get test data into the ledger.
//
// This used to launch the full Tauri app and sleep 2 seconds (1.5s to let
// init_schema run, 0.5s after killing it) per seed call — dozens of times
// across the suite. init_db is synchronous and exits on its own once the
// schema is ready, so there's nothing to sleep for: ~20-200ms instead of a
// blind 2000ms, verified via `time ./target/debug/init_db.exe <dir>`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const INIT_DB_EXE = path.resolve("target/debug/init_db.exe");

// Cleaned up automatically on a genuinely clean process exit (see the
// process.on("exit") below) — a nonzero exit code means the spec is
// reporting a failure, so the fixture is left in place for debugging.
export function freshTestDbDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-e2e-"));
  process.on("exit", () => {
    if ((process.exitCode ?? 0) === 0) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort — never fail the run over cleanup */
      }
    }
  });
  return dir;
}

// Runs init_db against `dbDir` so the real migration path creates
// vaultspend.db, then returns once it has actually exited — no sleeps.
async function createSchema(dbDir) {
  execFileSync(INIT_DB_EXE, [dbDir], { stdio: "ignore" });
}

// Runs a python snippet against the db, with `dbPath` available as `DB_PATH`.
function runSqlite(dbPath, pySnippet) {
  const script = `
import sqlite3
con = sqlite3.connect(r"${dbPath}")
cur = con.cursor()
${pySnippet}
con.commit()
con.close()
`;
  execFileSync("python", ["-c", script], { stdio: "inherit" });
}

/**
 * Generic fixture helper: creates a fresh test DB dir (schema only), then
 * runs the given python sqlite3 snippet against it (available as `cur`/
 * `con`). Returns the dbDir. Use this for any feature-specific fixture
 * instead of writing a new one-off createSchema+runSqlite pair.
 *
 * Note: `createSchema` only runs migrations (via init_db) — it does not run
 * the real app's normal startup fetches, so unlike an actual app launch it
 * does not pre-materialize an empty `budget_periods` row for the current
 * calendar month. If your snippet inserts into `budget_periods` for the
 * current month, use `INSERT OR IGNORE` anyway in case that ever changes.
 */
export async function seedFixture(pySnippet) {
  const dbDir = freshTestDbDir();
  await createSchema(dbDir);
  runSqlite(path.join(dbDir, "vaultspend.db"), pySnippet);
  return dbDir;
}

/**
 * Seeds a fresh test DB dir with:
 * - a "Checking" account (checking, starting balance 1000)
 * - a "Car Loan" account (loan, starting balance 10000)
 * - one transaction in Checking: "Loan Payment", -500.00, dated 2026-08-20
 * Returns the dbDir.
 */
export async function seedDebtPaymentFixture() {
  const dbDir = freshTestDbDir();
  await createSchema(dbDir);
  const dbPath = path.join(dbDir, "vaultspend.db");
  runSqlite(
    dbPath,
    `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Car Loan', 'loan', '10000.00')")
loan_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-20", "Loan Payment", "-500.00", "Transfer", f"{checking_id}|2026-08-20|loan payment|-500.00"),
)
`,
  );
  return dbDir;
}
