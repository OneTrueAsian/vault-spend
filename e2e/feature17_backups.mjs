// E2E smoke test for local backup snapshots: creates a manual backup from
// the Settings tab, mutates the live data afterward (directly via sqlite,
// simulating something the user did later), restores the backup through
// the real UI button, then confirms the restored data — not the later
// mutation — is what comes back.
//
// Restoring hot-swaps the app's live database connection in place and the
// frontend remounts itself to re-fetch everything (see App.tsx's
// `VaultSpendApp` wrapper and commands.rs's `restore_backup`) — no window
// close/reopen, so this all happens within a single still-running session.
// A real OS-level relaunch was tried first and dropped: on Windows it
// occasionally raced the outgoing WebView2 instance's teardown against the
// new one's startup, leaving the relaunched window stuck on a native
// "can't reach this page" error.
//
// Run with: node e2e/feature17_backups.mjs

import { execFileSync } from "node:child_process";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

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

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-01", "Original", "-10.00", None, f"{checking_id}|2026-08-01|original|-10.00"),
)
`);
const dbPath = path.join(dbDir, "vaultspend.db");

// Session 1: create a manual backup of the seeded (pre-mutation) state.
let app = await launchApp({ dbDir });
try {
  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const backupsCard = await app.browser.$(
    "//div[contains(@class,'card')][.//span[text()='Backups']]",
  );
  await backupsCard.waitForExist({ timeout: 10000 });

  const backUpNowBtn = await app.browser.$("button*=Back up now");
  await backUpNowBtn.click();

  await app.browser.waitUntil(
    async () => (await app.browser.$(".status").getText()).length > 0,
    { timeout: 10000, timeoutMsg: "expected some status message after Back up now" },
  );
  console.log("status right after Back up now:", await (await app.browser.$(".status")).getText());

  await app.browser.waitUntil(
    async () => !(await backupsCard.getText()).includes("No backups yet"),
    { timeout: 10000, timeoutMsg: "expected a backup row to appear after Back up now" },
  );
  const afterBackupText = await backupsCard.getText();
  console.log("backups card (after Back up now):", afterBackupText);
  if (!afterBackupText.includes("KB")) throw new Error(`expected a sized backup row, got:\n${afterBackupText}`);
} finally {
  await app.close();
}

// Mutate the live data after the backup — a change that must NOT survive
// the restore below.
runSqlite(
  dbPath,
  `
cur.execute("SELECT id FROM accounts WHERE name = 'Checking'")
checking_id = cur.fetchone()[0]
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-15", "Added After Backup", "-999.00", None, f"{checking_id}|2026-08-15|added after backup|-999.00"),
)
`,
);

// Session 2: restore the backup through the real UI button, then confirm —
// within this same still-running session, no restart at all — that the
// restored (pre-mutation) data is what's there now.
app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();
  const ledgerText = await (await app.browser.$(".page")).getText();
  if (!ledgerText.includes("Added After Backup")) {
    throw new Error(`expected the post-backup mutation to be visible before restoring, got:\n${ledgerText}`);
  }

  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const restoreBtn = await app.browser.$("button*=Restore");
  await restoreBtn.waitForExist({ timeout: 10000 });
  await restoreBtn.click();
  const confirmRestoreBtn = await app.browser.$("button=Restore");
  await confirmRestoreBtn.waitForExist({ timeout: 5000 });
  await confirmRestoreBtn.click();

  await app.browser.waitUntil(
    async () => (await app.browser.$(".status").getText()).toLowerCase().includes("restored"),
    { timeout: 10000, timeoutMsg: "expected a restore confirmation status message" },
  );
  console.log("status after restore:", await (await app.browser.$(".status")).getText());

  // The whole component tree remounts right after (see VaultSpendApp) —
  // the old nav button handle is gone, so re-query it fresh — and confirm
  // the restored data is what's there, live.
  const ledgerNavAfter = await app.browser.$("button*=Transactions");
  await ledgerNavAfter.waitForExist({ timeout: 10000 });
  await ledgerNavAfter.click();

  await app.browser.waitUntil(
    async () => !(await (await app.browser.$(".page")).getText()).includes("Added After Backup"),
    { timeout: 10000, timeoutMsg: "expected the post-backup mutation to be gone after restoring" },
  );
  const finalLedgerText = await (await app.browser.$(".page")).getText();
  console.log("ledger after restore:", finalLedgerText);
  if (!finalLedgerText.includes("Original")) {
    throw new Error(`expected the original pre-backup transaction to be present, got:\n${finalLedgerText}`);
  }

  console.log("FEATURE 17 E2E TEST PASSED");
} finally {
  await app.close();
}
