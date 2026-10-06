// Task 15: Help in short pieces. Every page has a ? beside its title that opens Help at that page's
// own section, open and in view; searching opens the matching sections. Screenshots of Help and of a
// title row in every style, for a person to look at.
//
// Run with: npm run e2e -- --spec=277
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, chooseStyle, reclaimWindowFocus, waitUntilOrDiagnose } from "./harness.mjs";

const shots = process.env.VS_T15_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "vault-task15-shots-"));
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
