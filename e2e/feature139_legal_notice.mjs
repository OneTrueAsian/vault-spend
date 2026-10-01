// The legal notice in the compiled app (the harness normally skips it; this spec opts back in):
//   - a first launch shows the notice, and not the app, with no "what changed" line;
//   - pressing "OK, I've read this" opens the app, and a relaunch on the same data folder does not show
//     the notice again;
//   - Help's entry says when this computer acknowledged the notice and holds the full text;
//   - a computer that acknowledged an older version is shown the notice again, with what changed.
//
// Run with: node e2e/run-all.mjs --spec=139

import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const NOTICE = "[data-legal-notice]";
const dbDir = await seedFixture("");

async function expectNotice(browser) {
  await browser.$(NOTICE).waitForExist({ timeout: 10000, timeoutMsg: "the legal notice should be showing" });
  if (await browser.$(".brand-word").isExisting()) throw new Error("the app must not be showing behind the legal notice");
}

// 1. First launch: the notice, then the app.
{
  const app = await launchApp({ dbDir, ready: NOTICE, showLegalNotice: true });
  try {
    const { browser } = app;
    await expectNotice(browser);
    const text = await browser.$(NOTICE).getText();
    if (!/Version \d{4}-\d{2}-\d{2}/.test(text)) throw new Error(`the notice should state its version:\n${text}`);
    if (await browser.$("[data-legal-notice-changed]").isExisting()) throw new Error("a first launch has nothing to show as changed");
    await (await browser.$("[data-legal-notice-ok]")).click();
    await browser.$(".brand-word").waitForExist({ timeout: 15000, timeoutMsg: "the app should open after the notice is acknowledged" });
    if (await browser.$(NOTICE).isExisting()) throw new Error("the notice should be gone once acknowledged");
    console.log("  ok: first launch shows the notice, acknowledging opens the app");
  } finally {
    await app.close();
  }
}

// 2. Relaunch on the same folder: no notice. Help says when it was acknowledged.
{
  const app = await launchApp({ dbDir, showLegalNotice: true });
  try {
    const { browser } = app;
    if (await browser.$(NOTICE).isExisting()) throw new Error("an acknowledged version must not be shown again");
    await (await browser.$("button*=Help")).click();
    const searchInput = await browser.$(".help-search");
    await searchInput.waitForExist({ timeout: 10000 });
    await searchInput.setValue("disclaimer");
    const status = await browser.$("[data-legal-notice-status]");
    await status.waitForExist({ timeout: 10000, timeoutMsg: "Help should show the acknowledgement" });
    await browser.waitUntil(async () => /^Acknowledged on /.test(await status.getText()), {
      timeout: 10000,
      timeoutMsg: `Help should say when the notice was acknowledged, it says: ${await status.getText()}`,
    });
    const page = await browser.$(".help-view").getText();
    if (!page.includes("Where can I read the legal notice?")) throw new Error("searching for 'disclaimer' should find the legal notice entry");
    console.log("  ok: relaunch skips the notice and Help shows the acknowledgement");
  } finally {
    await app.close();
  }
}

// 3. An older acknowledged version: the notice comes back, with what changed.
{
  const file = path.join(dbDir, "device-settings.json");
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  settings.legal_notice_version = "2020-01-01"; // fixed date: a notice version older than any real one
  fs.writeFileSync(file, JSON.stringify(settings));
  const app = await launchApp({ dbDir, ready: NOTICE, showLegalNotice: true });
  try {
    const { browser } = app;
    await expectNotice(browser);
    const changed = await browser.$("[data-legal-notice-changed]");
    await changed.waitForExist({ timeout: 5000, timeoutMsg: "an older acknowledgement should be told what changed" });
    if (!(await changed.getText()).includes("What changed")) throw new Error("the what-changed line should say so");
    console.log("  ok: a newer notice version is shown again with what changed");
  } finally {
    await app.close();
  }
}
