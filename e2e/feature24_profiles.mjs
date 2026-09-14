// E2E smoke test for separate profiles: creates a second, completely
// independent profile from the Settings tab, confirms the app remounts
// into an empty ledger (proving real data isolation, not just a filtered
// view), then switches back to Default and confirms the original seeded
// data reappears.
//
// Like restoring a backup or relocating the data file, creating/switching
// a profile hot-swaps the app's live database connection in place and the
// frontend remounts itself to re-fetch everything (see App.tsx's
// `VaultSpendApp` wrapper and commands.rs's `create_profile`/
// `switch_profile`) — no window close/reopen, all within one still-running
// session.
//
// Run with: node e2e/feature24_profiles.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-05", "Default Profile Groceries", "-40.00", None, f"{checking_id}|2026-08-05|default profile groceries|-40.00"),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();
  const seededLedgerText = await (await app.browser.$(".page")).getText();
  if (!seededLedgerText.includes("Default Profile Groceries")) {
    throw new Error(`expected the seeded fixture data to be visible before touching profiles, got:\n${seededLedgerText}`);
  }

  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const profilesCard = await app.browser.$("//div[contains(@class,'card')][.//span[text()='Profiles']]");
  await profilesCard.waitForExist({ timeout: 10000 });
  const beforeText = await profilesCard.getText();
  console.log("profiles card before creating one:", beforeText);
  if (!beforeText.includes("Default") || !beforeText.includes("current")) {
    throw new Error(`expected a synthesized "Default (current)" profile, got:\n${beforeText}`);
  }

  // Create a second, completely independent profile.
  const newProfileInput = await profilesCard.$("input");
  await newProfileInput.setValue("Alex");
  const newProfileButton = await profilesCard.$("button*=New profile");
  await newProfileButton.click();

  await app.browser.waitUntil(
    async () => (await app.browser.$(".status").getText()).toLowerCase().includes("alex"),
    { timeout: 10000, timeoutMsg: "expected a status message confirming the switch to the new Alex profile" },
  );
  console.log("status after creating Alex:", await (await app.browser.$(".status")).getText());

  // The whole tree remounts right after (see VaultSpendApp) — re-query
  // fresh — and the new profile must start completely empty, not a
  // filtered view of Default's data.
  const ledgerNavAfterCreate = await app.browser.$("button*=Transactions");
  await ledgerNavAfterCreate.waitForExist({ timeout: 10000 });
  await ledgerNavAfterCreate.click();
  await app.browser.waitUntil(
    async () => !(await (await app.browser.$(".page")).getText()).includes("Default Profile Groceries"),
    { timeout: 10000, timeoutMsg: "expected Alex's ledger to be empty, not showing Default's data" },
  );
  console.log("Alex's profile starts empty, as expected");

  // Settings should now list both profiles, Alex marked current, with a
  // "Switch" button offered for Default.
  const settingsNavAfterCreate = await app.browser.$("button*=Settings");
  await settingsNavAfterCreate.click();
  const profilesCardAfterCreate = await app.browser.$("//div[contains(@class,'card')][.//span[text()='Profiles']]");
  await profilesCardAfterCreate.waitForExist({ timeout: 10000 });
  const afterCreateText = await profilesCardAfterCreate.getText();
  console.log("profiles card after creating Alex:", afterCreateText);
  if (!afterCreateText.includes("Alex") || !afterCreateText.includes("Default")) {
    throw new Error(`expected both Default and Alex listed, got:\n${afterCreateText}`);
  }

  // Switch back to Default.
  const switchToDefaultBtn = await profilesCardAfterCreate.$("//tr[td[contains(.,'Default')]]//button[text()='Switch']");
  await switchToDefaultBtn.waitForExist({ timeout: 5000 });
  await switchToDefaultBtn.click();

  await app.browser.waitUntil(
    async () => (await app.browser.$(".status").getText()).toLowerCase().includes("default"),
    { timeout: 10000, timeoutMsg: "expected a status message confirming the switch back to Default" },
  );
  console.log("status after switching back to Default:", await (await app.browser.$(".status")).getText());

  const ledgerNavAfterSwitch = await app.browser.$("button*=Transactions");
  await ledgerNavAfterSwitch.waitForExist({ timeout: 10000 });
  await ledgerNavAfterSwitch.click();
  await app.browser.waitUntil(
    async () => (await (await app.browser.$(".page")).getText()).includes("Default Profile Groceries"),
    { timeout: 10000, timeoutMsg: "expected Default's original seeded data to reappear after switching back" },
  );
  console.log("Default's original data reappeared after switching back");

  // Back on Settings, Default is now active — Alex is the inactive one.
  const settingsNavAgain = await app.browser.$("button*=Settings");
  await settingsNavAgain.click();
  const profilesCardAgain = await app.browser.$("//div[contains(@class,'card')][.//span[text()='Profiles']]");
  await profilesCardAgain.waitForExist({ timeout: 10000 });

  // The active profile (Default) must not offer a Delete button at all —
  // there's nothing to hot-swap to if it were deleted.
  const defaultRow = await profilesCardAgain.$("//tr[td[contains(.,'Default')]]");
  const defaultRowText = await defaultRow.getText();
  if (defaultRowText.includes("Delete")) {
    throw new Error(`expected no Delete option for the active (Default) profile, got row text:\n${defaultRowText}`);
  }
  console.log("active profile correctly offers no Delete option");

  // Rename Alex. The row swaps to an <input autoFocus ... onBlur={commit}>
  // the instant "Rename" is clicked — clicking that freshly-mounted,
  // already-focused input (needed because setValue() races a re-render
  // and loses the element, per feature18_recurring_edit.mjs) can itself
  // dispatch a spurious blur first, committing the untouched name and
  // reverting the row before the click lands or the keys typed after it
  // reach anything. Re-clicking "Rename" is a safe, idempotent recovery
  // (a no-op if already mid-edit), so retry the whole handshake — same
  // fix as feature11_assets.mjs's identical race on its own onBlur-commit
  // amount editor.
  const renameBtnXPath = "//tr[td[contains(.,'Alex')]]//button[text()='Rename']";
  let renameOpened = false;
  for (let attempt = 1; attempt <= 5 && !renameOpened; attempt++) {
    try {
      const alexRenameBtn = await profilesCardAgain.$(renameBtnXPath);
      await alexRenameBtn.waitForExist({ timeout: 5000 });
      await alexRenameBtn.click();
      const renameInput = await profilesCardAgain.$(".row-edit-input");
      await renameInput.waitForExist({ timeout: 1000 });
      await renameInput.click();
      if (await renameInput.isExisting()) renameOpened = true;
    } catch {
      // Element vanished mid-handshake (the race this loop exists for) —
      // fall through and retry from the top.
    }
  }
  if (!renameOpened) throw new Error('expected the rename input to appear and stay open after clicking "Rename"');

  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("Alexandra");
  await app.browser.keys("Enter");

  await app.browser.waitUntil(async () => (await profilesCardAgain.getText()).includes("Alexandra"), {
    timeout: 10000,
    timeoutMsg: "expected the renamed profile to show as Alexandra",
  });
  console.log("profile renamed to Alexandra");

  // Delete Alexandra (inactive) via the inline confirm pattern.
  const alexandraDeleteBtn = await profilesCardAgain.$("//tr[td[contains(.,'Alexandra')]]//button[text()='Delete']");
  await alexandraDeleteBtn.waitForExist({ timeout: 5000 });
  await alexandraDeleteBtn.click();
  const confirmDeleteBtn = await profilesCardAgain.$("//tr[td[contains(.,'Alexandra')]]//button[text()='Delete']");
  await confirmDeleteBtn.waitForExist({ timeout: 5000 });
  await confirmDeleteBtn.click();

  await app.browser.waitUntil(async () => !(await profilesCardAgain.getText()).includes("Alexandra"), {
    timeout: 10000,
    timeoutMsg: "expected Alexandra to be gone from the profiles list after deleting",
  });
  console.log("inactive profile deleted successfully");

  console.log("FEATURE 24 E2E TEST PASSED");
} finally {
  await app.close();
}
