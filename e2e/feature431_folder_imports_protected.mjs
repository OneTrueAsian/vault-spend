// Watched-folder imports on a password-protected profile (VS-102), in the compiled app.
//
//   - An export saved while the profile is locked is not read or staged while it stays locked (a
//     direct backend call is refused), and is queued once the profile is unlocked.
//   - The saved copy lives inside the encrypted profile data: the export's text appears in no file of
//     the profile's data folder.
//
// Run with: npm run e2e -- --spec=431

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { enableProtectionThroughUI, waitForProtectionSetupCompletion } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";
const SECRET = "QQXZ PROTECTED FOLDER SECRET";
const iso = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const localNow = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Max Checking', 'checking', '100.00')")
`);
const folder = makeTempDir("vaultspend-e2e-folder-protected-");
const exportName = `Bank Max Checking_${iso(1)}.csv`;

const app = await launchApp({ dbDir });
const { browser } = app;

async function call(command, args = {}) {
  return browser.executeAsync(
    (command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })),
    command,
    args,
  );
}
async function invoke(command, args = {}) {
  const result = await call(command, args);
  if (result.error) throw new Error(`${command} failed: ${result.error}`);
  return result.ok;
}

/** Every file under `dir` whose bytes contain `needle`. */
function filesContaining(dir, needle) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    try {
      if (fs.readFileSync(file).includes(Buffer.from(needle))) found.push(path.relative(dir, file));
    } catch {
      // a file held open by the app can't be read; the live database is checked through its other copies
    }
  }
  return found;
}

try {
  await enableProtectionThroughUI(browser, PASSWORD);
  await waitForProtectionSetupCompletion(browser);

  const [account] = await invoke("list_accounts");
  await invoke("set_folder_import_folder", { dir: folder });
  await invoke("save_folder_import_mapping", {
    mapping: { id: null, account_id: account.id, stem: "Bank Max Checking", extensions: ["csv"], invert_amounts: false, initial_cutoff: null },
  });
  await invoke("set_folder_imports_enabled", { enabled: true });

  // Lock, then save an export while locked.
  await (await browser.$(".profile-switcher-toggle")).click();
  await (await browser.$("[data-profile-switcher-lock]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  const file = path.join(folder, exportName);
  fs.writeFileSync(file, `Date,Description,Amount\n${iso(1)},${SECRET},-12.00\n`);
  const minuteAgo = new Date(Date.now() - 60_000);
  fs.utimesSync(file, minuteAgo, minuteAgo);
  // Two discovery passes go by while locked.
  await browser.pause(11000);
  const refused = await call("get_folder_imports");
  assert.ok(refused.error?.startsWith("PROFILE_LOCKED"), `folder imports can't be read while locked: ${JSON.stringify(refused)}`);
  const unlockedAt = localNow();

  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 15000, timeoutMsg: "the password should unlock the profile" });

  await waitUntilOrDiagnose(browser, async () => ((await call("get_folder_imports")).ok?.pending.length ?? 0) === 1, {
    timeout: 20000,
    timeoutMsg: "the export saved while locked should be queued after unlocking",
  });
  const [batch] = (await invoke("get_folder_imports")).pending;
  assert.equal(batch.file_name, exportName);
  assert.ok(batch.detected_at >= unlockedAt, `it was saved only after unlocking (${batch.detected_at} vs ${unlockedAt})`);
  assert.equal((await invoke("list_transactions")).length, 0, "queued, not imported");

  // The staged copy is encrypted with the rest of the profile. The export itself is outside dbDir.
  await invoke("create_backup_now");
  const leaks = filesContaining(dbDir, SECRET);
  assert.deepEqual(leaks, [], `the export's text must not appear in plain form in the profile's files: ${leaks.join(", ")}`);
  assert.ok(fs.readFileSync(file, "utf8").includes(SECRET), "the original export is untouched");
  console.log("PASS feature431 folder imports on a protected profile");
} finally {
  await app.close();
}
