// 1.3.5 screens in one style, light and dark, in the real app: the Savings rate chart's unfinished month (VS-64), the
// "what is missing" notes beside a greyed-out button (VS-49: Budget and the rule editor) and the import review's list of
// unreadable rows (VS-52). Each spec file runs one style (feature422 Default, 423 Futuristic, 424 Retro) so it fits the 60 s ceiling.
// Screenshots go through the harness session, so `--keep-screens` keeps them.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, stubFilePicker, waitUntilOrDiagnose, openSettingsGroup, dismissStatusMessages } from "./../harness.mjs";
import { seedFixture } from "./seed.mjs";
import { makeTempDir } from "./tempDir.mjs";
import { dateInMonth } from "./dates.mjs";
import { openReportsTab } from "./reportsTabs.mjs";
import { startImportInto } from "./importAccount.mjs";

/** True when a field is visibly marked as wrong: its border, or (Retro) its outline, is the theme's --negative colour. */
export function markedWrong(b, selector) {
  return b.execute(sel => {
    const el = document.querySelector(sel);
    const probe = document.createElement("span");
    probe.style.color = "var(--negative)";
    el.parentElement.appendChild(probe);
    const negative = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    return cs.borderTopColor === negative || (cs.outlineStyle !== "none" && cs.outlineColor === negative);
  }, selector);
}

/** How a footer note sits beside its buttons: the note's line count, each button's line count and whether they share a row. */
export function footerLayout(b, noteSelector) {
  return b.execute(sel => {
    const lines = el => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size; };
    const note = document.querySelector(sel);
    const buttons = [...note.parentElement.querySelectorAll(":scope > button")];
    const n = note.getBoundingClientRect();
    const mid = n.top + n.height / 2;
    return {
      noteLines: lines(note),
      buttonLines: buttons.map(lines),
      buttonHeights: buttons.map(btn => Math.round(btn.getBoundingClientRect().height)),
      buttonsTogether: new Set(buttons.map(btn => Math.round(btn.getBoundingClientRect().top))).size === 1,
      sameRow: buttons.every(btn => { const r = btn.getBoundingClientRect(); return mid > r.top && mid < r.bottom; }),
    };
  }, noteSelector);
}

export async function runScreens({ style, palette, number }) {
  // Income and spending in two earlier months and in this one (day 1, so it is never in the future).
  const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('Checking','checking','5000.00')")
account=cur.lastrowid
def month(back):
    index=today.year*12+today.month-1-back
    y,m=divmod(index,12)
    return y,m+1
def add(y,m,d,description,amount,category):
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)",(account,datetime.date(y,m,d).isoformat(),description,amount,category,description))
for back,income,expense in [(2,'800.00','-200.00'),(1,'800.00','-300.00'),(0,'800.00','-150.00')]:
    y,m=month(back)
    add(y,m,1,f'Pay {back}',income,'Salary')
    add(y,m,1,f'Spend {back}',expense,'Groceries')
`);
  const dir = makeTempDir(`vaultspend-vs${number}-`);
  const d = n => dateInMonth(-1, n);
  // Seven unreadable rows (four with no amount, three with an impossible date) and one good one.
  const csv = path.join(dir, "problems.csv");
  fs.writeFileSync(csv, ["date,description,amount",
    `${d(2)},ZZ NO AMOUNT ONE,`, `13/45/2026,ZZ BAD DATE ONE,-2.00`, `${d(3)},ZZ NO AMOUNT TWO,`, `13/45/2026,ZZ BAD DATE TWO,-3.00`,
    `${d(4)},ZZ NO AMOUNT THREE,`, `13/45/2026,ZZ BAD DATE THREE,-4.00`, `${d(5)},ZZ NO AMOUNT FOUR,`, `${d(6)},ZZ GOOD ROW,-1.00`, ""].join("\n"));
  const shots = makeTempDir(`vaultspend-vs${number}-shots-`);
  fs.mkdirSync(shots, { recursive: true });

  const app = await launchApp({ dbDir });
  const b = app.browser;
  const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
  // Toasts from earlier steps ("Import cancelled", a rolled-forward balance) would sit over the screen, so clear them first.
  const shot = async (name, scrollTo) => {
    await dismissStatusMessages(b);
    if (scrollTo) await b.execute(sel => document.querySelector(sel)?.scrollIntoView({ block: "center" }), scrollTo);
    // A dialog fades in; wait for finite animations so the screenshot shows the settled screen, not the page through a half-faded dialog.
    await b.executeAsync(done => document.fonts.ready.then(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))).then(() => requestAnimationFrame(() => done(true))));
    await b.saveScreenshot(path.join(shots, `${name}.png`));
  };
  const text = selector => b.execute(sel => document.querySelector(sel)?.textContent ?? null, selector);
  const waitText = (selector, expected, what) => waitUntilOrDiagnose(b, async () => (await text(selector)) === expected, { timeoutMsg: what, extra: async () => ({ now: await text(selector) }) });
  const setMode = async mode => {
    await b.execute(m => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(el => el.textContent.trim().toLowerCase() === m).click(), mode);
    await waitUntilOrDiagnose(b, () => b.execute(m => document.documentElement.getAttribute("data-theme") === m, mode), { timeoutMsg: `${mode} applies` });
    await b.executeAsync(done => document.fonts.ready.then(() => done()));
  };

  async function savings(tag) {
    await nav("Reports");
    await openReportsTab(b, "savings");
    const section = await b.$("[data-report-savings]");
    await section.waitForDisplayed({ timeout: 10000 });
    await waitUntilOrDiagnose(b, () => b.execute(() => !!document.querySelector("[data-report-savings] [data-partial-segment]") && !!document.querySelector("[data-report-savings] [data-partial-point]")), { timeoutMsg: "the unfinished month is a dashed segment and a hollow point" });
    const month = new Date().toLocaleDateString("en-US", { month: "long" });
    assert.ok((await section.getText()).includes(`${month} isn't over yet, so its rate is only for the days so far.`), await section.getText());
    await shot(`${tag}-savings-rate`);
  }
  async function budget(tag) {
    await nav("Budget");
    await (await b.$("button=Add budget line")).click();
    await waitText("[data-budget-line-missing]", "Enter a monthly amount.", "an empty budget amount is explained");
    assert.equal(await (await b.$("//form[contains(@class,'bucket-new-form')]//button[normalize-space()='Save']")).isEnabled(), false);
    assert.equal(await b.execute(() => document.querySelector("[data-budget-line-missing]").getAttribute("role")), "status");
    await shot(`${tag}-budget-missing`, "[data-budget-line-missing]");
    const input = await b.$("input[placeholder='Monthly amount']");
    await input.setValue("1,250.40");
    await waitText("[data-budget-line-missing]", "Leave out the comma: 1250.40", "a comma in the amount is explained");
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    assert.ok(await markedWrong(b, "input[placeholder='Monthly amount']"), "the amount box is visibly marked as wrong (red border or outline)");
    await shot(`${tag}-budget-comma`, "[data-budget-line-missing]");
    await (await b.$("//form[contains(@class,'bucket-new-form')]//button[normalize-space()='Cancel']")).click();
  }
  async function rule(tag) {
    await nav("Settings");
    await openSettingsGroup(b, "features");
    const card = await b.$("#categorization-rules");
    await card.waitForExist({ timeout: 10000 });
    await (await card.$("button=Add rule")).click();
    const dialog = await b.$("[role='dialog']");
    await dialog.waitForExist({ timeout: 10000 });
    await waitText("[data-rule-missing]", "Enter the text to look for.", "an empty rule is explained");
    assert.equal(await (await dialog.$("button=Save rule")).isEnabled(), false);
    const layout = await footerLayout(b, "[data-rule-missing]");
    // On its own line above the buttons: never a narrow column, stretched buttons or buttons split across rows.
    assert.ok(layout.noteLines <= 2 && layout.buttonsTogether && layout.buttonLines.every(n => n === 1) && layout.buttonHeights.every(h => h <= 48), "the note reads as a sentence above one row of one-line buttons: " + JSON.stringify(layout));
    await shot(`${tag}-rule-missing`);
    await (await dialog.$("input[placeholder*='Ferrywood']")).setValue("ferrywood");
    await waitText("[data-rule-missing]", "Enter a category.", "a rule with text but no category is explained");
    await (await dialog.$("button=Cancel")).click();
    await dialog.waitForExist({ reverse: true, timeout: 5000 });
  }
  async function rowProblems(tag) {
    await nav("Transactions");
    await b.execute(file => window.__pickedFiles.unshift(file), csv);
    await startImportInto(b, "Checking");
    await waitUntilOrDiagnose(b, async () => {
      const keep = await b.$("button=Keep as-is");
      if (await keep.isDisplayed().catch(() => false)) await keep.click();
      return b.execute(() => !!document.querySelector("ul.import-row-problems"));
    }, { timeout: 30000, timeoutMsg: "the import review lists the unreadable rows", extra: () => b.execute(() => document.querySelector("[role='dialog']")?.innerText ?? "") });
    await dismissStatusMessages(b);
    const listed = () => b.execute(() => [...document.querySelectorAll("ul.import-row-problems li")].map(li => li.textContent));
    const first = await listed();
    assert.equal(first.length, 5, JSON.stringify(first));
    for (const li of first) assert.match(li, /^Row \d+: (This row has no amount\.|The date 13\/45\/2026 isn't a real date\.)/);
    assert.ok(first.some(li => li.includes("This row has no amount.")) && first.some(li => li.includes("The date 13/45/2026 isn't a real date.")), JSON.stringify(first));
    assert.ok(first.some(li => li.includes("ZZ")), "each row shows a short preview: " + JSON.stringify(first));
    const showAll = await b.$("button=Show all 7");
    await showAll.waitForDisplayed({ timeout: 5000 });
    assert.match(await b.execute(() => document.querySelector("[role='dialog'] .dup-review-summary")?.innerText ?? ""), /7 rows couldn't be read/);
    await shot(`${tag}-row-problems-first-five`);
    await showAll.click();
    await waitUntilOrDiagnose(b, async () => (await listed()).length === 7, { timeoutMsg: "Show all reveals all seven rows", extra: listed });
    assert.equal(await (await b.$("button=Show all 7")).isExisting(), false, "the control is gone once everything shows");
    await shot(`${tag}-row-problems-all`);
    await (await b.$("//div[contains(@class,'dup-review-actions')]//button[normalize-space()='Cancel']")).click();
    await (await b.$("button[data-import-confirm]")).waitForExist({ reverse: true, timeout: 5000 });
  }

  try {
    await b.setWindowSize(1280, 900);
    await chooseStyle(b, style, palette);
    await stubFilePicker(b, []);
    for (const mode of ["light", "dark"]) {
      await setMode(mode);
      const tag = `${palette}-${mode}`;
      await savings(tag);
      await budget(tag);
      await rule(tag);
      await rowProblems(tag);
    }
    console.log(`FEATURE ${number} PASSED: ${style} light and dark show the partial savings month, the missing-value notes and the unreadable-row list. Screenshots: ${shots}`);
  } finally { await app.close(); }
}
