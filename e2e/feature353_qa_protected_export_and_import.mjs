// UAT-020 / UAT-200 protected exports and handling, through the real gestures with the native Save and Open dialogs answered by the harness stubs:
//   a protected profile's "Export a copy" writes a .vaultspend package (manifest, encrypted database, key file; no plain text of the data anywhere in it),
//   "Use existing file -> Protected package" imports it as a new profile only with the right password, and the imported profile holds the data.
// The pre-existing feature118 does the same round trip through direct commands; this spec is the user's path. Fictional data only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { launchApp, stubFilePicker, stubSaveDialog, waitUntilOrDiagnose, openSettingsGroup } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";
const testDbDir = freshTestDbDir();
await seedPopulatedProfile(testDbDir);
const packagePath = path.join(testDbDir, "portable-profile.vaultspend");
const app = await launchApp({ dbDir: testDbDir });
const { browser: b } = app;
async function invoke(command, args = {}) {
  return b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then(ok => done({ ok }), e => done({ error: String(e?.message ?? e) })), command, args);
}
const statusTexts = () => b.execute(() => [...document.querySelectorAll(".status .status-text, [role='alert']")].map(n => n.textContent.trim()).filter(Boolean));
async function waitStatus(fragment) {
  let seen = [];
  await waitUntilOrDiagnose(b, async () => (seen = await statusTexts()).some(t => t.includes(fragment)), { timeout: 30000, timeoutMsg: `a message containing "${fragment}" shows`, extra: () => seen });
  return seen.find(t => t.includes(fragment));
}
const dialogText = () => b.execute(() => document.querySelector("[role='dialog']")?.innerText ?? "");
try {
  await b.setWindowSize(1440, 1200);
  await (await b.$("button*=Settings")).click();
  await enableProtectionThroughUI(b, PASSWORD);
  await b.$("button=Change password").waitForExist({ timeout: 20000 });
  await openSettingsGroup(b, "data");

  // --- export ------------------------------------------------------------------------------------------------------------------------------------------------
  await stubSaveDialog(b, [packagePath]);
  await (await b.$("button*=Export a copy")).click();
  const done = await waitStatus("Exported a copy to");
  assert.ok(done.includes(packagePath), done);
  assert.ok(fs.statSync(packagePath).isDirectory(), "a protected export is a package folder");
  for (const f of ["manifest.json", "vaultspend.db", "vaultspend.db.key"]) assert.ok(fs.existsSync(path.join(packagePath, f)), `the package holds ${f}`);
  const db = fs.readFileSync(path.join(packagePath, "vaultspend.db"));
  assert.notEqual(db.subarray(0, 15).toString("latin1"), "SQLite format 3", "the exported database is encrypted, not a plain SQLite file");
  for (const secret of ["Market Basket", "Checking", "Groceries"]) assert.ok(!db.includes(Buffer.from(secret)), `"${secret}" is not readable in the exported database`);
  for (const f of fs.readdirSync(packagePath)) assert.ok(!fs.readFileSync(path.join(packagePath, f)).includes(Buffer.from(PASSWORD)), `${f} does not hold the password`);
  const packageHashes = () => fs.readdirSync(packagePath).sort().map(f => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(packagePath, f))).digest("hex")]);
  const packageBefore = packageHashes();

  // --- import: the choice, a wrong password, then the right one -------------------------------------------------------------------------------------------------------
  await stubFilePicker(b, [packagePath, packagePath]);
  const importIt = async (password) => {
    await openSettingsGroup(b, "profiles");
    await (await b.$("button*=Use existing file")).click();
    await (await b.$("button.choice-card*=Protected package")).click();
    await waitUntilOrDiagnose(b, async () => (await dialogText()).includes("Import a protected profile"), { timeout: 10000, timeoutMsg: "the import dialog opens", extra: dialogText });
    assert.ok((await dialogText()).includes("The package stays unchanged."));
    await (await b.$("//div[@role='dialog']//label[.//span[normalize-space()='Profile name']]//input")).setValue("Imported protected profile");
    await (await b.$("//div[@role='dialog']//input[@type='password']")).setValue(password);
    await (await b.$("//div[@role='dialog']//button[normalize-space()='Import profile']")).click();
  };
  await importIt("not the password");
  await waitUntilOrDiagnose(b, async () => /password didn.t work|wrong|incorrect/i.test((await dialogText()) + (await statusTexts()).join(" ")), { timeout: 20000, timeoutMsg: "a wrong package password is refused in words", extra: async () => (await dialogText()) + (await statusTexts()).join(" | ") });
  const refusal = (await dialogText()) + " " + (await statusTexts()).join(" ");
  assert.ok(!/panic|argon|\b0x[0-9a-f]+\b|\.rs:/i.test(refusal), "no technical wording in the refusal: " + refusal);
  assert.ok(!(await invoke("list_profiles")).ok.some(p => p.name === "Imported protected profile"), "a wrong password added nothing");
  await (await b.$("//div[@role='dialog']//button[normalize-space()='Cancel']")).click();
  await importIt(PASSWORD);
  await waitUntilOrDiagnose(b, async () => (await invoke("list_profiles")).ok.some(p => p.name === "Imported protected profile" && p.is_active), { timeout: 60000, timeoutMsg: "the right password imports the package as the active profile" });
  const profile = (await invoke("list_profiles")).ok.find(p => p.name === "Imported protected profile");
  assert.equal(profile.is_password_protected, true, "the imported profile is still protected");
  assert.ok((await invoke("list_transactions")).ok.some(t => t.description === "Market Basket"), "the imported profile holds the exported data");
  assert.deepEqual(packageHashes(), packageBefore, "every exported package file remains byte-identical after both import attempts");
  console.log("FEATURE 353 PASSED: protected export writes an encrypted package; import needs the password and brings the data back.");
} finally { await app.close(); }
