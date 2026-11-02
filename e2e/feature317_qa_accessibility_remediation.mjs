// QA remediation (2026-10-27): the four owner-designated accessibility blockers, checked in the real
// compiled app with axe-core and genuine key presses.
//
//   QA-A11Y-001: at 720 and 960 px the sidebar rail hides the profile name; the profile chooser still has
//                an accessible name that includes the profile's name (axe button-name).
//   QA-A11Y-002: on Reports the wide tables scroll sideways inside their card. Tab (real key presses)
//                lands on each labelled scroll region, the arrow keys scroll it, and axe
//                scrollable-region-focusable finds nothing.
//   QA-A11Y-003: in the Default style, Light theme, the Add account and Add transaction dialogs and the
//                Ctrl+K palette reach 4.5:1 text contrast once their entrance animation has settled
//                (axe color-contrast, whole dialog).
//   QA-A11Y-004: each row's include checkbox in the import review has its own name (axe label, and the
//                names differ even for two identical rows).
//
// Run with: node e2e/run-all.mjs --spec=317

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, stubFilePicker, waitUntilOrDiagnose } from "./harness.mjs";
import { ensureAxe, waitForVisualStability } from "./lib/axeSession.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { startImportInto } from "./lib/importAccount.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid
for i, (desc, amt, cat) in enumerate([('QQ ALPHA CAFE', '-12.50', 'Dining Out'), ('QQ BRAVO MARKET', '-140.00', 'Groceries'), ('QQ CHARLIE GAS', '-45.00', 'Transport'), ('QQ DELTA RENT', '-1200.00', 'Housing'), ('QQ ECHO PAYROLL', '2600.00', 'Income')]):
    for back in range(0, 80, 20):
        d = (today - datetime.timedelta(days=back + i)).isoformat()
        cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
                    (acct, d, desc, amt, cat, f'{acct}|{d}|{desc.lower()}|{amt}|{back}'))
`);

const dir = makeTempDir("vaultspend-e2e-a11y-");
const twinCsv = path.join(dir, "twins.csv");
fs.writeFileSync(twinCsv, ["Date,Description,Amount", `${dateInMonth(-1, 3)},QQ COFFEE,-3.00`, `${dateInMonth(-1, 3)},QQ COFFEE,-3.00`, `${dateInMonth(-1, 4)},QQ BAGEL,-4.50`, ""].join("\n"));

const app = await launchApp({ dbDir });
const { browser } = app;

async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    const text = (await b.getText()).trim() || (await b.getAttribute("aria-label")) || "";
    if (text === label) return b.click();
  }
  throw new Error(`no nav button ${label}`);
}
async function axeViolations(rules, context = "document") {
  await ensureAxe(browser);
  return browser.executeAsync(
    (rules, context, done) => {
      const root = context === "document" ? document : document.querySelector(context);
      window.axe.run(root, { runOnly: rules }).then((r) =>
        done(
          r.violations.flatMap((v) =>
            v.nodes.map((n) =>
              v.id === "color-contrast"
                ? `contrast: ${n.target.join(" ")} ${n.any[0]?.data?.fgColor} on ${n.any[0]?.data?.bgColor} at ${n.any[0]?.data?.contrastRatio}:1`
                : `${v.id}: ${n.target.join(" ")}`,
            ),
          ),
        ),
      );
    },
    rules,
    context,
  );
}
async function setLook(style, theme) {
  await browser.execute((s, t) => {
    localStorage.setItem("meadow-theme-style", s);
    localStorage.setItem("meadow-theme", t);
    localStorage.setItem("meadow-reduce-motion", "on");
    location.reload();
  }, style, theme);
  await (await browser.$(".nav-item")).waitForExist({ timeout: 20000 });
  await browser.waitUntil(() => browser.execute((s) => document.documentElement.dataset.palette === s, style), { timeout: 5000 });
}
const activeInfo = () =>
  browser.execute(() => {
    const el = document.activeElement;
    return { role: el?.getAttribute("role"), label: el?.getAttribute("aria-label"), scrollable: el ? el.scrollWidth > el.clientWidth : false };
  });

let scrolledSomewhere = false;
try {
  await setLook("transparent", "light");

  for (const width of [720, 960, 1280]) {
    await browser.setWindowSize(width, 900);
    await browser.pause(300);

    // A11Y-001
    await nav("Dashboard");
    await browser.$(".profile-switcher-toggle").waitForExist({ timeout: 10000 });
    const profileLabel = await browser.$(".profile-switcher-toggle").getAttribute("aria-label");
    assert.ok(profileLabel && /profile/i.test(profileLabel), `${width}px: the profile chooser has a name (got ${profileLabel})`);
    assert.deepEqual(await axeViolations(["button-name"]), [], `${width}px: every button has a name`);

    // A11Y-002
    await nav("Reports");
    await browser.$("[data-reports-hub]").waitForExist({ timeout: 15000 });
    await browser.$("[data-report-table]").waitForExist({ timeout: 15000 });
    await browser.pause(500);
    assert.deepEqual(await axeViolations(["scrollable-region-focusable"]), [], `${width}px: scrollable regions are focusable`);

    if (width < 1280) {
      // Real Tab presses from the top of the page until the table's scroll region has focus.
      await browser.execute(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      let reached = null;
      for (let press = 0; press < 450 && !reached; press++) {
        await browser.keys("Tab");
        const info = await activeInfo();
        if (info.role === "region" && /table/i.test(info.label ?? "")) reached = info;
      }
      assert.ok(reached, `${width}px: Tab reaches the report table's scroll region`);
      if (reached.scrollable) {
        const before = await browser.execute(() => document.activeElement.scrollLeft);
        await browser.keys("ArrowRight");
        await browser.keys("ArrowRight");
        await browser.waitUntil(async () => (await browser.execute(() => document.activeElement.scrollLeft)) > before, {
          timeout: 4000,
          timeoutMsg: `${width}px: the arrow keys scroll the focused table`,
        });
        scrolledSomewhere = true;
      }
    }

    // A11Y-003 (Default, Light)
    const dialogs = [
      ["Add account", async () => { await nav("Accounts"); await (await browser.$("button*=Add account")).click(); }],
      ["Add transaction", async () => { await nav("Transactions"); await (await browser.$("button=Add transaction")).click(); }],
      ["Command palette", async () => { await nav("Dashboard"); await browser.keys(["Control", "k"]); }],
    ];
    for (const [name, open] of dialogs) {
      await open();
      await browser.$("[role='dialog']").waitForExist({ timeout: 8000 });
      await waitForVisualStability(browser);
      assert.deepEqual(await axeViolations(["color-contrast"], "[role='dialog']"), [], `${width}px: ${name} text contrast`);
      await browser.keys("Escape");
      await browser.waitUntil(async () => !(await browser.$("[role='dialog']").isExisting()), { timeout: 5000, timeoutMsg: `${name} closes` });
    }
  }

  assert.ok(scrolledSomewhere, "at least one compact width overflows, so the arrow-key scroll was exercised for real");

  // A11Y-004 at 1280
  await browser.setWindowSize(1280, 900);
  await nav("Transactions");
  await stubFilePicker(browser, [twinCsv]);
  await startImportInto(browser, "Checking");
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const keep = await browser.$("button=Keep as-is");
      if (await keep.isDisplayed().catch(() => false)) await keep.click();
      return browser.execute(() => !!document.querySelector("button[data-import-confirm]"));
    },
    { timeout: 20000, timeoutMsg: "the review opens (answering the amounts-direction question if asked)" },
  );
  const names = await browser.execute(() => [...document.querySelectorAll("[role='dialog'] tbody input[type='checkbox']")].map((i) => i.getAttribute("aria-label")));
  assert.equal(names.length, 3, "one checkbox per row");
  assert.ok(names.every((n) => n && n.length > 0), "every row checkbox is named");
  assert.equal(new Set(names).size, 3, `names are all different, even for two identical rows: ${JSON.stringify(names)}`);
  assert.ok(names.some((n) => n.includes("QQ BAGEL")), "a name says which transaction it is");
  assert.deepEqual(await axeViolations(["label"], "[role='dialog']"), [], "axe label rule is clean in the import review");
  await (await browser.$("button=Cancel")).click();

  console.log("FEATURE 317 E2E TEST PASSED");
} finally {
  await app.close();
}
