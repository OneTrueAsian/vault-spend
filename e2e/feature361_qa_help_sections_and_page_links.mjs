// UAT-213 every Help section opens and has real content, UAT-216 the ? beside each page's title opens that page's own Help section (HelpLink.tsx; HelpView.tsx "Help for each page"),
// The wording's accuracy (UAT-218) and the "deliberate limits" statements (UAT-219) are reading tasks and are not claimed here (Help contains no hyperlinks to test).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QQ Checking', 'checking', '1000.00')")
`);
const app = await launchApp({ dbDir });
const { browser: b } = app;
const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
const PAGES = [["dashboard", "Dashboard"], ["accounts", "Accounts"], ["ledger", "Transactions"], ["recurring", "Recurring"], ["budget", "Budget"], ["buckets", "Goals"], ["cashflow", "Cash Flow"], ["investments", "Investments"], ["household", "Household"], ["reports", "Reports"]];
try {
  await b.setWindowSize(1440, 1200);
  // --- UAT-216: the ? on each page lands on that page's section -----------------------------------------------------------------------------------------------
  for (const [id, label] of PAGES) {
    await nav(label);
    const help = await b.$(`button[aria-label="Help for ${label}"]`);
    await help.waitForExist({ timeout: 10000, timeoutMsg: `${label} has a ? button named "Help for ${label}"` });
    await help.click();
    await b.$(".help-view, .help-search").waitForExist({ timeout: 10000 });
    await waitUntilOrDiagnose(b, async () => await b.execute(i => document.getElementById(`help-${i}`)?.open === true, id), { timeout: 8000, timeoutMsg: `${label}'s own section is open`, extra: () => b.execute(() => [...document.querySelectorAll("details.help-tab[open]")].map(d => d.id)) });
    const state = await b.execute(i => {
      const el = document.getElementById(`help-${i}`);
      const r = el.getBoundingClientRect();
      return { title: el.querySelector("summary").textContent.trim(), inView: r.top < innerHeight && r.bottom > 0, body: el.querySelector(".help-tab-body").innerText.trim().length, howTos: el.querySelectorAll(".help-howto").length };
    }, id);
    assert.ok(state.title.toLowerCase().includes(label.toLowerCase().split(" ")[0]), `the section for ${label} is titled for it: ${state.title}`);
    assert.ok(state.inView, `${label}'s section is scrolled into view`);
    assert.ok(state.body > 80, `${label}'s section has real content (${state.body} characters)`);
  }

  // --- UAT-213: every section opens and reads as finished text ---------------------------------------------------------------------------------------------------
  await nav("Help");
  await b.$(".help-search").waitForExist({ timeout: 10000 });
  // Open the actual summaries through pointer gestures; setting .open would bypass React's user path.
  const summaries = "details.help-topic > summary, details.help-tab > summary, details.help-faq-entry > summary";
  const titles = await b.execute(sel => [...document.querySelectorAll(sel)].map(el => el.textContent.trim()), summaries);
  let opened = 0;
  for (let i = 0; i < titles.length; i++) {
    const isOpen = () => b.execute((sel, index) => document.querySelectorAll(sel)[index].parentElement.open, summaries, i);
    if (!(await isOpen())) { await (await b.$$(summaries))[i].click(); opened++; }
    await waitUntilOrDiagnose(b, isOpen, { timeout: 5000, timeoutMsg: `Help summary opens its content: ${titles[i]}` });
  }
  const sections = await b.execute(() => [...document.querySelectorAll("details.help-topic, details.help-tab")].map(d => ({ title: d.querySelector("summary")?.textContent.trim() ?? "", chars: (d.innerText ?? "").trim().length })));
  assert.ok(sections.length >= 12, "Help has its topic and page sections: " + sections.length + " (" + opened + " were closed)");
  for (const s of sections) assert.ok(s.title && s.chars > 60, `section "${s.title}" has a title and content (${s.chars})`);
  const text = await b.execute(() => document.querySelector(".help-view")?.innerText ?? document.body.innerText);
  for (const bad of [/undefined/, /\[object /, /TODO/, /lorem ipsum/i, /\{\{/, /NaN/]) assert.ok(!bad.test(text), `Help text contains no ${bad}`);

  console.log("FEATURE 361 PASSED: the ? on each of the ten pages opens its own section; every Help section has content and no placeholder text.");
} finally { await app.close(); }
