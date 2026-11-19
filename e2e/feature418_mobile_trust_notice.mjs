// Starting Mobile access with a phone-connection identity saved the pre-1.3.4 way (an unconstrained root)
// replaces it instead of starting: paired phones are signed out and Mobile settings tells the person to set
// their phone up again. Launching the app with such an identity changes nothing, but Mobile settings shows
// the same notice (and it is still there after another relaunch) until the person starts setup. The outdated identity comes from the debug-only debug_seed_outdated_mobile_identity
// command (disposable data only). Screenshots go through saveScreenshot, so
// `npm run e2e -- --spec=418 --keep-screens` keeps them.
// Run with: npm run e2e -- --spec=418

import assert from "node:assert/strict";
import { launchApp, openSettingsGroup } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { saveSecurityShot } from "./lib/securityShots.mjs";
import { client, ipc, pair } from "./mobileHttpsHarness.mjs";

const NOTICE =
  "Vault Spend updated how your phone connects. Set up your phone again, and remove the old Vault Spend certificate from your phone's settings.";

const app = await launchApp();
try {
  const { browser } = app;
  const openMobileSettings = async () => {
    await (await browser.$("button*=Dashboard")).click();
    await openSettingsGroup(browser, "data");
    await browser.$("[data-mobile-settings]").waitForExist({ timeout: 5000 });
  };
  await openSettingsGroup(browser, "data");
  await browser.$("[data-mobile-settings]").waitForExist({ timeout: 5000 });
  assert.equal(await browser.$(".mobile-trust-notice").isExisting(), false, "no notice before anything was replaced");

  // A paired phone, through the disposable HTTPS fixture.
  const [server, certificate] = await ipc(app, "debug_start_mobile_asset_server");
  const request = client(server.origin, certificate.pem);
  const profile = (await ipc(app, "list_profiles"))[0];
  await pair(app, request, [profile.id], "Old phone");
  assert.equal((await ipc(app, "mobile_list_devices")).length, 1, "the phone should be paired before the identity is replaced");

  // Save an identity the old way, then start Mobile access. The network does not need to exist: the outdated
  // root is replaced before the network is looked at.
  await ipc(app, "debug_seed_outdated_mobile_identity");
  const status = await ipc(app, "mobile_configure", {
    config: { enabled: true, ipv4: "192.168.1.20", port: 8443, interface: "e2e-absent-interface", identity_initialized: true, hostname: null },
  });
  assert.equal(status.running, false, "Mobile access must not start on the outdated identity");
  assert.equal(status.trustReplaced, true);
  assert.deepEqual(await ipc(app, "mobile_list_devices"), [], "paired phones must be signed out");

  // Mobile settings shows the notice above the setup button.
  await openMobileSettings();
  await browser.waitUntil(async () => (await browser.$(".mobile-trust-notice").isExisting()), { timeout: 8000, timeoutMsg: "Mobile settings should show the replaced-connection notice" });
  assert.equal((await browser.$(".mobile-trust-notice").getText()).trim(), NOTICE);
  const order = await browser.execute(() => {
    const notice = document.querySelector("[data-mobile-settings] .mobile-trust-notice").getBoundingClientRect();
    const button = [...document.querySelectorAll("[data-mobile-settings] button")].find((b) => b.textContent === "Set up a phone").getBoundingClientRect();
    return { noticeBottom: notice.bottom, buttonTop: button.top };
  });
  assert.ok(order.noticeBottom <= order.buttonTop, "the notice must sit above the setup button");
  assert.ok((await browser.$("[data-mobile-settings]").getText()).includes("Mobile access is stopped"), "Mobile access stays stopped");
  await browser.execute(() => document.querySelector("[data-mobile-settings] .mobile-trust-notice").scrollIntoView({ block: "center" }));
  await saveSecurityShot(browser, "mobile-set-up-again-notice.png");
} finally {
  await app.close();
}

// Launch path: an outdated identity is left alone at launch, and the notice is waiting in Mobile settings,
// across more than one relaunch, because it is read from the saved identity and not from this session.
{
  const dbDir = freshTestDbDir();
  const seeding = await launchApp({ dbDir });
  try {
    await ipc(seeding, "debug_seed_outdated_mobile_identity");
  } finally {
    await seeding.close();
  }
  for (const launch of [1, 2]) {
    const relaunched = await launchApp({ dbDir });
    try {
      const { browser } = relaunched;
      await openSettingsGroup(browser, "data");
      await browser.$("[data-mobile-settings]").waitForExist({ timeout: 5000 });
      await browser.waitUntil(async () => (await browser.$(".mobile-trust-notice").isExisting()), {
        timeout: 8000,
        timeoutMsg: `relaunch ${launch}: Mobile settings should show the notice for an outdated identity`,
      });
      assert.equal((await browser.$(".mobile-trust-notice").getText()).trim(), NOTICE);
      const status = await ipc(relaunched, "mobile_server_status");
      assert.equal(status.running, false, "Mobile access must not run on the outdated identity");
      assert.equal(status.trustReplaced, true);
      if (launch === 1) await saveSecurityShot(browser, "mobile-set-up-again-pending.png");
    } finally {
      await relaunched.close();
    }
  }
}

console.log("FEATURE 418 E2E TEST PASSED");
