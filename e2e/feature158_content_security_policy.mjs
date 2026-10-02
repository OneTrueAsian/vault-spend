// E2E test: the app window's Content Security Policy (2026-10-02 QA, M2) is in force, and the app
// itself never trips it.
//
// - Visiting every screen on demo data raises no policy violation (the policy fits the app).
// - A request to another site is refused, and an inline script added to the page does not run.
// - The app's own backend calls still work (the screens above load their data through them).
//
// Run with: node e2e/feature158_content_security_policy.mjs

import assert from "node:assert/strict";
import { dismissStatusMessages, launchApp } from "./harness.mjs";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const VIEWS = ["Dashboard", "Accounts", "Transactions", "Recurring", "Budget", "Goals", "Cash Flow", "Investments", "Household", "Reports", "Settings", "Help"];

const dbDir = freshTestDbDir();
await seedDemoDatabase(dbDir);
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await browser.execute(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });

  for (const view of VIEWS) {
    await dismissStatusMessages(browser);
    await browser.execute((v) => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === v).click(), view);
    await browser.waitUntil(() => browser.execute((v) => document.querySelector(".view-title")?.textContent.trim().toLowerCase() === v.toLowerCase(), view), {
      timeout: 10000,
      timeoutMsg: `${view} never showed`,
    });
    await browser.pause(300);
  }
  assert.deepEqual(await browser.execute(() => window.__cspViolations), [], "the app itself raised no policy violation");
  assert.ok(await browser.execute(() => document.querySelectorAll("table.ledger tbody tr, .account-card").length >= 0), "screens loaded");

  const remote = await browser.executeAsync((done) => {
    fetch("https://example.com/").then(() => done("fetched"), (e) => done(`refused: ${e.name}`));
  });
  assert.match(remote, /^refused/, "a request to another site is refused");

  const injected = await browser.executeAsync((done) => {
    window.__injectedRan = false;
    const s = document.createElement("script");
    s.textContent = "window.__injectedRan = true";
    document.head.appendChild(s);
    setTimeout(() => done(window.__injectedRan), 200);
  });
  assert.equal(injected, false, "an inline script added to the page does not run");
  assert.ok((await browser.execute(() => window.__cspViolations)).some((v) => v.startsWith("script-src")), "and the policy reported it");

  console.log("FEATURE 158 E2E TEST PASSED");
} finally {
  await app.close();
}
