import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chooseStyle, launchApp } from "../harness.mjs";
import { askHelpers } from "./askRetirement.mjs";
import { LONG_CATEGORY, assertLayoutState, seedLayoutProfile } from "./askLayoutChecks.mjs";
import { dateInMonth } from "./dates.mjs";

// M6 Task 7 (owner direction D-7; UI-03, UI-05, UI-06; Open-Items G-3): the affected Ask the Vault cells in every visual style, light and dark, at 720, 960 and 1280 px.
// Cells: the ordinary card's error and stale states (banner on the card, and the stale screen its link opens), the M3 review with a long unspaced category,
// and the M4 choices with a long unspaced category. Per cell: Axe (WCAG 2 A/AA, 2.1 AA, including text contrast), no horizontal overflow, nothing outside its container,
// then (for dialogs) the Tab order stays inside, Escape closes, and focus returns to the question. It reuses the layout profile and state guards of askLayoutChecks.mjs
// without editing that file, so the specs that already call it are unaffected. Sharded one combination per spec to stay under the suite's 60-second spec ceiling.
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
export const WINDOW_STYLES = [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]];
export const WINDOW_THEMES = ["light", "dark"];
export const WINDOW_WIDTHS = [720, 960, 1280];
export const WINDOW_CELLS = ["ordinary-error", "ordinary-stale-banner", "ordinary-stale", "m3-review-long-category", "m4-choices-long-category"];

export const windowCombinations = () => WINDOW_STYLES.flatMap(([style, palette]) => WINDOW_THEMES.flatMap(theme => WINDOW_WIDTHS.map(width => ({ style, palette, theme, width }))));
export const combinationKey = ({ style, theme, width }) => `${style}/${theme}/${width}`;
export const shardSpecName = ({ style, theme, width }) => `feature314_ask_window_${style.toLowerCase()}_${theme}_${width}.mjs`;
const narrow = only => windowCombinations().filter(c => (!only?.style || c.style === only.style) && (!only?.theme || c.theme === only.theme) && (!only?.width || c.width === Number(only.width)));
export const requiredWindowCoverage = only => narrow(only).flatMap(c => WINDOW_CELLS.map(cell => `${combinationKey(c)} ${cell}`));
export function assertWindowCoverage(reached, only) {
  const missing = requiredWindowCoverage(only).filter(key => !reached.has(key));
  assert.deepEqual(missing, [], `Missing window coverage: ${missing.join(", ")}`);
}
/** A Tab walk inside a dialog: every stop inside it, at least one stop, and every `required` control reachable. */
export function assertTabOrder(cell, order, required) {
  assert.ok(order.length > 0, `${cell}: no Tab stops were recorded`);
  assert.ok(order.every(o => o.inside), `${cell}: Tab leaves the dialog: ${JSON.stringify(order)}`);
  for (const name of required) assert.ok(order.some(o => o.name === name), `${cell}: ${name} is not reachable by Tab: ${JSON.stringify(order)}`);
}
/** Modal.tsx:29-37, 152-155 restores the invoking control. The input is also a valid continuation destination; an arbitrary card control is not. */
export function assertFocusRestored(cell, focus, { questionRequired = true } = {}) {
  assert.ok(!focus.onBody && (focus.onQuestion || focus.inCard), `${cell}: focus was lost after the dialog closed (${JSON.stringify(focus)})`);
  if (questionRequired) assert.ok(focus.onQuestion || focus.onInvoker, `${cell}: focus should return to the question or its invoking Ask control; ${JSON.stringify(focus)}`);
}

async function setTheme(b, mode) {
  await b.execute(m => { const group = document.querySelector('.theme-toggle[aria-label="Theme"]'); [...group.querySelectorAll("button")].find(x => x.textContent.trim().toLowerCase() === m).click(); }, mode);
  await b.waitUntil(() => b.execute(m => document.documentElement.getAttribute("data-theme") === m, mode), { timeout: 5000, timeoutMsg: `the ${mode} theme should apply` });
}

/** Runs the cells for the combinations selected by `only` (style, theme, width); each field is optional and narrows the set. */
export async function runAskWindow(only = {}) {
  const combos = narrow(only), failures = [], reached = new Set();
  const dbDir = await seedLayoutProfile();
  const app = await launchApp({ dbDir });
  const b = app.browser, h = askHelpers(b);
  const card = ".ledger-qa-card", dlg = '[role="dialog"]';
  const month = "last month";
  async function inspect(label, root, state) {
    const readState = () => b.execute(selector => {
      const box = document.querySelector(selector), visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      return { clarification: visible(box?.querySelector(".ledger-qa-clarify")) === true, answer: visible(box?.querySelector(".ledger-qa-answer")) === true,
        choices: [...(box?.querySelectorAll(".ledger-qa-clarify button") ?? [])].filter(visible).map(el => el.innerText.trim()), status: box?.querySelector('[role="status"]')?.textContent?.trim() ?? "", text: box?.innerText ?? "" };
    }, root);
    assertLayoutState(state, await readState());
    await (await b.$("body")).moveTo({ xOffset: 2, yOffset: 2 }); await b.pause(250);
    await b.execute(AXE);
    const nodes = await b.executeAsync((selector, done) => window.axe.run({ include: [[selector]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })
      .then(r => done(r.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(" ")} ${n.any[0]?.data?.fgColor ?? ""} on ${n.any[0]?.data?.bgColor ?? ""} at ${n.any[0]?.data?.contrastRatio ?? ""}`)))).catch(e => done([`axe failed: ${String(e)}`])), root);
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
  }
  const dialogFocus = () => b.execute(() => { const e = document.activeElement, d = document.querySelector('[role="dialog"]'); return { inside: !!d && d.contains(e), name: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 40) }; });
  const focusNow = () => b.execute(() => { const e = document.activeElement; return { onQuestion: e === document.querySelector(".ledger-qa-card input"), onInvoker: e === document.querySelector('.ledger-qa-card button[type="submit"]'), onBody: e === document.body || e === document.documentElement, inCard: !!e.closest?.(".ledger-qa-card") }; });
  /** Tab order, Escape and focus restoration for the dialog that is open now. */
  async function keyboard(label, { questionRequired = true } = {}) {
    assert.ok(await h.dialogOpen(), `${label}: a dialog should be open for the keyboard walk`);
    const first = await dialogFocus();
    assert.ok(first.inside, `${label}: focus did not move into the dialog when it opened (${JSON.stringify(first)})`);
    const required=await b.execute(()=>[...document.querySelector('[role="dialog"]').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(e=>e.getClientRects().length>0).map(e=>(e.getAttribute("aria-label")||e.textContent||e.tagName).trim().slice(0,40)));
    const order = [first];
    // Walk every real control plus a wrap; a fixed ten presses stopped before the M4 footer.
    for (let i = 0; i < required.length+2; i++) { await b.keys("Tab"); order.push(await dialogFocus()); }
    assertTabOrder(label, order, required);
    await b.keys("Escape");
    await b.waitUntil(async () => !(await h.dialogOpen()), { timeout: 5000, timeoutMsg: `${label}: Escape should close the dialog` });
    await b.pause(250);
    assertFocusRestored(label, await focusNow(), { questionRequired });
  }
  const closeAll = async () => { for (let i = 0; i < 4 && (await h.dialogOpen()); i++) { await b.keys("Escape"); await b.pause(250); } };
  async function cardKeyboard(label){
    const required=await b.execute(()=>[...document.querySelectorAll('.ledger-qa-banner-error button,.ledger-qa-banner-error a,.ledger-qa-banner button,.ledger-qa-banner a')].filter(e=>e.getClientRects().length>0).map(e=>e.textContent.trim()));
    assert.ok(required.length>0,`${label}: expected an actionable banner link`);
    await (await b.$('.ledger-qa-card input')).click();const reached=[];
    for(let i=0;i<10;i++){await b.keys('Tab');reached.push(await b.execute(()=>document.activeElement.textContent.trim()));}
    for(const name of required)assert.ok(reached.includes(name),`${label}: banner action ${name} is not keyboard reachable`);
  }
  const waitCard = (selector, label) => b.waitUntil(async () => (await b.$(`${card} ${selector}`)).isExisting(), { timeout: 8000, timeoutMsg: `${label}: no ${selector} on the card` });
  const cardText = () => b.execute(() => document.querySelector(".ledger-qa-card")?.innerText ?? "");
  const install = () => b.execute(() => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (window.__windowFail && url.includes("get_ask_vault_snapshot")) return new Response(JSON.stringify("injected read failure"), { status: 500, headers: { "Content-Type": "application/json" } });
      return real(input, init);
    };
  });
  const fresh = async () => { await b.refresh(); await h.openDashboard(); await install(); };
  const arm = value => b.execute(v => { window.__windowFail = v; }, value);
  const checkingId = () => h.accountId("Everyday Checking");
  const changeProfileBehindTheApp = async note => h.bridgeWrite("create_manual_transaction", { accountId: await checkingId(), date: dateInMonth(0, 2), description: note, amount: "-1.00", category: "Groceries", memberId: null, notes: null });

  try {
    await h.openDashboard();
    let current = null;
    for (const combo of combos) {
      if (current?.style !== combo.style) { await chooseStyle(b, combo.style, combo.palette); await h.openDashboard(); current = { style: combo.style, theme: null }; }
      if (current.theme !== combo.theme) { await setTheme(b, combo.theme); current.theme = combo.theme; }
      await b.setWindowSize(combo.width, 900);
      const at = combinationKey(combo);
      const cell = async (name, root, enter, after) => {
        const label = `${at} ${name}`;
        try {
          await fresh(); await enter(); await inspect(label, root, name);
          if(process.env.VS_TASK7_SHOTS){fs.mkdirSync(process.env.VS_TASK7_SHOTS,{recursive:true});await b.saveScreenshot(path.join(process.env.VS_TASK7_SHOTS,`${label.replace(/[^a-z0-9]/gi,"_")}.png`));}
          if (after) await after(label);
          reached.add(label);
        } catch (e) { failures.push(`${label}: ${String(e.message ?? e).replace(/\s*\n\s*/g, " / ")}`);if(process.env.VS_TASK7_SHOTS){fs.mkdirSync(process.env.VS_TASK7_SHOTS,{recursive:true});await b.saveScreenshot(path.join(process.env.VS_TASK7_SHOTS,`FAILED-${label.replace(/[^a-z0-9]/gi,"_")}.png`)).catch(()=>{});} }
        await arm(false); await closeAll();
      };
      await cell("ordinary-error", card, async () => { await arm(true); await h.ask(`how much did I spend on Dining Out in ${month}`); await waitCard(".ledger-qa-banner-error", "error"); await arm(false); },cardKeyboard);
      await cell("ordinary-stale-banner", card, async () => {
        await h.ask("how much did I spend on Dining Out last month"); await waitCard(".ledger-qa-answer", "answer");
        await (await b.$("button*=Add transaction")).click(); await b.$(".modal-panel").waitForExist({ timeout: 5000 });
        await (await b.$('.modal-panel input[placeholder*="Coffee"]')).setValue("window stale banner");
        await (await b.$('.modal-panel input[placeholder="0.00"]')).setValue("1.00");
        await (await b.$('.modal-panel button[type="submit"]')).click();
        await b.waitUntil(async () => (await cardText()).includes("Your details changed"), { timeout: 10000, timeoutMsg: `the card should say Your details changed; it says: ${(await cardText()).replace(/\s+/g, " ").slice(0, 160)}` });
      },cardKeyboard);
      await cell("ordinary-stale", dlg, async () => {
        await h.ask("how much did I spend on Dining Out last month"); await waitCard(".ledger-qa-answer", "answer");
        await changeProfileBehindTheApp("window stale"); await (await (await b.$(card)).$("button*=View ")).click();
        await h.waitText("Your details changed", "ordinary stale", 8000);
      }, label => keyboard(label, { questionRequired: false }));
      await cell("m3-review-long-category", dlg, async () => { await h.ask(`Help me save $5 on ${LONG_CATEGORY} once on ${dateInMonth(1, 5)}`); await h.waitText("Check these details", "m3 review, long category", 15000); }, label => keyboard(label));
      await cell("m4-choices-long-category", dlg, async () => { await h.ask(`Save $5 monthly across ${LONG_CATEGORY} and Dining Out from ${dateInMonth(1, 1)} through ${dateInMonth(2, 28)}`); await h.waitText("Where would you like to cut back?", "m4 choices"); }, label => keyboard(label));
    }
  } finally { await app.close(); }
  try { assertWindowCoverage(reached, only); } catch (e) { failures.push(e.message); }
  assert.deepEqual(failures, [], `${failures.length} window problem(s):\n${failures.join("\n")}`);
  console.log(`ASK WINDOW PASSED (${combos.map(combinationKey).join(", ")}; ${reached.size} cells)`);
}
