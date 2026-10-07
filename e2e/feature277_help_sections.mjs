// Task 15: Help in short pieces. Every page has a ? beside its title that opens Help at that page's
// own section, open and in view; searching opens the matching sections. The other topics and each
// FAQ question fold too, closed to start and each on its own. Screenshots of Help and of a
// title row in every style, for a person to look at.
//
// Run with: npm run e2e -- --spec=277
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, chooseStyle, reclaimWindowFocus, waitUntilOrDiagnose } from "./harness.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const shots = process.env.VS_T15_SHOTS ?? makeTempDir("vault-task15-shots-");
fs.mkdirSync(shots, { recursive: true });

const PAGES = [
  ["dashboard", "Dashboard"],
  ["accounts", "Accounts"],
  ["ledger", "Transactions"],
  ["recurring", "Recurring"],
  ["budget", "Budget"],
  ["buckets", "Goals"],
  ["cashflow", "Cash Flow"],
  ["investments", "Investments"],
  ["household", "Household"],
  ["reports", "Reports"],
  ["settings", "Settings"],
];

const app = await launchApp();
const browser = app.browser;

async function goTo(tab) {
  await (await browser.$(`.nav-item[data-tab=${tab}]`)).click();
}

try {
  await browser.setWindowSize(1280, 900);

  // Every page's title has its own ? link, named after the page.
  for (const [tab, name] of PAGES) {
    await goTo(tab);
    await waitUntilOrDiagnose(
      browser,
      () =>
        browser.execute(
          (name) => {
            const link = document.querySelector(`.view-title-row button.help-link[aria-label="Help for ${name}"]`);
            return !!link && link.textContent.trim() === "?" && link.closest(".view-title-row").querySelector(".view-title")?.textContent.trim() === name;
          },
          name,
        ),
      { timeoutMsg: `${name} should show a ? Help link beside its title` },
    );
  }
  console.log("every page has a ? beside its title");

  // Budget's ? opens Help at the Budget section, open and in view; the others stay closed.
  await goTo("budget");
  await (await browser.$('[aria-label="Help for Budget"]')).click();
  await waitUntilOrDiagnose(
    browser,
    () =>
      browser.execute(() => {
        const section = document.querySelector("details#help-budget");
        if (!section?.open || document.querySelector(".view-title")?.textContent.trim() !== "Help") return false;
        const r = section.getBoundingClientRect();
        const others = [...document.querySelectorAll("details.help-tab")].filter((d) => d !== section && d.open);
        return r.top >= 0 && r.top < innerHeight && others.length === 0;
      }),
    { timeoutMsg: "the Budget ? should open Help with only the Budget section open, in view" },
  );
  await browser.saveScreenshot(path.join(shots, "help-budget-from-link.png"));
  console.log("Budget's ? opens Help at the Budget section");

  // Leaving Help and coming back from the sidebar starts with every section closed.
  await goTo("dashboard");
  await goTo("help");
  await waitUntilOrDiagnose(
    browser,
    () => browser.execute(() => document.querySelectorAll("details.help-tab").length === 11 && ![...document.querySelectorAll("details.help-tab")].some((d) => d.open)),
    { timeoutMsg: "opening Help from the sidebar should show every section closed" },
  );

  // The other topics and each FAQ question fold too (UAT s12.3), closed to start and each on its own.
  const foldState = () =>
    browser.execute(() => ({
      topics: [...document.querySelectorAll("details.help-topic")].map((d) => ({ title: d.querySelector("summary").textContent.trim(), open: d.open })),
      faqOpen: [...document.querySelectorAll("details.help-faq-entry")].map((d) => d.open),
    }));
  let folds = await foldState();
  if (folds.topics.length !== 4 || folds.topics.some((t) => t.open) || folds.faqOpen.length < 10 || folds.faqOpen.some(Boolean)) {
    throw new Error(`every topic and FAQ question should start closed: ${JSON.stringify(folds)}`);
  }
  const clickSummary = (selector, title) =>
    browser.execute((sel, t) => [...document.querySelectorAll(sel)].find((s) => t === null || s.textContent.trim() === t).click(), selector, title);
  await clickSummary("details.help-topic > summary", "Getting started");
  await clickSummary("details.help-faq-entry > summary", null);
  await waitUntilOrDiagnose(
    browser,
    async () => {
      folds = await foldState();
      return folds.topics[0].open && !folds.topics[1].open && folds.faqOpen[0] && !folds.faqOpen[1];
    },
    { timeoutMsg: "clicking Getting started and the first question should open just those two", extra: () => folds },
  );
  await browser.saveScreenshot(path.join(shots, "help-topics-folding.png"));
  await clickSummary("details.help-topic > summary", "Getting started");
  await waitUntilOrDiagnose(
    browser,
    async () => {
      folds = await foldState();
      return !folds.topics[0].open && folds.faqOpen[0];
    },
    { timeoutMsg: "closing Getting started should leave the open question open", extra: () => folds },
  );
  console.log("every topic and FAQ question folds on its own");

  // Searching opens the matching sections: "split" opens Transactions.
  await reclaimWindowFocus(browser);
  await (await browser.$(".help-search")).setValue("split");
  await waitUntilOrDiagnose(browser, () => browser.execute(() => !!document.querySelector("details#help-ledger[open]")), {
    timeoutMsg: 'searching "split" should open the Transactions section',
  });
  console.log('searching "split" opens the Transactions section');

  // Every style, for review: Help with one section open, and a page title with its ?.
  for (const [name, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(browser, name, palette);
    for (const theme of ["Light", "Dark"]) {
      await browser.execute((t) => [...document.querySelectorAll(".theme-toggle button")].find((b) => b.textContent === t).click(), theme);
      await goTo("budget");
      await (await browser.$('[aria-label="Help for Budget"]')).waitForExist({ timeout: 10000 });
      await browser.saveScreenshot(path.join(shots, `${palette}-${theme.toLowerCase()}-budget-title.png`));
      await (await browser.$('[aria-label="Help for Budget"]')).click();
      await waitUntilOrDiagnose(browser, () => browser.execute(() => !!document.querySelector("details#help-budget[open]")), {
        timeoutMsg: "the Budget section should open",
      });
      await browser.pause(300);
      await browser.saveScreenshot(path.join(shots, `${palette}-${theme.toLowerCase()}-help.png`));
    }
  }
  console.log(`FEATURE 277 E2E TEST PASSED; screenshots in ${shots}`);
} finally {
  await app.close();
}
