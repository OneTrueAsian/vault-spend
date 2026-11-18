// Builds the whole shared practice dataset into one folder: the profile registry the app reads, each profile's
// database, the practice files and a README. `npm run demo` builds it into `.demo-data/`; UAT walk-throughs and
// other automation build it into their own temporary folder. Fictional data only.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { seedFixtureInto } from "../seed.mjs";
import { writePracticeFiles } from "./files.mjs";
import { seedMainHousehold } from "./mainHousehold.mjs";
import { SAM_PY } from "./sam.mjs";

export const MAIN_HOUSEHOLD_NAME = "Rivera household";

const LOCKED_PY = `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Locked Checking', 'checking', '800.00')")
acct = cur.lastrowid
for n, (desc, amt) in enumerate((("Paycheck", "1200.00"), ("Grocery Store", "-86.20"), ("Coffee", "-4.75"))):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, "${new Date().toISOString().slice(0, 7)}-01", desc, amt, None, None, f"locked-{n}"))
`;

function backupStamp(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-090000`;
}

/**
 * Builds the practice dataset into `dir` (created if missing; must not already hold one). `today` (YYYY-MM-DD) is for
 * tests; it defaults to the real date. Returns where everything went.
 */
export async function buildPracticeData(dir, { today } = {}) {
  const profilesDir = path.join(dir, "profiles");
  const mk = (id) => {
    const d = path.join(profilesDir, id);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  const householdDir = mk("household-0");
  await seedMainHousehold(householdDir, { today });

  const samDir = mk("sam-1");
  await seedFixtureInto(samDir, SAM_PY);
  const samBackupsDir = path.join(samDir, "backups");
  fs.mkdirSync(samBackupsDir, { recursive: true });
  const samBackupNames = [`vaultspend-${backupStamp(2)}.db`, `vaultspend-${backupStamp(1)}.db`];
  for (const name of samBackupNames) fs.copyFileSync(path.join(samDir, "vaultspend.db"), path.join(samBackupsDir, name));

  const freshDir = mk("fresh-2");
  await seedFixtureInto(freshDir, "pass");

  // Locked: protected through the app's own code (init_db --protect). The password is made here and written only to
  // the README, which lives in the gitignored practice folder.
  const lockedDir = mk("locked-3");
  await seedFixtureInto(lockedDir, LOCKED_PY);
  const password = crypto.randomBytes(12).toString("base64url");
  const recoveryKey = execFileSync(path.resolve("target/debug/init_db.exe"), [lockedDir, "--protect"], {
    env: { ...process.env, VAULTSPEND_PRACTICE_PASSWORD: password },
    encoding: "utf8",
  }).trim();

  const profiles = [
    { id: "household-0", name: MAIN_HOUSEHOLD_NAME, dir: householdDir, db: path.join(householdDir, "vaultspend.db"), protection: null },
    { id: "sam-1", name: "Sam", dir: samDir, db: path.join(samDir, "vaultspend.db"), protection: null },
    { id: "fresh-2", name: "Fresh start", dir: freshDir, db: path.join(freshDir, "vaultspend.db"), protection: null },
    { id: "locked-3", name: "Locked", dir: lockedDir, db: path.join(lockedDir, "vaultspend-protected.db"), protection: { format: 1 } },
  ];
  const registryPath = path.join(dir, "profiles.json");
  fs.writeFileSync(
    registryPath,
    JSON.stringify(
      { profiles: profiles.map((p) => ({ id: p.id, name: p.name, db_path: p.db, icon_key: null, protection: p.protection, former_plaintext_path: null })) },
      null,
      2,
    ),
  );
  // Pre-selects the main household on the profile selector (it never skips the selector).
  fs.writeFileSync(path.join(dir, "device-settings.json"), JSON.stringify({ last_used_profile_id: "household-0" }, null, 2));

  const filesDir = path.join(dir, "files");
  writePracticeFiles(filesDir);
  fs.mkdirSync(path.join(dir, "second-copy"), { recursive: true }); // a folder to try as the second backup copy

  const readmePath = path.join(dir, "README.txt");
  fs.writeFileSync(
    readmePath,
    [
      "Vault Spend practice data. Every name, bank and amount is made up. Rebuilt by `npm run demo` (keep it with --keep).",
      "",
      `${MAIN_HOUSEHOLD_NAME}: the full household. 15 months of history, Alex and Jordan, every account type, and data for`,
      "  every feature (see e2e/lib/practice-data/COVERAGE.md in the repo). Opt-in features are switched on.",
      "Sam: a small unprotected profile with two backups, for turning on password protection yourself.",
      "Fresh start: an empty profile with every setting at its default, for first-run and empty screens.",
      "Locked: a password-protected profile.",
      `  Password: ${password}`,
      `  Recovery key: ${recoveryKey}`,
      "",
      `Practice files (statement PDFs, CSV downloads) are in ${filesDir}; its README.txt explains each one.`,
      "",
    ].join("\n"),
  );

  return {
    registryPath,
    profiles: profiles.map(({ id, name, dir: d }) => ({ id, name, dir: d })),
    filesDir,
    readmePath,
    samBackupNames,
  };
}
