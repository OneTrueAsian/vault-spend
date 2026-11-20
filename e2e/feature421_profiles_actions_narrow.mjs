// VS-54: Settings > Profiles & security at 720 wide. Each other profile's row has Switch, Rename and Delete;
// the table used the ledger's fixed column shares, so the buttons ran past the table edge and Delete could
// not be clicked. Every action button must sit inside the table and take a click at its centre, at 720 and
// 1280, in Default and Retro. Screenshots go through saveScreenshot, so --keep-screens keeps them.
// Run with: npm run e2e -- --spec=421

import path from "node:path";
import { chooseStyle, dismissFirstLaunchDialogs, dismissStatusMessages, launchApp, openSettingsGroup, waitForDataLoaded, waitUntilOrDiagnose } from "./harness.mjs";
import { seedProfiles } from "./lib/protection.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature421-");
const dbDir = await seedProfiles([{ name: "Rivera household" }, { name: "Sam" }, { name: "Fresh start" }], { lastUsed: "Rivera household" });
const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
const b = app.browser;
try {
  await b.execute(() => [...document.querySelectorAll("[data-profile-option]")].find((e) => e.textContent.includes("Rivera household")).click());
  await b.$(".brand-word").waitForExist({ timeout: 20000 });
  await waitForDataLoaded(b);
  await dismissFirstLaunchDialogs(b);
  await dismissStatusMessages(b);

  for (const [style, palette] of [["Default", "transparent"], ["Retro", "retro"]]) {
    await chooseStyle(b, style, palette);
    for (const width of [720, 1280]) {
      await b.setWindowSize(width, 900);
      await openSettingsGroup(b, "profiles");
      await dismissStatusMessages(b);
      await b.execute(() => document.querySelector('[data-setting-card="profiles"]').scrollIntoView({ block: "start" }));
      let geometry = null;
      await waitUntilOrDiagnose(
        b,
        async () => {
          geometry = await b.execute(() => {
            const table = document.querySelector('[data-setting-card="profiles"] table');
            const t = table.getBoundingClientRect();
            const buttons = [...table.querySelectorAll("button")].map((button) => {
              const r = button.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return {
                label: button.textContent.trim() || button.getAttribute("aria-label"),
                inside: r.left >= t.left - 1 && r.right <= t.right + 1,
                clickable: hit === button || button.contains(hit),
              };
            });
            return { deletes: buttons.filter((x) => x.label === "Delete").length, buttons };
          });
          return geometry.deletes === 2 && geometry.buttons.every((x) => x.inside && x.clickable);
        },
        {
          timeoutMsg: `${style} ${width}: every profile action should sit inside the table and take a click`,
          extra: () => geometry,
        },
      );
      await b.saveScreenshot(path.join(shots, `421-profiles-${palette}-${width}.png`));
    }
  }
  console.log("Profiles & security: Switch, Rename and Delete fit and take clicks at 720 and 1280 — OK");
} finally {
  await app.close();
}
