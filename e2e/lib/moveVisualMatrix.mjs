// The compiled-app visual, keyboard and accessibility matrix for the "Move to account" review (feature377_*, one
// spec per style so each fits the 60-second spec ceiling).
//
// For one style, light and dark, at 1280x800 and the 720x520 minimum window, with a very long account name, a very
// long description and a ticked row, the review is opened twice: once ready to confirm (warnings, balances, rows)
// and once blocked. Each is checked for
//   - being the app's modal dialog, named by its title, inside the window with a margin,
//   - the page not scrolling sideways and the dialog's own body not scrolling sideways,
//   - its action buttons (Cancel and Move, or Cancel alone) being fully visible, at least 24 px high, and in the
//     same place whether the body is long or short (they sit outside the scrolling body),
//   - Axe WCAG 2.x A/AA with every rule on (contrast included; "incomplete" results are counted and kept),
//   - the keyboard: Tab and Shift+Tab stay inside the dialog all the way round, Move is not the first thing
//     focused, and Escape cancels without moving anything,
//   - measured text contrast (lib/calendarContrast.mjs's procedure, aimed at this dialog): Axe reports contrast as
//     "incomplete" on some styles' backgrounds, so each text category the dialog uses is measured against the real
//     composited background, with the body at its top and again at its bottom.
// Screenshots go to VS_SCREENS_DIR and the run's findings are printed as one JSON line for the report.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitForDataLoaded, waitUntilOrDiagnose } from "../harness.mjs";
import { ensureAxe } from "./axeSession.mjs";
import { measureState } from "./calendarContrast.mjs";
import { FIRST, LAST_MONTH_END, OLD_DAY, PERIOD, TODAY, chooseMoveDestination, openTransactions, seedMoveFixture, sel, sqlRows, tickRow, waitForReview } from "./moveTransactions.mjs";
import { makeTempDir } from "./tempDir.mjs";

const LONG_ACCOUNT = "Joint household checking account with an extremely long descriptive name that keeps going and going";
const LONG_MERCHANT = "A merchant description that is intentionally very long to test wrapping inside the review table cell without breaking the layout 0123456789";
const SIZES = [
  { width: 1280, height: 800 },
  { width: 720, height: 520 },
];

export async function runMoveMatrix(style) {
  const dbDir = await seedMoveFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?, 'checking', '10.00')", ("${LONG_ACCOUNT}",))
acct["Long"] = cur.lastrowid
cur.execute("INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?, '${PERIOD}', '${LAST_MONTH_END}', '10.00')", (acct["Long"],))
add("Checking", "${TODAY}", "Corner Cafe", "-4.25", "Dining Out", cleared=1)
add("Checking", "${FIRST}", "Fuel Stop", "-30.00", "Transportation")
add("Checking", "${TODAY}", "${LONG_MERCHANT}", "-12.34")
add("Visa", "${TODAY}", "Hardware Store", "-125.50", "Home")
add("Checking", "${OLD_DAY}", "Old Statement Row", "-9.99")
loan = add("Mortgage", "${FIRST}", "Mortgage Payment", "1500.00", "Loans")
cur.execute("UPDATE transactions SET principal_amount = '900.00' WHERE id = ?", (loan,))
`);
  const shotsDir = process.env.VS_SCREENS_DIR ?? makeTempDir(`vaultspend-move-${style}-`);
  fs.mkdirSync(shotsDir, { recursive: true });
  const app = await launchApp({ dbDir });
  const b = app.browser;
  const findings = [];
  const contrastRows = [];
  const before = () => sqlRows(dbDir, "SELECT id, account_id, fingerprint, cleared FROM transactions ORDER BY id");

  async function inspect(where) {
    const state = await b.execute(() => {
      const panel = document.querySelector("[data-move-dialog]");
      const body = panel.querySelector(".move-dialog-body");
      const rect = panel.getBoundingClientRect();
      const actions = [...panel.querySelectorAll(".modal-actions button")].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, disabled: el.disabled };
      });
      return {
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
        role: panel.getAttribute("role"),
        modal: panel.getAttribute("aria-modal"),
        labelled: Boolean(panel.getAttribute("aria-labelledby") && document.getElementById(panel.getAttribute("aria-labelledby"))?.textContent),
        title: document.getElementById(panel.getAttribute("aria-labelledby"))?.textContent ?? "",
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        bodyOverflow: body.scrollWidth - body.clientWidth,
        actions,
        footerOutsideBody: actions.length > 0 && ![...panel.querySelectorAll(".modal-actions")].some((a) => body.contains(a)),
      };
    });
    assert.equal(state.role, "dialog", `${where}: it is a dialog`);
    assert.equal(state.modal, "true", `${where}: it is modal`);
    assert.equal(state.labelled, true, `${where}: it is named by its title`);
    const { rect, viewport } = state;
    assert.ok(rect.left >= 0 && rect.right <= viewport.width && rect.top >= 0 && rect.bottom <= viewport.height + 0.5, `${where}: inside the window ${JSON.stringify({ rect, viewport })}`);
    assert.ok(state.pageOverflow <= 1, `${where}: the page does not scroll sideways (${state.pageOverflow}px)`);
    assert.ok(state.bodyOverflow <= 1, `${where}: the dialog body does not scroll sideways (${state.bodyOverflow}px)`);
    assert.equal(state.footerOutsideBody, true, `${where}: the action buttons sit outside the scrolling body`);
    for (const a of state.actions) {
      assert.ok(a.height >= 24, `${where}: ${a.text} is at least 24px high (${a.height})`);
      assert.ok(a.top >= rect.top && a.bottom <= rect.bottom + 0.5 && a.bottom <= viewport.height + 0.5, `${where}: ${a.text} is fully visible`);
    }
    await b.saveScreenshot(path.join(shotsDir, `${where.replace(/[^\w.-]+/g, "-")}.png`));
    await ensureAxe(b);
    const axe = await b.executeAsync((done) => {
      window.axe
        .run(document.querySelector("[data-move-dialog]"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })
        .then((r) => done({ violations: r.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} ${n.any[0]?.data?.contrastRatio ?? ""}`)), incomplete: r.incomplete.map((v) => v.id), passes: r.passes.length }));
    });
    assert.deepEqual(axe.violations.filter((v) => !(process.env.VS_MOVE_IGNORE_AXE ?? "").split(",").includes(v.split(":")[0])), [], `${where}: Axe violations`);
    findings.push({ where, actions: state.actions.map((a) => `${a.text}@${Math.round(a.top)}-${Math.round(a.bottom)}`), axeIncomplete: axe.incomplete, axePasses: axe.passes, title: state.title.slice(0, 60) });
    return state;
  }

  const CONTRAST_CATEGORIES = [
    ["title", "[data-move-dialog] h2.modal-title"],
    ["summary", ".move-summary"],
    ["already there", "[data-move-already-there]"],
    ["section heading", ".move-dialog-body h3"],
    ["blockers heading", ".move-blockers h3"],
    ["blocker summary", ".move-blocker-summary"],
    ["blocker detail", ".move-blocker li"],
    ["account name", ".move-balances strong"],
    ["role text (muted)", ".move-role"],
    ["balance line", ".move-effect-line"],
    ["available credit (muted)", ".move-effect-secondary"],
    ["warning", ".move-warnings li"],
    ["note (muted)", ".move-keeps"],
    ["table heading", ".move-table th"],
    ["table cell", ".move-table td"],
    ["table amount", ".move-table td.move-amount"],
    ["blocked row status", ".move-table tr[data-status='blocked'] td:last-child"],
    ["secondary button", ".modal-actions .modal-secondary:not(:disabled)"],
    ["primary button", "[data-move-confirm]:not(:disabled)"],
    ["disabled primary button", "[data-move-confirm]:disabled"],
    ["confirmation explanation", ".move-confirm > p"],
    ["confirmation account", ".move-confirm-account legend"],
    ["confirmation reason (muted)", ".move-confirm-reasons li"],
    ["confirmation reference", ".move-confirm-current"],
    ["confirmation label", ".move-confirm-row label"],
    ["confirmation choice", "[data-move-keep]"],
    ["confirmation error", ".move-confirm-error"],
    ["review button", "[data-move-review-balances]:not(:disabled)"],
  ];

  /** Measures every text category in the dialog's current state; categories out of view at the top are measured with the body scrolled to its end. */
  async function contrast(where) {
    const root = "[data-move-dialog]";
    const scroll = (to) => b.execute((to) => { const body = document.querySelector("[data-move-dialog] .modal-body"); if (body) body.scrollTop = to === "end" ? body.scrollHeight : 0; }, to);
    await scroll("top");
    const top = await measureState(b, CONTRAST_CATEGORIES, root);
    const seen = new Set(top.measured.map((m) => m.name));
    let measured = top.measured;
    const missing = CONTRAST_CATEGORIES.filter(([name]) => !seen.has(name));
    if (missing.length) {
      await scroll("end");
      const end = await measureState(b, missing, root);
      measured = measured.concat(end.measured);
      await scroll("top");
    }
    for (const m of measured) contrastRows.push({ where, ...m });
    const failing = measured.filter((m) => m.passes === false);
    assert.deepEqual(failing.map((m) => `${m.name} ${m.ratio.toFixed(2)}:1 < ${m.threshold}:1 (${m.text})`), [], `${where}: text must reach its contrast threshold`);
    const thresholded = measured.filter((m) => m.threshold !== null);
    assert.ok(thresholded.length >= 8, `${where}: a meaningful number of text categories were measured (${thresholded.length})`);
    findings.push({ where: `${where} contrast`, measured: thresholded.length, lowest: Math.min(...thresholded.map((m) => m.ratio)).toFixed(2) });
  }

  async function keyboard(where) {
    // Nothing destructive is focused first, and Tab/Shift+Tab never leave the dialog.
    const first = await b.execute(() => document.activeElement?.getAttribute("data-move-confirm") !== null && document.activeElement?.tagName === "BUTTON");
    assert.equal(first, false, `${where}: Move is not focused when the review opens`);
    const stays = async (key, count) => {
      for (let i = 0; i < count; i++) {
        await b.keys(key);
        const inside = await b.execute(() => Boolean(document.activeElement?.closest("[data-move-dialog]")));
        assert.equal(inside, true, `${where}: ${key} stays inside the dialog (press ${i + 1})`);
      }
    };
    await stays("Tab", 14);
    await b.keys(["Shift", "Tab"]);
    await b.keys("Shift");
    assert.equal(await b.execute(() => Boolean(document.activeElement?.closest("[data-move-dialog]"))), true, `${where}: Shift+Tab stays inside`);
  }

  async function setLook(theme) {
    await b.execute(
      (s, t) => {
        localStorage.setItem("meadow-theme-style", s);
        localStorage.setItem("meadow-theme", t);
        localStorage.setItem("meadow-reduce-motion", "on");
        location.reload();
      },
      style,
      theme,
    );
    await waitUntilOrDiagnose(b, () => b.execute((s, t) => document.documentElement.dataset.palette === s && document.documentElement.dataset.theme === t && Boolean(document.querySelector(".nav-item")), style, theme), {
      timeout: 20000,
      timeoutMsg: `expected the ${style} style in ${theme} mode`,
    });
    await waitForDataLoaded(b);
  }

  try {
    for (const theme of ["light", "dark"]) {
      await setLook(theme);
      for (const size of SIZES) {
        const where = `${style}-${theme}-${size.width}x${size.height}`;
        await b.setWindowSize(size.width, size.height);
        await openTransactions(b);
        const rowsBefore = before();

        // Ready to confirm.
        for (const d of ["Corner Cafe", "Fuel Stop", "A merchant description", "Hardware Store"]) await tickRow(b, d);
        await chooseMoveDestination(b, "Joint household");
        await waitForReview(b);
        await waitUntilOrDiagnose(b, async () => (await b.$(sel.confirm).isExisting()), { timeoutMsg: `${where}: the review should be ready to confirm` });
        assert.equal(await b.$(sel.blockersTitle).isExisting(), false, `${where}: nothing blocks the ready review`);
        assert.equal(await (await b.$(sel.confirm)).getAttribute("disabled"), null, `${where}: Move is enabled in the ready review`);
        await inspect(`${where}-ready`);
        await contrast(`${where}-ready`);
        await keyboard(`${where}-ready`);
        await b.keys("Escape");
        await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 5000 });
        assert.deepEqual(before(), rowsBefore, `${where}: Escape cancelled without moving anything`);

        // Balances to confirm: a row older than a saved balance whose contents the app cannot read.
        await tickRow(b, "Old Statement Row");
        await chooseMoveDestination(b, "Joint household");
        await waitUntilOrDiagnose(b, async () => b.execute(() => Boolean(document.querySelector("[data-move-confirm-balances]"))), { timeoutMsg: `${where}: the balance confirmation should appear` });
        assert.equal(await b.$(sel.confirm).isExisting(), false, `${where}: no Move button while balances are unconfirmed`);
        await inspect(`${where}-confirm-balances`);
        await contrast(`${where}-confirm-balances`);
        await keyboard(`${where}-confirm-balances`);
        const boxes = await b.$$("[data-move-confirm-balances] input");
        for (const box of boxes) await box.setValue("1");
        await boxes[0].setValue("invalid");
        await (await b.$("[data-move-review-balances]")).click();
        await waitUntilOrDiagnose(b, async () => b.execute(() => [...document.querySelectorAll(".move-confirm-error")].some((el) => el.textContent.trim())), { timeoutMsg: `${where}: invalid balance should have a visible error` });
        await inspect(`${where}-invalid-balance`);
        await contrast(`${where}-invalid-balance`);
        await boxes[0].setValue("1");
        await (await b.$("[data-move-review-balances]")).click();
        await waitUntilOrDiagnose(b, async () => b.$(sel.confirm).isExisting(), { timeoutMsg: `${where}: the final review should offer Move` });
        await inspect(`${where}-confirmed`);
        await contrast(`${where}-confirmed`);
        await keyboard(`${where}-confirmed`);
        await b.keys("Escape");
        await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 5000 });
        assert.deepEqual(before(), rowsBefore, `${where}: nothing moved`);
        await (await b.$("button=Clear selection")).click();

        // Blocked: a loan payment's principal amount does not fit a checking account.
        await tickRow(b, "Mortgage Payment");
        await chooseMoveDestination(b, "Joint household");
        await waitForReview(b);
        await waitUntilOrDiagnose(b, async () => (await b.$(sel.blockersTitle).isExisting()), { timeoutMsg: `${where}: the blocked review should appear` });
        await inspect(`${where}-blocked`);
        await contrast(`${where}-blocked`);
        await keyboard(`${where}-blocked`);
        await b.keys("Escape");
        await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 5000 });
        assert.deepEqual(before(), rowsBefore, `${where}: nothing moved`);
        await (await b.$("button=Clear selection")).click();
      }
    }
    fs.writeFileSync(path.join(shotsDir, `move-contrast-${style}.json`), JSON.stringify({ style, procedure: "lib/calendarContrast.mjs measureState on [data-move-dialog]: ink hidden, composited background decoded from a screenshot, worst of five sample points per element", rows: contrastRows }, null, 2));
    console.log(`PASS move matrix ${style} (screenshots in ${shotsDir})`);
    console.log(`MOVE_FINDINGS ${JSON.stringify(findings)}`);
  } finally {
    await app.close();
  }
}
