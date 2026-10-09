// E2E test: every screen, in every style, passes axe-core's checks for text contrast (WCAG AA: 4.5:1,
// 3:1 for large text) and page structure (one main landmark, labelled navigation, no empty table
// headers, no skipped heading levels) and click-target size (WCAG 2.5.8: 24px, or enough space around
// a smaller one), in the compiled app on demo data.
//
// The Default style's translucent grays and its #007aff accent fell to 2.6-4.0:1 over the tinted
// glass (2026-10-02 QA, H2: 269 failing elements). Futuristic and Retro are checked too so a token
// change in any style can't bring it back. The structure and target-size rules were the QA's L1 and L3.
//
// Run with: node e2e/feature156_accessibility_checks.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dismissStatusMessages, launchApp } from "./harness.mjs";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const LOOKS = [
  { style: "transparent", theme: "light" },
  { style: "transparent", theme: "dark" },
  { style: "futuristic", theme: "dark" },
  { style: "retro", theme: "light" },
];
const VIEWS = ["Dashboard", "Accounts", "Transactions", "Recurring", "Budget", "Goals", "Cash Flow", "Investments", "Household", "Reports", "Settings", "Help"];
const RULES = ["color-contrast", "landmark-one-main", "landmark-unique", "empty-table-header", "heading-order", "target-size"];

const dbDir = freshTestDbDir();
await seedDemoDatabase(dbDir);
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await browser.setWindowSize(1280, 800);
  const failures = [];
  for (const look of LOOKS) {
    await browser.execute((l) => {
      localStorage.setItem("meadow-theme-style", l.style);
      localStorage.setItem("meadow-theme", l.theme);
      localStorage.setItem("meadow-reduce-motion", "on");
      location.reload();
    }, look);
    await (await browser.$(".nav-item")).waitForExist({ timeout: 20000 });
    await browser.waitUntil(() => browser.execute((s) => document.documentElement.dataset.palette === s, look.style), { timeout: 5000 });
    await browser.execute(AXE);
    for (const view of VIEWS) {
      await dismissStatusMessages(browser);
      await browser.execute((v) => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === v).click(), view);
      await browser.waitUntil(() => browser.execute((v) => document.querySelector(".view-title")?.textContent.trim().toLowerCase() === v.toLowerCase(), view), {
        timeout: 10000,
        timeoutMsg: `${view} never showed`,
      });
      await browser.pause(400); // charts and lazy sections settle
      if (view === "Recurring") {
        const inactiveStatus = await browser.$('.status-pill:not(.status-pill-active)');
        if (await inactiveStatus.isExisting()) {
          await inactiveStatus.moveTo();
          await browser.pause(150); // Check the real hover state after its background transition.
        }
      }
      const nodes = await browser.executeAsync(
        (rules, done) =>
          window.axe.run(document, { runOnly: rules }).then((r) =>
            done(
              r.violations.flatMap((v) =>
                v.nodes.map((n) =>
                  v.id === "color-contrast"
                    ? `contrast: ${n.target.join(" ")} — ${n.any[0]?.data?.fgColor} on ${n.any[0]?.data?.bgColor} at ${n.any[0]?.data?.contrastRatio}:1`
                    : `${v.id}: ${n.target.join(" ")}`,
                ),
              ),
            ),
          ),
        RULES,
      );
      for (const n of nodes) failures.push(`${look.style}/${look.theme} ${view}: ${n}`);
    }
  }
  assert.deepEqual(failures, [], `accessibility problems:\n${failures.slice(0, 200).join("\n")}`);
  console.log("FEATURE 156 E2E TEST PASSED");
} finally {
  await app.close();
}
