import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { launchApp } from "../harness.mjs";
import { askHelpers } from "./askRetirement.mjs";
import { seedFixture } from "./seed.mjs";
import { dateInMonth } from "./dates.mjs";

// M6 (D-S4-03, UC-03, UC-04, UC-07): narrow-layout and long-name checks for the ordinary Ask the Vault card (M1/M2), and the M3 and M4 states that no other
// compiled check reaches. One profile, two narrow widths. Per state: no horizontal page overflow, nothing outside its container, Axe (WCAG 2 A/AA, 2.1 AA) on
// the card or the open dialog. Called by existing Ask specs on the stable build; it changes no styling and records every problem instead of stopping at the first.
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
export const WIDTHS = [720, 960];
// Unbroken on purpose: the worst case for wrapping. The category has recorded purchases, so the long name appears on a real answer.
export const LONG_CATEGORY = "Extraordinarily-Long-Category-Name-With-No-Spaces-To-Wrap-0123456789";
export const LONG_STORE = "Samsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx Club";
export const LONG_STORE_ALTERNATIVE = "Samanthasxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx Bakery";
const UNKNOWN_LONG_STORE = "Unbroken-Store-Name-That-Nobody-Has-Ever-Recorded-Anywhere-In-This-Profile-0123456789";

const COVERAGE = {
  ordinary: { both: ["answer-long-category", "clarification-long-store", "unsupported-long-store", "unsupported-with-suggestions", "ordinary-error"], narrow: ["ordinary-stale-banner", "ordinary-stale"] },
  m3: { both: ["m3-review-long-category"], narrow: ["m3-reading", "m3-error", "m3-stale"] },
  m4: { both: ["m4-choices-long-category", "m4-review-long-category"], narrow: ["m4-reading", "m4-error", "m4-stale"] },
};
export const requiredLayoutCoverage = sections => sections.flatMap(section => [
  ...COVERAGE[section].both.flatMap(state => WIDTHS.map(width => `${width} ${state}`)),
  ...COVERAGE[section].narrow.map(state => `${WIDTHS[0]} ${state}`),
]);
export function assertLayoutCoverage(reached, sections) {
  const missing = requiredLayoutCoverage(sections).filter(key => !reached.has(key));
  assert.deepEqual(missing, [], `Missing layout coverage: ${missing.join(", ")}`);
}
/** Negative-tested evidence guards: a fallback, vanished loading state or wrong choices cannot earn a labelled pass. */
export function assertLayoutState(state, snapshot) {
  if (state === "clarification-long-store") {
    assert.ok(snapshot.clarification, "Expected a real store clarification");
    assert.equal(snapshot.answer, false, "No answer before the store choice");
    assert.deepEqual([...snapshot.choices].sort(), [LONG_STORE.toUpperCase(), LONG_STORE_ALTERNATIVE.toUpperCase(), "Both"].sort(), "Expected the actual recorded long-store clarification choices");
  }
  if (state === "m3-reading") assert.match(snapshot.status, /^Reading your last three months of /, "Expected the M3 reading state");
  if (state === "m4-reading") assert.match(snapshot.status, /^Reading /, "Expected the M4 reading state");
}

export function seedLayoutProfile() {
  return seedFixture(`
import datetime
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '3000.00')")
checking_id = cur.lastrowid
for name in ('Dining Out', 'Groceries', ${JSON.stringify(LONG_CATEGORY)}):
    cur.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))
today = datetime.date.today()
def month_day(offset, day):
    y, m = today.year, today.month + offset
    while m < 1:
        m += 12; y -= 1
    while m > 12:
        m -= 12; y += 1
    return "%04d-%02d-%02d" % (y, m, day)
rows = [(-3, 5, 'Sushi Place', -60.00, 'Dining Out'), (-3, 12, 'Pizza Night', -35.00, 'Dining Out'), (-3, 8, 'Long category purchase', -12.00, ${JSON.stringify(LONG_CATEGORY)}),
        (-2, 6, 'Sushi Place', -20.00, 'Dining Out'), (-1, 5, 'Sushi Place', -25.00, 'Dining Out'), (-1, 9, 'Grocery run', -30.00, 'Groceries'),
        (-1, 10, ${JSON.stringify(LONG_STORE)}, -1.00, 'Groceries'), (-1, 11, ${JSON.stringify(LONG_STORE_ALTERNATIVE)}, -2.00, 'Groceries'),
        (-2, 9, 'Long category purchase', -14.00, ${JSON.stringify(LONG_CATEGORY)}), (-1, 9, 'Long category purchase', -16.00, ${JSON.stringify(LONG_CATEGORY)})]
for i, (offset, day, desc, amount, category) in enumerate(rows):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)", (checking_id, month_day(offset, day), desc, amount, category, 'layout_%d' % i))
for offset in (-4, -2, 0):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, 'Recording boundary', '0.00', 'Groceries', ?)", (checking_id, month_day(offset, 1), 'layout_cov_%d' % offset))
`);
}

/**
 * Sections can be run by different specs so each fits the suite's 60-second ceiling: "ordinary" (M1/M2 card), "m3", "m4".
 * The stale screens are reached the way the product reaches them (M6 D-S5-02): the profile is changed by a native write the app's own code never sees (the bridge, as the M5
 * stale checks do), then the person takes the next step that re-checks the data (opening the purchases, "Show what I would save", "Show the preview"). Each of those steps reads
 * the native data revision and, on a mismatch, retires the screen. No component state is injected and no fixture allow-list is widened.
 */
export async function runAskLayoutChecks({ month, sections = ["ordinary", "m3", "m4"] }) {
  const dbDir = await seedLayoutProfile();
  const app = await launchApp({ dbDir });
  const b = app.browser, h = askHelpers(b);
  const failures = [], reached = new Set(), notes = [];
  const card = ".ledger-qa-card", dlg = '[role="dialog"]';
  const dayFrom = (offset, day) => dateInMonth(offset, day);

  async function inspect(label, root) {
    const state = label.replace(/^\d+ /, "");
    const readState = () => b.execute(selector => {
      const box = document.querySelector(selector);
      const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      return { clarification: visible(box?.querySelector(".ledger-qa-clarify")) === true, answer: visible(box?.querySelector(".ledger-qa-answer")) === true,
        choices: [...(box?.querySelectorAll(".ledger-qa-clarify button") ?? [])].filter(visible).map(el => el.innerText.trim()),
        status: box?.querySelector('[role="status"]')?.textContent?.trim() ?? "", text: box?.innerText ?? "" };
    }, root);
    assertLayoutState(state, await readState());
    await (await b.$("body")).moveTo({ xOffset: 2, yOffset: 2 }); await b.pause(250);
    await b.execute(AXE);
    const nodes = await b.executeAsync((selector, done) => window.axe.run({ include: [[selector]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })
      .then(r => done(r.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(" ")} ${n.any[0]?.data?.contrastRatio ?? ""}`)))).catch(e => done([`axe failed: ${String(e)}`])), root);
    for (const n of nodes) failures.push(`${label}: ${n}`);
    const g = await b.execute(selector => {
      const box = document.querySelector(selector), bad = [];
      if (!box) return { missing: true };
      const r = box.getBoundingClientRect();
      for (const el of box.querySelectorAll("button, input, label, h1, h2, h3, legend, p, td, th, li, span, summary")) {
        const q = el.getBoundingClientRect();
        if (q.width > 0 && (q.right > r.right + 1 || q.left < r.left - 1)) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`);
      }
      return { page: document.documentElement.scrollWidth > window.innerWidth + 1, own: box.scrollWidth > box.clientWidth + 1, inWindow: r.left >= -1 && r.right <= window.innerWidth + 1, bad };
    }, root);
    if (g.missing) failures.push(`${label}: nothing to inspect at ${root}`);
    else {
      if (g.page) failures.push(`${label}: the page scrolls sideways`);
      if (g.own) failures.push(`${label}: ${root} overflows its own width`);
      if (!g.inWindow) failures.push(`${label}: ${root} is not inside the window`);
      if (g.bad.length) failures.push(`${label}: outside ${root}: ${g.bad.join("; ")}`);
    }
    assertLayoutState(state, await readState());
    reached.add(label);
  }
  const closeAll = async () => { for (let i = 0; i < 4 && (await h.dialogOpen()); i++) { await b.keys("Escape"); await b.pause(250); } };
  const step = async (label, root, enter) => {
    try { await enter(); await inspect(label, root); } catch (e) { failures.push(`${label}: ${String(e.message ?? e).replace(/\s*\n\s*/g, " / ")}`); }
    await arm("hold", false);
    await closeAll(); if (await h.dialogOpen()) failures.push(`${label}: the dialog could not be closed`);
  };
  const waitCard = (selector, label, timeout = 8000) => b.waitUntil(async () => (await b.$(`${card} ${selector}`)).isExisting(), { timeout, timeoutMsg: `${label}: no ${selector} on the card` });
  const cardText = () => b.execute(() => document.querySelector(".ledger-qa-card")?.innerText ?? "");
  // A read that is served from what the page already holds never shows its waiting or failed state, so each of those starts on a freshly loaded page.
  const install = () => b.execute(() => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      // A thrown fetch would make the bridge fall back to its other transport and succeed, so the failure is a real error reply.
      if (window.__layoutFail && url.includes("get_ask_vault_snapshot")) return new Response(JSON.stringify("injected read failure"), { status: 500, headers: { "Content-Type": "application/json" } });
      if (window.__layoutHold && url.includes("get_ask_vault_snapshot")) await new Promise(r => (window.__layoutReaders ??= []).push(r));
      return real(input, init);
    };
  });
  const fresh = async () => { await b.refresh(); await h.openDashboard(); await install(); };
  const checkingId = async () => h.accountId("Everyday Checking");
  // Written straight to the profile: the app's own state does not change, only the native revision does.
  const changeProfileBehindTheApp = async note => h.bridgeWrite("create_manual_transaction", { accountId: await checkingId(), date: dayFrom(0, 2), description: note, amount: "-1.00", category: "Groceries", memberId: null, notes: null });
  const arm = (what, value) => b.execute((k, v) => {
    window[k] = v;
    if (k === "__layoutHold" && !v) for (const release of (window.__layoutReaders ?? []).splice(0)) release();
  }, what === "hold" ? "__layoutHold" : "__layoutFail", value);

  try {
    await h.openDashboard();
    for (const width of WIDTHS) {
      await b.setWindowSize(width, 900); await fresh();
      const at = `${width}`;
      if (sections.includes("ordinary")) {
        await step(`${at} answer-long-category`, card, async () => {
          await h.ask(`how much did I spend on ${LONG_CATEGORY} in ${month}`); await waitCard(".ledger-qa-answer", "answer");
          assert.ok((await cardText()).includes(LONG_CATEGORY), `the answer should name ${LONG_CATEGORY}`);
        });
        await step(`${at} clarification-long-store`, card, async () => {
          await h.ask("how much did I spend at sam last month"); await waitCard(".ledger-qa-clarify", "store clarification");
          notes.push(`${at} long-store question reached: ${(await cardText()).replace(/\s+/g, " ").slice(0, 110)}`);
        });
        await step(`${at} unsupported-long-store`, card, async () => {
          await h.ask(`how much did I spend at ${UNKNOWN_LONG_STORE} last month`); await waitCard(".ledger-qa-hint", "unsupported long store");
        });
        await step(`${at} unsupported-with-suggestions`, card, async () => { await h.ask("tell me a joke about money"); await waitCard(".ledger-qa-hint", "unsupported"); });
        if (width === WIDTHS[0]) {
          // The banner on the card itself: the person adds a transaction from the Dashboard (a real in-app write), the data reloads, and the open answer is withdrawn.
          await fresh();
          await step(`${at} ordinary-stale-banner`, card, async () => {
            await h.ask(`how much did I spend on Dining Out last month`); await waitCard(".ledger-qa-answer", "answer");
            await (await b.$("button*=Add transaction")).click(); await b.$(".modal-panel").waitForExist({ timeout: 5000 });
            await (await b.$('.modal-panel input[placeholder*="Coffee"]')).setValue("ordinary stale banner");
            await (await b.$('.modal-panel input[placeholder="0.00"]')).setValue("1.00");
            await (await b.$('.modal-panel button[type="submit"]')).click();
            await b.waitUntil(async () => (await cardText()).includes("Your details changed"), { timeout: 10000, timeoutMsg: "ordinary stale banner: the card should say Your details changed; it says: " + (await cardText()).replace(/s+/g, " ").slice(0, 160) });
          });
          await fresh();
          await step(`${at} ordinary-stale`, dlg, async () => {
            await h.ask(`how much did I spend on Dining Out last month`); await waitCard(".ledger-qa-answer", "answer");
            await changeProfileBehindTheApp("ordinary stale"); await (await (await b.$(card)).$("button*=View ")).click();
            await h.waitText("Your details changed", "ordinary stale", 8000);
          });
        }
        await fresh();
        await step(`${at} ordinary-error`, card, async () => { await arm("fail", true); await h.ask(`how much did I spend on Dining Out in ${month}`); await waitCard(".ledger-qa-banner-error", "error"); await arm("fail", false); });
      }
      if (sections.includes("m3")) {
        const m3 = `Help me save $5 on Dining Out once on ${dayFrom(1, 5)}`;
        // Waiting and failed screens do not depend on the width beyond the shared dialog shell, so they are inspected at the narrowest width only.
        if (width === WIDTHS[0]) {
          await fresh();
          await step(`${at} m3-reading`, dlg, async () => { await arm("hold", true); await h.ask(m3); await h.waitText("Reading your last three months of", "m3 reading", 6000); });
          await arm("hold", 0); await closeAll();
          await fresh();
          await step(`${at} m3-error`, dlg, async () => { await arm("fail", true); await h.ask(m3); await h.waitText("I could not do that", "m3 error", 8000); await arm("fail", false); });
        }
        if (width === WIDTHS[0]) {
          await fresh();
          await step(`${at} m3-stale`, dlg, async () => {
            await h.ask(m3); await h.waitText("Check these details", "m3 review", 15000);
            await changeProfileBehindTheApp("m3 stale"); await h.clickButton("Show what I would save"); await h.waitText("Your details changed", "m3 stale", 8000);
          });
        }
        await fresh();
        await step(`${at} m3-review-long-category`, dlg, async () => { await h.ask(`Help me save $5 on ${LONG_CATEGORY} once on ${dayFrom(1, 5)}`); await h.waitText("Check these details", "m3 review, long category", 15000); });
      }
      if (sections.includes("m4")) {
        const m4 = (category, floor) => `Save $5 monthly across ${category} with ${category} floor $${floor} and maximum cut 100% from ${dayFrom(1, 1)} through ${dayFrom(2, 28)}`;
        const toChoices = async question => { await h.ask(question); await h.waitText("Where would you like to cut back?", "m4 choices"); const part = await b.$("label*=Count the part month by the day"); if (await part.isExisting()) await (await part.$("input")).click(); };
        await fresh();
        await step(`${at} m4-choices-long-category`, dlg, async () => { await h.ask(`Save $5 monthly across ${LONG_CATEGORY} and Dining Out from ${dayFrom(1, 1)} through ${dayFrom(2, 28)}`); await h.waitText("Where would you like to cut back?", "m4 choices"); });
        if (width === WIDTHS[0]) {
          await fresh();
          await step(`${at} m4-reading`, dlg, async () => { await toChoices(m4("Dining Out", 0)); await arm("hold", true); await h.clickButton("Review the details"); await h.waitText("Reading spending records", "m4 reading", 6000); });
          await arm("hold", 0); await closeAll();
          await fresh();
          await step(`${at} m4-error`, dlg, async () => { await toChoices(m4("Dining Out", 0)); await arm("fail", true); await h.clickButton("Review the details"); await h.waitText("I could not read those records", "m4 error", 8000); await arm("fail", false); });
        }
        if (width === WIDTHS[0]) {
          await fresh();
          await step(`${at} m4-stale`, dlg, async () => {
            await toChoices(m4("Dining Out", 0)); await h.clickButton("Review the details"); await h.waitText("Check every detail", "m4 review", 15000);
            await changeProfileBehindTheApp("m4 stale"); await h.clickButton("Show the preview"); await h.waitText("Your details changed", "m4 stale", 8000);
          });
        }
        // "A few details need attention" (blocked) is not reached: the review screen refuses a floor above the usual month with the same exact comparison the calculation uses
        // (CutPreviewDialog.tsx:165-168 against cutPreviewMath.ts:62-68), so no question produces it. JSDOM covers the screen (Step4 section D-S5-03).
        await fresh();
        await step(`${at} m4-review-long-category`, dlg, async () => { await toChoices(m4(LONG_CATEGORY, 500)); await h.clickButton("Review the details"); await h.waitText("the monthly floor is above this usual month", "m4 review", 15000); });
      }
    }
  } finally { await app.close(); }

  try { assertLayoutCoverage(reached, sections); } catch (e) { failures.push(e.message); }
  for (const n of notes) console.log(`[layout] ${n}`);
  assert.deepEqual(failures, [], `${failures.length} layout/state problem(s):\n${failures.join("\n")}`);
  console.log(`LAYOUT CHECKS PASSED (${sections.join("+")}; ${WIDTHS.join(", ")} px; ${reached.size} states)`);
}
