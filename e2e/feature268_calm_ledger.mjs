// E2E test: a calmer Transactions table (UI review s1), on the tidy two-person household data.
//
// - With one family member (no Member column), each row's ⋯ menu offers "Belongs to Jordan", its label
//   lined up with the other items' labels (UAT s1.1).
// - At 1440x1000 at least 12 rows fit in one window height of the table (the review measured 7).
// - Every amount's right edge lines up within 1px.
// - The ⋯ menu on the last visible row opens upward and stays inside the window, in Default,
//   Futuristic and Retro, Light and Dark (screenshots are saved for a look by eye).
// - If a row is filtered out while its menu is open, the menu closes with it and runs nothing.
// - "Add tag…" opens a tag field; typing "trip" and Enter adds a "trip" tag.
// - One transaction left without a category brings up the "needs a category" line, and Review
//   shows just the ones that need one.
//
// Run with: node e2e/feature268_calm_ledger.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chooseRowAction, chooseStyle, launchApp, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";
import { seedHouseholdDatabase } from "./household-demo.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const dbDir = freshTestDbDir();
await seedHouseholdDatabase(dbDir);
const shotsDir = process.env.VS_SCREENS_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-feature268-"));
fs.mkdirSync(shotsDir, { recursive: true });

let app = await launchApp({ dbDir, windowSize: { width: 1440, height: 1000 } });
let browser = app.browser;

/** Clears the category of the most recent grocery run on Joint Checking; returns its id. */
function uncategorizeOneGroceryRun(dir) {
  const out = execFileSync("python", [
    "-c",
    `
import sqlite3, json
con = sqlite3.connect(r"${path.join(dir, "vaultspend.db")}")
cur = con.cursor()
cur.execute("""SELECT t.id, t.description FROM transactions t JOIN accounts a ON a.id = t.account_id
               WHERE a.name = 'Joint Checking' AND t.category = 'Groceries' ORDER BY t.date DESC, t.id DESC LIMIT 1""")
row = cur.fetchone()
cur.execute("UPDATE transactions SET category = NULL, category_source = NULL, confidence = NULL WHERE id = ?", (row[0],))
con.commit()
print(json.dumps({"id": row[0], "description": row[1]}))
`,
  ]);
  return JSON.parse(out.toString());
}

async function openTransactions() {
  await (await browser.$(".nav-item[data-tab=ledger]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.querySelectorAll("table.ledger tbody tr[data-payment-row]").length > 20), {
    timeout: 20000,
    timeoutMsg: "expected the Transactions table to fill with the household's rows",
  });
}

/** Scrolls so the table runs past the bottom of the window, and returns the last row that is fully
 * inside it (its ⋯ trigger has no room for a menu below). */
async function lastVisibleRowId() {
  return browser.execute(() => {
    const rows = [...document.querySelectorAll("table.ledger tbody tr[data-payment-row]")];
    rows[Math.min(14, rows.length - 1)].scrollIntoView({ block: "end" });
    const inside = rows.filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= window.innerHeight && r.querySelector("[data-row-menu]");
    });
    return inside.at(-1)?.dataset.paymentRow ?? null;
  });
}

const rowMenuSelector = (id) => `tr[data-payment-row="${id}"] [data-row-menu]`;

/** Opens a row's menu (retrying if another window takes focus and closes it) and measures it. */
async function openMenuAndMeasure(id) {
  let geometry = null;
  await withFocusRetry(browser, async () => {
    if (!(await browser.$(".row-menu-panel").isExisting())) await (await browser.$(rowMenuSelector(id))).click();
    await (await browser.$(".row-menu-panel")).waitForDisplayed({ timeout: 3000 });
    geometry = await browser.execute((sel) => {
      const t = document.querySelector(sel).getBoundingClientRect();
      const panel = document.querySelector(".row-menu-panel");
      const p = panel.getBoundingClientRect();
      return {
        trigger: { top: t.top, bottom: t.bottom },
        panel: { top: p.top, bottom: p.bottom, left: p.left, right: p.right, height: p.height },
        window: { width: window.innerWidth, height: window.innerHeight },
        background: getComputedStyle(panel).backgroundColor,
        backdrop: getComputedStyle(panel).backdropFilter || getComputedStyle(panel).webkitBackdropFilter || "",
        items: [...panel.querySelectorAll("[role^='menuitem']")].map((b) => b.textContent.trim()),
      };
    }, rowMenuSelector(id));
  });
  return geometry;
}

async function closeMenu() {
  await browser.keys("Escape");
  await waitUntilOrDiagnose(browser, async () => !(await browser.$(".row-menu-panel").isExisting()), { timeoutMsg: "Escape should close the row menu" });
}

function assertOpensUpwardInside(g, where) {
  const { panel, trigger, window: w } = g;
  assert.ok(panel.top >= 0 && panel.bottom <= w.height + 0.5, `${where}: the menu must stay inside the window vertically, got ${JSON.stringify(g)}`);
  assert.ok(panel.left >= 0 && panel.right <= w.width + 0.5, `${where}: the menu must stay inside the window sideways, got ${JSON.stringify(g)}`);
  assert.ok(panel.bottom <= trigger.top + 1, `${where}: the menu on the last visible row must open above its ⋯, got ${JSON.stringify(g)}`);
  // Only meaningful if it really couldn't fit below.
  assert.ok(trigger.bottom + panel.height > w.height, `${where}: the chosen row should be low enough that the menu can't open downward, got ${JSON.stringify(g)}`);
  const alpha = Number(g.background.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/)?.[1] ?? 1);
  // Solid, or (Default) frosted glass: never below 75% and always blurred, like every other menu.
  assert.ok(alpha === 1 || (alpha >= 0.75 && g.backdrop.includes("blur")), `${where}: the menu must be readable over the rows, got ${g.background} ${g.backdrop}`);
}

try {
  await openTransactions();

  // ---- 1. Density: at least 12 rows in one window height of the table -----------------------
  const density = await browser.execute(() => {
    const scroller = document.querySelector(".ledger-table-scroll");
    scroller.scrollIntoView({ block: "start" });
    const top = scroller.getBoundingClientRect().top;
    const rows = [...scroller.querySelectorAll("tbody tr[data-payment-row]")].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= top - 0.5 && b.bottom <= top + window.innerHeight + 0.5;
    });
    return { rows: rows.length, rowHeights: rows.slice(0, 5).map((r) => Math.round(r.getBoundingClientRect().height)) };
  });
  assert.ok(density.rows >= 12, `expected at least 12 rows in one window height of the table, got ${JSON.stringify(density)}`);
  console.log("density:", JSON.stringify(density));

  // ---- 2. Amounts line up on the right ----------------------------------------------------------
  const rights = await browser.execute(() =>
    [...document.querySelectorAll("table.ledger tbody tr[data-payment-row] td.amount-col")].map((td) => {
      const text = td.querySelector(".amount-editable, .transfer-amount") ?? td;
      return Math.round(text.getBoundingClientRect().right * 10) / 10;
    }),
  );
  assert.ok(rights.length > 20, `expected amount cells, got ${rights.length}`);
  const spread = Math.max(...rights) - Math.min(...rights);
  assert.ok(spread <= 1, `expected every amount's right edge to line up within 1px, spread ${spread}px: ${JSON.stringify(rights.slice(0, 10))}`);
  // The household has two people but only one family member, so the Member column stays hidden.
  assert.equal(await browser.$("table.ledger .member-col").isExisting(), false, "one family member: no Member column");
  console.log(`amounts: ${rights.length} right edges within ${spread.toFixed(1)}px`);

  // ---- 3. The last visible row's menu opens upward, inside the window, in every style -----------
  for (const [label, palette] of [
    ["Default", "transparent"],
    ["Futuristic", "futuristic"],
    ["Retro", "retro"],
  ]) {
    await chooseStyle(browser, label, palette);
    for (const mode of ["light", "dark"]) {
      await browser.execute((m) => {
        const group = document.querySelector('.theme-toggle[aria-label="Theme"]');
        [...group.querySelectorAll("button")].find((b) => b.textContent.trim().toLowerCase() === m).click();
      }, mode);
      await waitUntilOrDiagnose(browser, () => browser.execute((m) => document.documentElement.dataset.theme === m, mode), {
        timeoutMsg: `the ${mode} theme should apply`,
      });
      await openTransactions();
      const id = await lastVisibleRowId();
      assert.ok(id, `${label} ${mode}: expected a visible row with a ⋯ menu`);
      const g = await openMenuAndMeasure(id);
      assertOpensUpwardInside(g, `${label} ${mode}`);
      // One family member, so no Member column: the menu says whether the row belongs to Jordan.
      assert.ok(g.items.includes("Belongs to Jordan"), `${label} ${mode}: expected a "Belongs to Jordan" item, got ${JSON.stringify(g.items)}`);
      // UAT s1.1: "Belongs to Jordan" starts where the other items' labels start; its tick (when set)
      // comes after the label, at the right.
      const starts = await browser.execute(() =>
        [...document.querySelectorAll(".row-menu-panel [role^='menuitem']")].map((item) => {
          const range = document.createRange();
          range.selectNodeContents(item);
          const text = [...item.childNodes].find((n) => n.textContent.trim() !== "");
          range.selectNodeContents(text);
          return { label: item.textContent.trim(), left: Math.round(range.getBoundingClientRect().left * 10) / 10 };
        }),
      );
      const lefts = new Set(starts.map((x) => x.left));
      assert.equal(lefts.size, 1, `${label} ${mode}: every menu label should start at the same place: ${JSON.stringify(starts)}`);
      // Plain cells: no box around the account/category triggers in any style.
      const plain = await browser.execute((rowId) => {
        const t = document.querySelector(`tr[data-payment-row="${rowId}"] [aria-label^="Category for"]`);
        const s = t && getComputedStyle(t);
        return t ? { bg: s.backgroundColor, shadow: s.boxShadow, border: s.borderTopColor } : null;
      }, id);
      if (plain) {
        assert.equal(plain.bg, "rgba(0, 0, 0, 0)", `${label} ${mode}: the category cell should have no background, got ${JSON.stringify(plain)}`);
        assert.equal(plain.shadow, "none", `${label} ${mode}: the category cell should have no sunken edge, got ${JSON.stringify(plain)}`);
      }
      await browser.saveScreenshot(path.join(shotsDir, `ledger-menu-${palette}-${mode}.png`));
      await closeMenu();
      console.log(`${label} ${mode}: menu opens upward inside the window (${JSON.stringify(g.panel)})`);
    }
  }
  console.log(`screenshots: ${shotsDir}`);

  // ---- 4. A row filtered out while its menu is open takes the menu with it ----------------------
  const id = await lastVisibleRowId();
  const description = await browser.execute(
    (rowId) => document.querySelector(`tr[data-payment-row="${rowId}"] [title="Click to fix the description"]`).textContent.trim(),
    id,
  );
  const rowsBefore = await browser.execute(() => document.querySelectorAll("table.ledger tbody tr[data-payment-row]").length);
  await openMenuAndMeasure(id);
  // Type a search that no row matches, without clicking (a click outside would close the menu
  // on its own and prove nothing).
  const setSearch = (value) =>
    browser.execute((v) => {
      const input = document.querySelector('input[aria-label="Search description"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await setSearch("zz-no-such-transaction-268");
  await waitUntilOrDiagnose(
    browser,
    () => browser.execute((rowId) => !document.querySelector(`tr[data-payment-row="${rowId}"]`) && !document.querySelector(".row-menu-panel"), id),
    { timeoutMsg: "filtering the row out should close its open menu with it" },
  );
  await setSearch("");
  await waitUntilOrDiagnose(browser, () => browser.execute((n) => document.querySelectorAll("table.ledger tbody tr[data-payment-row]").length >= n, rowsBefore), {
    timeoutMsg: "clearing the search should bring every row back",
  });
  assert.equal(await browser.$(".row-menu-panel").isExisting(), false, "the menu must not come back by itself");
  assert.equal(await browser.$(".row-delete-confirm").isExisting(), false, "nothing may have run against the row");
  assert.ok(await browser.$(`tr[data-payment-row="${id}"]`).isExisting(), `the row "${description}" must still be there`);
  console.log(`stale row: "${description}" filtered out with its menu open; the menu closed and nothing ran`);

  // ---- 5. Add tag… ----------------------------------------------------------------------------
  const firstId = await browser.execute(() => {
    window.scrollTo(0, 0);
    document.querySelector(".ledger-table-scroll").scrollIntoView({ block: "start" });
    // Not a linked transfer's row: its menu has no "Add tag…", and on some days the household data puts
    // a transfer first (the household's transfers fall on fixed days of the month).
    return document.querySelector("table.ledger tbody tr[data-payment-row]:not(.ledger-row-transfer) [data-row-menu]").closest("tr").dataset.paymentRow;
  });
  const tripPill = `//tr[@data-payment-row='${firstId}']//span[contains(@class,'tag-pill')][starts-with(normalize-space(.),'trip')]`;
  await withFocusRetry(browser, async () => {
    if (await browser.$(tripPill).isExisting()) return; // an earlier attempt already added it
    await chooseRowAction(browser, rowMenuSelector(firstId), "Add tag…");
    const input = await browser.$(`tr[data-payment-row="${firstId}"] .tag-input`);
    await input.waitForExist({ timeout: 5000 });
    await input.setValue("trip");
    await browser.keys("Enter");
    await (await browser.$(tripPill)).waitForExist({ timeout: 10000 });
  });
  assert.equal(await browser.$(`tr[data-payment-row="${firstId}"] .tag-input`).isExisting(), false, "the tag field should close after Enter");
  console.log("Add tag…: typing trip and Enter added a trip tag");

  // ---- 6. One transaction without a category brings up the needs-a-category line -----------
  const lineCount = async () => {
    const line = await browser.$("[data-needs-category]");
    if (!(await line.isExisting())) return 0;
    return Number((await line.getText()).match(/^(\d+)/)?.[1] ?? NaN);
  };
  // The household is tidy: nothing needs a category yet, so there is no line. The counts arrive
  // with the subtitle's "sorted automatically" part; wait for that first, or a read made before
  // they load would find no line and pass without proving anything.
  const subtitle = await browser.$("[data-ledger-subtitle]");
  await waitUntilOrDiagnose(browser, async () => (await subtitle.getText()).includes("sorted automatically"), {
    timeoutMsg: "expected the Transactions subtitle to show the sorted counts",
    extra: async () => ({ subtitle: await subtitle.getText() }),
  });
  assert.equal(await lineCount(), 0, "the tidy household should start with nothing that needs a category");
  // Take one grocery run's category away (with the app closed, as a person's import might leave it),
  // then open the app again. Adding a new transaction can't do this here: with this much history the
  // app sorts any new one automatically.
  await app.close();
  const uncategorized = uncategorizeOneGroceryRun(dbDir);
  app = await launchApp({ dbDir, windowSize: { width: 1440, height: 1000 } });
  browser = app.browser;
  await openTransactions();
  await waitUntilOrDiagnose(browser, async () => (await lineCount()) === 1, {
    timeoutMsg: "expected the needs-a-category line to count 1",
    extra: async () => ({ line: (await browser.$("[data-needs-category]").isExisting()) ? await browser.$("[data-needs-category]").getText() : null }),
  });
  const line = await browser.$("[data-needs-category]");
  assert.match(await line.getText(), /^1 transaction needs a category\.\s*Review$/);
  await (await line.$("button=Review")).click();
  await waitUntilOrDiagnose(
    browser,
    () =>
      browser.execute((rowId) => {
        const rows = [...document.querySelectorAll("table.ledger tbody tr[data-payment-row]")];
        return rows.length === 1 && rows[0].dataset.paymentRow === String(rowId) && Boolean(rows[0].querySelector(".row-field-needs"));
      }, uncategorized.id),
    { timeoutMsg: `Review should show only the one that needs a category ("${uncategorized.description}")` },
  );
  assert.match(await line.getText(), /^Showing the 1 that needs a category\.\s*Show all$/);
  const needsColor = await browser.execute(() => {
    const t = document.querySelector("table.ledger .row-field-needs");
    const root = getComputedStyle(document.documentElement).getPropertyValue("--negative").trim();
    const probe = document.createElement("span");
    probe.style.color = root;
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(t).color, expected, text: t.textContent.trim() };
  });
  assert.equal(needsColor.actual, needsColor.expected, `the "Needs a category" cell should be red (--negative), got ${JSON.stringify(needsColor)}`);
  assert.equal(needsColor.text.replace("▾", "").trim(), "Needs a category");
  await (await line.$("button=Show all")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.querySelectorAll("table.ledger tbody tr[data-payment-row]").length > 20), {
    timeoutMsg: "Show all should bring back every transaction",
  });
  console.log("needs-a-category: the line appears, Review filters to those rows, Show all clears it");

  console.log("FEATURE 268 E2E TEST PASSED");
} finally {
  await app.close();
}
