import assert from "node:assert/strict";
import fs from "node:fs";
import { chooseStyle, launchApp, withFocusRetry } from "../harness.mjs";
import { askHelpers, LONG_NAME, NEAR_NAME_A, QUESTION, QUESTION_NO_ACCOUNT, QUESTION_REFUSED, REFUSAL_MESSAGE, seedRetirementProfile } from "./askRetirement.mjs";
import { seedFixture } from "./seed.mjs";
import { withAskReady } from "./askReady.mjs";
import { ensureAxe, waitForVisualStability, measurePhase } from "./axeSession.mjs";

// M5 compiled-screen acceptance (V3): every reachable screen, in the three styles, light and dark, at 720, 960 and 1280 px wide, with long and
// near-duplicate account names. For every combination: Axe (WCAG 2 A, AA and 2.1 AA, including contrast), the dialog's geometry (inside the window, no
// horizontal overflow, nothing clipped), the announced heading and live region, focus inside the dialog, and a screenshot when VS_M5_SHOTS is set.
// A keyboard-only walk and the error card (more investment accounts than can be listed) are separate sections.
// The numeric-refusal ("blocked") card IS reachable from a real question: a typed 100% return to October 2100 passes review and consent and the calculator then
// refuses it (corpus case m5c-027). It is in this matrix, with a long account name and with the recovery choices it leads to, and in the keyboard walk.
const SHOTS = process.env.VS_M5_SHOTS;
// The suite kills a spec after 60 s, so the matrix runs as shards (feature305_screens_<style>_<theme>_<width>, plus feature305_screens_keyboard_and_error), each selecting
// its slice here. Run with none of these set, the whole matrix runs in one process (the acceptance total is the same either way).
const QUICK = process.env.VS_M5_QUICK === "1"; // debugging aid only: one style and width
const ONLY = { style: process.env.VS_M5_STYLE, theme: process.env.VS_M5_THEME, width: process.env.VS_M5_WIDTH, section: process.env.VS_M5_SECTION };
const WIDTHS = (QUICK ? [960] : [720, 960, 1280]).filter(w => !ONLY.width || String(w) === ONLY.width);
const STYLES = (QUICK ? [["Default", "transparent"]] : [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]).filter(([name]) => !ONLY.style || name === ONLY.style);
const THEMES = ["light", "dark"].filter(t => !ONLY.theme || t === ONLY.theme);
const RUN_MATRIX = ONLY.section !== "keyboard-and-error", RUN_EXTRAS = ONLY.section === "keyboard-and-error" || !ONLY.section;
/** Mirrors RETIREMENT_ANNOUNCEMENTS in src/askVault/retirementScreenContract.ts (a repository test keeps the two equal). */
const ANNOUNCE = {
  choices: { heading: "A few details to confirm", live: "none" }, reading: { heading: "Reading your account", live: "status" }, review: { heading: null, live: "none" },
  result: { heading: null, live: "status" }, "deposits-only": { heading: null, live: "status" }, blocked: { heading: "A few details need attention", live: "alert" },
  explore: { heading: "Explore other returns", live: "none" },
  unsupported: { heading: "I can't do that yet", live: "status" }, stale: { heading: "Your details changed", live: "alert" }, error: { heading: "I couldn't read that account", live: "alert" },
};
const dbDir = await measurePhase("M5 fixture", () => seedRetirementProfile());
const app = await measurePhase("M5 startup", () => launchApp({ dbDir }));
const b = app.browser;
const h = askHelpers(b);
const failures = [], seen = new Set();
const shoot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await b.saveScreenshot(`${SHOTS}/feature305-${name}.png`); } };
const primary = async () => (await h.dialog()).$$(".modal-actions button").then(all => all[all.length - 1]);
async function clickPrimary() { const button = await primary(); await button.waitForEnabled({ timeout: 8000 }); await button.click(); }
async function setTheme(mode) {
  await b.execute(m => { const group = document.querySelector('.theme-toggle[aria-label="Theme"]'); [...group.querySelectorAll("button")].find(x => x.textContent.trim().toLowerCase() === m).click(); }, mode);
}

/** Axe, geometry, announcement, focus and a screenshot for the screen that is open now. */
async function inspect(label, stage = null) {
  return measurePhase("M5 inspection", async () => {
  seen.add(stage ?? label);
  await (await b.$("body")).moveTo({ xOffset: 2, yOffset: 2 });
  await waitForVisualStability(b); // same 450 ms allowance; inspect only after finite transitions and layout settle
  await ensureAxe(b);
  const nodes = await b.executeAsync(done => window.axe.run({ include: [['[role="dialog"]']] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })
    .then(r => done(r.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(" ")} — ${n.any[0]?.data?.fgColor ?? ""} on ${n.any[0]?.data?.bgColor ?? ""} at ${n.any[0]?.data?.contrastRatio ?? ""}`))))
    .catch(e => done([`axe failed: ${String(e)}`])));
  for (const n of nodes) failures.push(`${label}: ${n}`);
  const geometry = await b.execute(() => {
    const d = document.querySelector('[role="dialog"]'), r = d.getBoundingClientRect(), clipped = [];
    for (const el of d.querySelectorAll("button, input, label, h1, h2, h3, legend, p, td, th, li")) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && (box.right > r.right + 1 || box.left < r.left - 1)) clipped.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`);
    }
    const body = d.querySelector(".modal-body, .modal-content") ?? d;
    return { inside: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1, overflowX: d.scrollWidth > d.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1, clipped, width: Math.round(r.width), window: window.innerWidth };
  });
  if (!geometry.inside) failures.push(`${label}: the dialog is not inside the window ${JSON.stringify(geometry)}`);
  if (geometry.overflowX) failures.push(`${label}: horizontal overflow ${JSON.stringify(geometry)}`);
  if (geometry.clipped.length) failures.push(`${label}: clipped ${geometry.clipped.join("; ")}`);
  const semantics = await b.execute(() => {
    const d = document.querySelector('[role="dialog"]'), id = d.getAttribute("aria-labelledby"), title = id ? document.getElementById(id)?.textContent?.trim() : null;
    return { modal: d.getAttribute("aria-modal"), title, alerts: d.querySelectorAll('[role="alert"]').length, statuses: d.querySelectorAll('[role="status"], [aria-live="polite"]').length, focusInside: d.contains(document.activeElement) };
  });
  if (!semantics.title) failures.push(`${label}: the dialog has no accessible name`);
  if (semantics.modal !== "true") failures.push(`${label}: aria-modal is not true`);
  if (!semantics.focusInside) failures.push(`${label}: focus is not inside the dialog`);
  const expected = stage && ANNOUNCE[stage];
  if (expected) {
    if (expected.heading && semantics.title !== expected.heading) failures.push(`${label}: heading "${semantics.title}" should be "${expected.heading}"`);
    if (expected.live === "alert" && !semantics.alerts) failures.push(`${label}: no alert announced`);
    if (expected.live === "status" && !semantics.statuses) failures.push(`${label}: no status announced`);
    if (expected.live === "none" && (semantics.alerts || semantics.statuses)) failures.push(`${label}: nothing should be announced here`);
  }
  await shoot(label.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  });
}

/** Asks a question the calculator refuses after consent, confirms the review, and waits for the numeric-refusal card (with its wording and no fabricated balance). */
async function toBlocked(question, accountFragment) {
  await h.ask(question); await h.waitText(accountFragment, `review for ${accountFragment}`, 15000);
  await clickPrimary(); await h.waitText("A few details need attention", "numeric refusal");
  const shown = await h.text();
  if (!shown.includes(REFUSAL_MESSAGE)) throw new Error(`the refusal should say "${REFUSAL_MESSAGE}"; it says "${shown}"`);
  if (/Illustrative balance|\$\d[\d,]{4,}|no investment growth/i.test(shown)) throw new Error(`a refused calculation must not show a balance: "${shown}"`);
}

const SCREENS = [
  ["choices", "choices", async () => { await h.ask(QUESTION_NO_ACCOUNT); await h.waitText("Nothing has been calculated yet", "choices"); }],
  ["choices-menu-long-names", "choices", async () => {
    await h.ask(QUESTION_NO_ACCOUNT); await h.waitText("Nothing has been calculated yet", "choices");
    // A menu closes when the window loses OS focus, and under the parallel runner another spec's window can take it; the helper reclaims focus and, only if the window
    // lost it while the step ran, runs the step again. A menu that closes with focus held is a real failure and is thrown at once.
    await withFocusRetry(b, async () => {
      await (await h.dialog()).$("button[aria-haspopup]").click().catch(() => null); await b.pause(150);
      if (!(await b.execute(() => document.querySelector('[role="dialog"]').contains(document.activeElement)))) throw new Error("focus left the dialog while the account menu was open");
    });
  }],
  ["review-saved-plan", "review", async () => { await h.ask(QUESTION()); await h.waitText("Use my saved plan", "review"); }],
  ["review-no-saved-return", "review", async () => { await h.ask(QUESTION("M5 No Plan")); await h.waitText("M5 No Plan", "review without a plan"); }],
  ["review-no-contribution-basis", "review", async () => { await h.ask(QUESTION("M5 No Contribution")); await h.waitText("M5 No Contribution", "review without a contribution basis"); }],
  ["review-no-recorded-value", "review", async () => { await h.ask(QUESTION("M5 No Value")); await h.waitText("M5 No Value", "review without a value"); }],
  ["review-long-name", "review", async () => { await h.ask(QUESTION(LONG_NAME)); await h.waitText("M5 Long Name", "review, long name"); }],
  ["review-near-duplicate-name", "review", async () => { await h.ask(QUESTION(NEAR_NAME_A)); await h.waitText("M5 Brokerage", "review, near-duplicate name"); }],
  ["result", "result", async () => { await h.ask(QUESTION()); await h.waitText("Use my saved plan", "review"); await h.clickButton("Use my saved plan"); await h.waitText("Illustrative balance at", "result"); }],
  ["result-long-name", "result", async () => { await h.ask(QUESTION(LONG_NAME)); await h.waitText("M5 Long Name", "review"); await clickPrimary(); await h.waitText("Illustrative balance at", "result, long name"); }],
  ["explore", "explore", async () => { await h.ask(QUESTION()); await h.waitText("Use my saved plan", "review"); await h.clickButton("Use my saved plan"); await h.waitText("Illustrative balance at", "result"); await h.clickButton("Explore other returns"); await h.waitText("Show these returns", "explore"); }],
  ["explore-result", "result", async () => {
    await h.ask(QUESTION()); await h.waitText("Use my saved plan", "review"); await h.clickButton("Use my saved plan"); await h.waitText("Illustrative balance at", "result");
    await h.clickButton("Explore other returns"); await h.waitText("Show these returns", "explore"); await clickPrimary(); await h.waitText("Illustrative balance at", "result with other returns");
  }],
  ["no-growth", "result", async () => { await h.ask(QUESTION("M5 No Plan")); await h.waitText("M5 No Plan", "review without a plan");
    // The plan saves no monthly amount, so the person types what they add now before the primary action is available.
    const amount = await (await h.dialog()).$("label.modal-field input"); if (await amount.isExisting()) await amount.setValue("100");
    await clickPrimary(); await h.waitText("No investment growth", "no-growth result"); }],
  ["deposits-only", "deposits-only", async () => {
    await h.ask(QUESTION("M5 No Value")); await h.waitText("M5 No Value", "review without a value");
    const buttons = await (await h.dialog()).$$("button"); let clicked = false;
    for (const button of buttons) { const label = (await button.getText()).toLowerCase(); if (label.includes("deposits")) { await button.click(); clicked = true; break; } }
    if (!clicked) await clickPrimary();
    await b.pause(300);
  }],
  ["blocked", "blocked", async () => { await toBlocked(QUESTION_REFUSED(), "M5 IRA"); }],
  ["blocked-long-name", "blocked", async () => { await toBlocked(QUESTION_REFUSED(LONG_NAME), "M5 Long Name"); }],
  ["blocked-recovery-choices", "choices", async () => { await toBlocked(QUESTION_REFUSED(), "M5 IRA"); await h.clickButton("Change the details"); await h.waitText("Nothing has been calculated yet", "choices reopened by Change the details"); }],
  ["unsupported", "unsupported", async () => { await h.ask("Should I save more for retirement"); await h.waitText("I can't tell you", "refusal"); }],
  ["stale", "stale", async () => { await h.ask(QUESTION()); await h.waitText("Use my saved plan", "review"); await h.bridgeWrite("set_investment_plan", await h.planArgs("M5 IRA", "3")); await b.execute(() => window.dispatchEvent(new Event("focus"))); await h.waitText("Your details changed", "stale"); }],
];

try {
  await measurePhase("M5 navigation", () => h.openDashboard());
  // The reading card is brief; hold the roster reply for a moment (a slow native read) so the card can be inspected for real.
  await b.execute(() => { const real = window.fetch.bind(window); window.fetch = async (input, init) => { const url = String(input instanceof Request ? input.url : input); if (window.__m5Hold && url.includes("get_ask_vault_retirement_accounts")) await new Promise(r => setTimeout(r, window.__m5Hold)); return real(input, init); }; });

  for (const [style, palette] of RUN_MATRIX ? STYLES : []) {
    await chooseStyle(b, style, palette);
    for (const mode of THEMES) {
      await setTheme(mode);
      for (const width of WIDTHS) {
        await b.setWindowSize(width, 900);
        await measurePhase("M5 navigation", () => h.openDashboard());
        const where = `${style}/${mode}/${width}`;
        await b.execute(() => { window.__m5Hold = 1500; });
        await withAskReady(b, () => h.ask(QUESTION())); await h.waitText("Reading", `${where} reading`, 5000);
        await inspect(`${where} reading`, "reading");
        await b.execute(() => { window.__m5Hold = 0; });
        await h.waitText("Use my saved plan", `${where} review after reading`, 15000); await h.closeDialog();
        for (const [name, stage, enter] of SCREENS) {
          try { await measurePhase("M5 screen entry", enter); await inspect(`${where} ${name}`, stage); }
          catch (e) { failures.push(`${where} ${name}: ${String(e.message ?? e).replace(/\s*\n\s*/g, " / ")}`); }
          for (let attempt = 0; attempt < 4 && (await h.dialogOpen()); attempt++) { await h.closeDialog().catch(async () => { await b.keys("Escape"); await b.pause(200); }); }
          if (await h.dialogOpen()) failures.push(`${where} ${name}: the dialog could not be closed`);
        }
      }
    }
  }
  await b.setWindowSize(1280, 900); await chooseStyle(b, "Default", "transparent"); await setTheme("light"); await h.openDashboard();
  if (RUN_EXTRAS) {

  // ---- Keyboard only: type, ask, move through the dialog, confirm, close; nothing needs a pointer. ------------------------------------------------------------
  await b.execute(() => document.querySelector(".ledger-qa-card input").focus());
  await b.keys(QUESTION()); await b.keys("Enter");
  await h.waitText("Use my saved plan", "keyboard: review");
  assert.ok(await b.execute(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), "keyboard: focus moves into the dialog when it opens");
  const order = [];
  for (let i = 0; i < 14; i++) {
    await b.keys("Tab");
    order.push(await b.execute(() => { const e = document.activeElement, d = document.querySelector('[role="dialog"]'); return { inside: !!d && d.contains(e), name: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 40) }; }));
  }
  assert.ok(order.every(o => o.inside), `keyboard: Tab never leaves the dialog: ${JSON.stringify(order)}`);
  assert.ok(order.some(o => o.name === "Close") && order.some(o => o.name === "Use my saved plan"), `keyboard: Close and the primary action are reachable by Tab: ${JSON.stringify(order)}`);
  await b.keys(["Shift", "Tab"]); await b.keys("Shift");
  await b.execute(() => [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent.trim() === "Use my saved plan").focus());
  await b.keys("Enter"); await h.waitText("Illustrative balance at", "keyboard: result");
  await b.keys("Escape");
  await b.waitUntil(async () => !(await h.dialogOpen()), { timeout: 5000, timeoutMsg: "keyboard: Escape closes the result" });
  assert.ok(await h.focusOnQuestion(), "keyboard: focus returns to the question after Escape");
  // Choices by keyboard: pick an account with the arrow keys and continue.
  await b.execute(() => { window.__focusLog = []; document.addEventListener("focusin", e => window.__focusLog.push(`${Math.round(performance.now())} ${e.target.tagName}${e.target.getAttribute?.("role") ? `[${e.target.getAttribute("role")}]` : ""}${e.target.closest?.('[role="dialog"]') ? " in-dialog" : ""}`), true); document.querySelector(".ledger-qa-card input").select(); });
  await b.keys(QUESTION_NO_ACCOUNT); await b.keys("Enter"); await h.waitText("Nothing has been calculated yet", "keyboard: choices");
  const focusInChoices = () => b.execute(() => document.querySelector('[role="dialog"]').contains(document.activeElement));
  await b.pause(500);
  assert.ok(await focusInChoices(), `keyboard: focus is inside the choices card; it is on ${await b.execute(() => { const e = document.activeElement; return `${e.tagName} type=${e.type} in-qa-card=${!!e.closest(".ledger-qa-card")} aria=${e.getAttribute("aria-label")}`; })}; focus log: ${JSON.stringify(await b.execute(() => window.__focusLog.slice(-12)))}`);
  await b.keys("Escape"); await b.waitUntil(async () => !(await h.dialogOpen()), { timeout: 5000 });

  // ---- Keyboard only: a numeric refusal, focus containment, recovery with "Change the details", and focus restored on Escape. ---------------------------------
  await b.execute(() => { const input = document.querySelector(".ledger-qa-card input"); input.focus(); input.select(); });
  await b.keys(QUESTION_REFUSED()); await b.keys("Enter");
  await h.waitText("Retirement month", "keyboard: review of the refused question");
  await b.execute(() => [...document.querySelectorAll('[role="dialog"] .modal-actions button')].at(-1).focus()); await b.keys("Enter");
  await h.waitText("A few details need attention", "keyboard: numeric refusal");
  const blockedFocus = () => b.execute(() => { const e = document.activeElement, d = document.querySelector('[role="dialog"]'); return { inside: !!d && d.contains(e), name: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 40) }; });
  assert.ok((await blockedFocus()).inside, "keyboard: focus is inside the numeric-refusal card when it opens");
  const blockedOrder = [];
  for (let i = 0; i < 8; i++) { await b.keys("Tab"); blockedOrder.push(await blockedFocus()); }
  assert.ok(blockedOrder.every(o => o.inside), `keyboard: Tab never leaves the numeric-refusal card: ${JSON.stringify(blockedOrder)}`);
  assert.ok(blockedOrder.some(o => o.name === "Close") && blockedOrder.some(o => o.name === "Change the details"), `keyboard: Close and Change the details are reachable by Tab: ${JSON.stringify(blockedOrder)}`);
  await b.execute(() => [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent.trim() === "Change the details").focus()); await b.keys("Enter");
  await h.waitText("Nothing has been calculated yet", "keyboard: Change the details reopens the choices");
  assert.ok((await blockedFocus()).inside, "keyboard: focus stays inside the dialog when the choices reopen");
  await b.keys("Escape"); await b.waitUntil(async () => !(await h.dialogOpen()), { timeout: 5000, timeoutMsg: "keyboard: Escape closes the reopened choices" });
  assert.ok(await h.focusOnQuestion(), "keyboard: focus returns to the question after leaving the recovery");
  seen.add("blocked-keyboard");

  // ---- The error card: more investment accounts than can be listed. -------------------------------------------------------------------------------------------
  await app.close();
  const manyDir = await seedFixture(String.raw`
for n in range(201):
    cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES(?,'investment','0')", ("Many %03d" % n,))
`);
  const second = await launchApp({ dbDir: manyDir });
  const b2 = second.browser, h2 = askHelpers(b2);
  try {
    await h2.openDashboard(); await h2.ask("extra $50 a month for retirement"); await h2.waitText("more investment accounts than I can list", "error card");
    const title = await b2.execute(() => { const d = document.querySelector('[role="dialog"]'); return { title: document.getElementById(d.getAttribute("aria-labelledby"))?.textContent?.trim(), alert: d.querySelectorAll('[role="alert"]').length }; });
    assert.equal(title.title, ANNOUNCE.error.heading); assert.ok(title.alert > 0, "the error is announced as an alert");
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await b2.saveScreenshot(`${SHOTS}/feature305-error-card.png`); }
    seen.add("error");
  } finally { await second.close(); }
  }

  const expectedScreens = [...(RUN_MATRIX ? ["reading", "choices", "review", "result", "explore", "deposits-only", "blocked", "unsupported", "stale"] : []), ...(RUN_EXTRAS ? ["blocked-keyboard", "error"] : [])];
  for (const s of expectedScreens) if (!seen.has(s)) failures.push(`the matrix never reached the ${s} screen`);
  assert.deepEqual(failures, [], `${failures.length} screen problem(s):\n${failures.join("\n")}`);
  console.log(`FEATURE 305 M5 COMPILED SCREENS PASSED (${RUN_MATRIX ? `${STYLES.length} style(s) x ${THEMES.length} theme(s) x ${WIDTHS.length} width(s) x ${SCREENS.length + 1} screens` : "no matrix"}${RUN_EXTRAS ? ", keyboard walk, error card" : ""})`);
} finally { try { await measurePhase("M5 cleanup", () => app.close()); } catch { /* already closed */ } }
