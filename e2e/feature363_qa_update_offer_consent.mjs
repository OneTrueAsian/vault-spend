// Controlled compiled-renderer update UI. Publisher responses and installer operations are
// explicit fixtures; no network, download, native installer handoff or release is performed.
// Actual native command containment is covered separately by feature282.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, waitForDataLoaded, openSettingsGroup } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { ensureAxe, waitForVisualStability } from "./lib/axeSession.mjs";
import { installUpdaterFixture } from "./lib/updateUiFixture.mjs";

const app = await launchApp({ dbDir: await seedFixture("") });
const b = app.browser;
const shots = process.env.VS_UPDATE_UI_SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
try {
  await b.execute(installUpdaterFixture);
  // The real profile-create gesture remounts the real App and UpdateBanner while
  // preserving this document's fixture bridge. No financial command is stubbed.
  await b.$('.nav-item[data-tab="settings"]').click();
  await openSettingsGroup(b, "profiles");
  await b.$('.profile-create-form input').setValue("QA Update UI");
  await b.$('.profile-create-form button[type="submit"]').click();
  await waitForDataLoaded(b);
  await b.$("//div[contains(@class,'update-banner')]//button[normalize-space()='Download update']").waitForDisplayed({ timeout: 10000 });
  assert.match(await b.$('.update-banner').getText(), /1\.3\.2.*signed installer/s);
  await b.$("//div[contains(@class,'update-banner')]//button[normalize-space()='Download update']").click(); // fixture only
  await b.$("//div[contains(@class,'update-banner')]//button[normalize-space()='Open verified installer']").waitForDisplayed({ timeout: 10000 });
  const calls = () => b.execute(() => window.__qaUpdateFixture.calls);
  assert.equal((await calls()).filter(x => x.command === "install_signed_update").length, 0);

  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(b, style, palette);
    for (const theme of ["light", "dark"]) {
      await b.$(`//div[contains(@class,'appearance-theme')]//button[normalize-space()='${theme === "light" ? "Light" : "Dark"}']`).click();
      for (const width of [720, 960, 1280]) {
        await b.setWindowSize(width, 900);
        await b.$("//div[contains(@class,'update-banner')]//button[normalize-space()='Open verified installer']").click();
        await b.$('[role="dialog"]').waitForDisplayed({ timeout: 5000 });
        await waitForVisualStability(b);
        const text = await b.$('[role="dialog"]').getText();
        assert.match(text, /Open verified installer\?/);
        assert.match(text, /financial data is not part of the download/);
        const box = await b.execute(() => {
          const d = document.querySelector('[role="dialog"]'), r = d.getBoundingClientRect();
          return { x: r.x, right: r.right, width: innerWidth, overflow: d.scrollWidth > d.clientWidth + 1, focusInside: d.contains(document.activeElement) };
        });
        assert.ok(box.x >= 0 && box.right <= box.width + 1 && !box.overflow && box.focusInside, JSON.stringify(box));
        await ensureAxe(b);
        if (shots) await b.saveScreenshot(path.join(shots, `${style}-${theme}-${width}-consent.png`));
        const violations = await b.executeAsync(done => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }).then(r => done(r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, summary: n.failureSummary, checks: n.any })) })))));
        if (shots && violations.length) fs.writeFileSync(path.join(shots, `${style}-${theme}-${width}-violations.json`), JSON.stringify(violations, null, 2));
        assert.deepEqual(violations, [], `${style}/${theme}/${width}: ${JSON.stringify(violations)}`);
        await b.$('//div[@role="dialog"]//button[normalize-space()="Not now"]').click();
        await b.waitUntil(() => b.execute(() => !document.querySelector('[role="dialog"]')), { timeout: 5000 });
        assert.equal((await calls()).filter(x => x.command === "install_signed_update").length, 0, "closing the confirmation never consents");
      }
    }
  }
  await b.$("//div[contains(@class,'update-banner')]//button[normalize-space()='Open verified installer']").click();
  await b.$('//div[@role="dialog"]//button[normalize-space()="Open installer"]').click(); // fixture records consent, never calls native installer
  await b.waitUntil(async () => (await calls()).filter(x => x.command === "install_signed_update").length === 1, { timeout: 5000 });
  const installed = (await calls()).find(x => x.command === "install_signed_update");
  assert.equal(installed.args.token, "a".repeat(64));
  assert.equal((await calls()).filter(x => x.command === "download_signed_update").length, 1);
  console.log("FEATURE 363 CONTROLLED UPDATE UI AND CONSENT PASSED (fixtures; no download or installer execution)");
} finally {
  await app.close();
}
