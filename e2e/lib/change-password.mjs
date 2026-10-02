// Shared by the change-password specs (feature113, feature152): the passwords, a protected fixture
// with a populated profile, and the change-password dialog walked up to its final confirmation.
import { launchApp } from "../harness.mjs";
import { freshTestDbDir } from "./seed.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./protection.mjs";

export const OLD_PASSWORD = "correct horse battery staple";
export const NEW_PASSWORD = "brand new password!!";

export async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) }));
  }, command, args);
}

export async function prepareChange(browser, currentPassword, newPassword) {
  await (await browser.$("button=Change password…")).click();
  await (await browser.$("#change-password-current")).setValue(currentPassword);
  await (await browser.$("button=Continue")).click();
  await (await browser.$("#change-password-new")).setValue(newPassword);
  await (await browser.$("#change-password-confirm")).setValue(newPassword);
  await (await browser.$("button=Continue")).click();
  const recoveryEl = await browser.$(".change-password-dialog .protection-setup-key");
  await recoveryEl.waitForExist({ timeout: 10000 });
  const recovery = (await recoveryEl.getText()).trim();
  await (await browser.$("button=I've saved it")).click();
  const label0 = await browser.$("label[for='change-password-answer-0']");
  const label1 = await browser.$("label[for='change-password-answer-1']");
  const group0 = Number((await label0.getText()).match(/\d+/)[0]) - 1;
  const group1 = Number((await label1.getText()).match(/\d+/)[0]) - 1;
  const groups = recovery.split("-");
  await (await browser.$("#change-password-answer-0")).setValue(groups[group0]);
  await (await browser.$("#change-password-answer-1")).setValue(groups[group1]);
  return recovery;
}

export async function createProtectedFixture() {
  const testDbDir = freshTestDbDir();
  await seedPopulatedProfile(testDbDir);
  const app = await launchApp({ dbDir: testDbDir });
  await (await app.browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(app.browser, OLD_PASSWORD);
  await app.browser.$("button=Change password…").waitForExist({ timeout: 15000 });
  return { testDbDir, app };
}
