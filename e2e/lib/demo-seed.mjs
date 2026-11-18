// The demo profiles behind `npm run demo` (see e2e/demo.mjs). The main profile is the shared practice household
// (e2e/lib/practice-data/, with every feature's data listed in COVERAGE.md); "Sam" below is the small second profile.

import fs from "node:fs";
import path from "node:path";
import { seedFixtureInto } from "./seed.mjs";
import { seedMainHousehold } from "./practice-data/index.mjs";

/** Creates a fresh demo database in `dbDir` (which must already exist and be
 * empty, or not contain a vaultspend.db yet). */
export async function seedDemoDatabase(dbDir) {
  await seedMainHousehold(dbDir);
}

// ---------------------------------------------------------------------------
// Phase C loose end: a second, already-populated PLAINTEXT profile ("Sam"),
// real but modest — three months of an ordinary checking/savings life, no
// budget or goals of its own (that's what makes it obviously a different,
// smaller household than the main profile) — sitting next to two historical
// plaintext backups, so the demo walker can turn password protection on for
// it live and immediately see Settings' leftover-plaintext-files banner
// (Task 8) offer to clean up real files that really exist on disk.
// ---------------------------------------------------------------------------
const SAM_PY = `
import datetime
today = datetime.date.today()

def days_ago(n):
    return today - datetime.timedelta(days=n)

def acct(name, typ, start, inst=None, mask=None):
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance, institution, mask) VALUES (?,?,?,?,?)",
                (name, typ, start, inst, mask))
    return cur.lastrowid

checking = acct("Sam's Checking", "checking", "1450.00", "Ally", "2290")
savings = acct("Sam's Savings", "savings", "600.00", "Ally", "2291")

fp = [0]
def tx(acc, date, desc, amt, cat, source="user"):
    fp[0] += 1
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acc, date.isoformat(), desc, f"{amt:.2f}", cat, (source if cat else None), f"sam-demo-{fp[0]}"))

tx(checking, days_ago(58), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(44), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(30), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(16), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(2), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(55), "Maple Court Apartments", -820.00, "Rent")
tx(checking, days_ago(27), "Maple Court Apartments", -820.00, "Rent")
tx(checking, days_ago(1), "Maple Court Apartments", -820.00, "Rent")
tx(checking, days_ago(50), "Trader Joe's", -58.40, "Groceries")
tx(checking, days_ago(36), "Trader Joe's", -64.10, "Groceries")
tx(checking, days_ago(22), "Trader Joe's", -71.85, "Groceries")
tx(checking, days_ago(8), "Trader Joe's", -66.30, "Groceries")
tx(checking, days_ago(41), "Spotify", -11.99, "Subscriptions")
tx(checking, days_ago(11), "Spotify", -11.99, "Subscriptions")
tx(checking, days_ago(33), "Metro Transit Pass", -76.00, "Transportation")
tx(checking, days_ago(3), "Metro Transit Pass", -76.00, "Transportation")
tx(checking, days_ago(19), "Noodle House", -24.60, "Dining Out")
tx(checking, days_ago(6), "Noodle House", -18.15, "Dining Out")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
    (checking, days_ago(45), "Transfer to Savings", "-150.00", "Savings Goal", "user", "sam-demo-transfer-out"),
)
out_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
    (savings, days_ago(45), "Transfer from Checking", "150.00", "Savings Goal", "user", "sam-demo-transfer-in"),
)
in_id = cur.lastrowid
cur.execute("INSERT INTO transfer_links (out_transaction_id, in_transaction_id) VALUES (?, ?)", (out_id, in_id))
tx(checking, days_ago(9), "SQ *CORNER BAKERY", -6.75, None)
`;

/**
 * Seeds a two-profile registry for the Phase C demo/UAT walk: "Default" (the full, existing
 * feature-rich dataset every earlier phase's demo has used, unchanged) and "Sam" (a smaller but
 * real plaintext profile with two historical plaintext backups already sitting next to it, ready to
 * be converted to password protection live during the walk). `dbDir` must already exist and be
 * empty. Deliberate behavior change from every earlier phase's demo: with a real `profiles.json`
 * registry now on disk, the app shows the Phase C profile selector on launch instead of opening
 * straight to Default — the correct, intended experience of having created a second profile, and
 * exactly what Task 9 fixed `.setup()` to do (see the plan's Task 9 "DONE" note). No
 * `device-settings.json` is written, so neither profile is pre-selected as "last used".
 *
 * Returns the two plaintext backup filenames actually written for Sam (their timestamps are
 * relative to today, so a UAT check should quote them from this return value or the folder
 * listing, never hard-code a date).
 */
export async function seedDemoRegistry(dbDir) {
  const defaultDir = path.join(dbDir, "profiles", "default-0");
  fs.mkdirSync(defaultDir, { recursive: true });
  await seedDemoDatabase(defaultDir);

  const samDir = path.join(dbDir, "profiles", "sam-1");
  fs.mkdirSync(samDir, { recursive: true });
  await seedFixtureInto(samDir, SAM_PY);

  const samDb = path.join(samDir, "vaultspend.db");
  const samBackupsDir = path.join(samDir, "backups");
  fs.mkdirSync(samBackupsDir, { recursive: true });
  const stamp = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-090000`;
  };
  const backupNames = [`vaultspend-${stamp(2)}.db`, `vaultspend-${stamp(1)}.db`];
  for (const name of backupNames) {
    fs.copyFileSync(samDb, path.join(samBackupsDir, name));
  }

  fs.writeFileSync(
    path.join(dbDir, "profiles.json"),
    JSON.stringify(
      {
        profiles: [
          { id: "default-0", name: "Default", db_path: path.join(defaultDir, "vaultspend.db"), icon_key: null },
          { id: "sam-1", name: "Sam", db_path: samDb, icon_key: null },
        ],
      },
      null,
      2,
    ),
  );

  return { defaultDir, samDir, samBackupsDir, backupNames };
}
