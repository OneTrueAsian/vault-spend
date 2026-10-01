// Shared helpers for the Reports > Comparisons specs (feature144-147).
//
// Expected numbers are recomputed here from the published workbooks' own figures (kept in
// core/data/benchmarks) with plain JavaScript, not read back from what the app displays, so a wrong
// cohort, a missed inflation adjustment or a sign error in the app fails the spec.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { seedFixture } from "./seed.mjs";

const PACKAGE_DIR = path.resolve("core/data/benchmarks");
const records = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "records.json"), "utf8"));
const cpi = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "cpi.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "manifest.json"), "utf8"));

export const PACKAGE_VERSION = manifest.packageVersion;

/** Figures read by hand from the Census workbooks' own cells; they anchor the package itself. */
export const PUBLISHED = {
  "cps_hinc02_money_income_median:40-44": 119300,
  "cps_hinc02_money_income_median:45-49": 120100,
  "cps_hinc02_money_income_median:65-69": 71400,
  "cps_pinc01_money_income_median:40-44": 64500,
  "cps_pinc01_money_income_median:45-49": 65320,
  "sipp_total_debt_median:35-44": 128000,
};

export function record(id) {
  const r = records.find((x) => x.id === id);
  if (!r) throw new Error(`no benchmark record ${id}`);
  return r;
}

/** The reference after the app's documented inflation adjustment (CPI of the latest month / of its basis). */
export function adjusted(id) {
  const r = record(id);
  const latest = Object.keys(cpi.months).sort().at(-1);
  const factor = Math.round((Number(cpi.months[latest]) / Number(cpi.months[r.dollarBasis.period])) * 1e6) / 1e6;
  return { original: Number(r.value), adjusted: Math.round(Number(r.value) * factor * 100) / 100, factor, latest };
}

export const whole = (n) => {
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 && Math.round(Math.abs(n)) !== 0 ? `-$${body}` : `$${body}`;
};

/** "+14.3%"-style text for local vs. reference, as the page words it. */
export function differenceText(local, reference) {
  const diff = local - reference;
  const pct = Math.round(((diff / reference) * 100) * 10) / 10;
  const amount = whole(Math.abs(diff));
  const direction = diff > 0 ? "above" : "below";
  const sign = pct > 0 ? `+${pct}%` : pct < 0 ? `−${Math.abs(pct)}%` : "0%";
  return diff === 0 ? "Same as the peer figure" : `${amount} ${direction} · ${sign}`;
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/** A python snippet (for seedFixture) that stores `setup` as revision 1 of the comparison setup. */
export function setupSnippet(setup) {
  return `
import base64
_payload = base64.b64decode("${b64(JSON.stringify(setup))}").decode("utf-8")
cur.execute("INSERT INTO comparison_setup (id, format_version, revision, payload, updated_at) VALUES (1, 1, 1, ?, '${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}')", (_payload,))
`;
}

export function person(id) {
  return id === 0 ? { kind: "owner" } : { kind: "member", id };
}

export function baseSetup(today, overrides = {}) {
  return {
    formatVersion: 1,
    mode: "household",
    householdReferencePerson: person(0),
    individualPerson: null,
    people: [
      { person: person(0), age: { age: { kind: "exact", age: 42 }, confirmedOn: today }, inHousehold: true },
      { person: person(1), age: { age: { kind: "exact", age: 67 }, confirmedOn: today }, inHousehold: true },
    ],
    income: { householdMethod: "total", householdTotal: { value: "100000", measuredOn: today, explanation: "Tax return" }, perPerson: [] },
    spending: { period: null, accountIds: [], completenessConfirmed: true, manualAnnual: null, categoryMappings: [] },
    savingsOverrides: [],
    investmentClasses: [],
    debtClasses: [],
    debtExclusions: [],
    allocations: [],
    balanceConfirmations: [],
    manualOverrides: [],
    cohortChoices: [],
    universePreferences: [],
    ...overrides,
  };
}

export async function invoke(browser, command, args = {}) {
  return browser.executeAsync(
    (command, args, done) => {
      window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (e) => done({ error: String(e) }));
    },
    command,
    args,
  );
}

export async function nav(browser, label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}

export async function openReportsTab(browser, tab) {
  await nav(browser, "Reports");
  const t = await browser.$(`[data-reports-tab='${tab}']`);
  await t.waitForExist({ timeout: 15000 });
  await t.click();
}

/** Opens Reports > Comparisons (unless it is already showing) and makes sure the "Your details" panel is expanded. */
export async function openComparisonDetails(browser) {
  const showing = await browser.$("[data-comparisons-page]");
  if (!(await showing.isExisting()) || !(await showing.isDisplayed())) await openReportsTab(browser, "comparisons");
  const toggle = await browser.$("[data-cmp-details-toggle]");
  await toggle.waitForExist({ timeout: 20000, timeoutMsg: "the Your details panel should be on the Comparisons tab" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await browser.$("[data-cmp-details-body] [data-cmp-settings]").waitForDisplayed({ timeout: 15000 });
}

export async function waitForCards(browser, { count } = {}) {
  await browser.waitUntil(
    async () => {
      const cards = await browser.$$("[data-comparisons-page] [data-metric]");
      return count === undefined ? cards.length > 0 : cards.length === count;
    },
    { timeout: 20000, timeoutMsg: `comparison cards never reached ${count ?? "any"}: ${(await browser.$("[data-comparisons-page]").getText().catch(() => "no page")).slice(0, 400)}` },
  );
}

export async function cardText(browser, metric) {
  return (await browser.$(`[data-comparisons-page] [data-metric='${metric}']`)).getText();
}

export async function setInput(browser, selector, value) {
  const el = await browser.$(selector);
  await el.waitForExist({ timeout: 10000 });
  await el.scrollIntoView();
  await el.click();
  await browser.keys(["Control", "a"]);
  await browser.keys("Delete");
  if (value !== "") await el.setValue(value);
}

/** The shared household fixture for the metrics specs: four tracked accounts plus a mortgage, three
 * confirmed balance groups, and a setup whose reference person is 42 (see feature145/feature149). */
export async function seedComparisonHousehold() {
  const today = new Date();
  const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const confirmations = ["savings", "investments", "debt"].map((metric) => ({ metric, confirmedOn: TODAY }));
  const setup = baseSetup(TODAY, {
    balanceConfirmations: confirmations,
    investmentClasses: [
      { source: { kind: "account", id: 2 }, class: "retirement" },
      { source: { kind: "account", id: 3 }, class: "taxable" },
    ],
    debtClasses: [{ source: { kind: "account", id: 5 }, class: "mortgage" }],
  });

  return seedFixture(`
cur.execute("INSERT INTO family_members (name) VALUES ('Partner')")
for name, kind, start in [('Checking', 'checking', '8000.00'), ('401k', 'investment', '80000.00'), ('Brokerage', 'investment', '20000.00'), ('Visa', 'credit', '10000.00'), ('Home loan', 'loan', '150000.00')]:
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?, ?, ?)", (name, kind, start))
${setupSnippet(setup)}
`);
}

export const metric = (browser, id) => browser.$(`[data-comparisons-page] [data-metric='${id}']`);
export async function expectComparison(browser, id, referenceId, local, ageText) {
  const ref = adjusted(referenceId);
  const card = await metric(browser, id);
  await card.waitForExist({ timeout: 20000, timeoutMsg: `no ${id} card` });
  await browser.waitUntil(async () => (await (await card.$("[data-cmp-local]")).getText()).includes(whole(local)), {
    timeout: 20000,
    timeoutMsg: `${id} should show ${whole(local)}, got: ${await cardText(browser, id)}`,
  });
  assert.equal(await (await card.$("[data-cmp-difference]")).getText(), differenceText(local, ref.adjusted), `${id} difference`);
  const reference = await (await card.$("[data-cmp-reference]")).getText();
  assert.ok(reference.includes(`ages ${ageText}`), `${id} should name its age group ${ageText}, got: ${reference}`);
  assert.ok(reference.includes(`${ref.latest} dollars`), `${id} should say which dollars: ${reference}`);
  assert.ok((await card.getText()).includes(whole(ref.adjusted)), `${id} should show the adjusted reference ${whole(ref.adjusted)}`);
}

export async function saveSettings(browser) {
  await (await browser.$("[data-cmp-settings-save]")).click();
  await browser.waitUntil(async () => (await (await browser.$("[data-cmp-settings-message]")).getText()) === "Saved.", { timeout: 15000, timeoutMsg: "settings should save" });
}
