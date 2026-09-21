// E2E test for Phase 4 item 19 (investment accumulation + projection), part 5:
// the Help tab describes the new section (19.16).
//
//   - searching for the feature by name finds its tour bullet (under "Investments")
//     and its FAQ entry, and nothing unrelated;
//   - the words a person would actually type ("roth", "529", "inflation", "withdraw")
//     reach the same FAQ entry;
//   - the FAQ answer covers what the section shows and lets you set: cash invested,
//     worth now and growth, the monthly amount and its default, the return, the
//     withdraw month, spreading withdrawals over years, and today's dollars.
//
// Run with: node e2e/feature96_accumulation_help.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture("");
const app = await launchApp({ dbDir });
const { browser } = app;
const fail = (message) => {
  throw new Error(message);
};

try {
  await (await browser.$("button*=Help")).click();
  const search = await browser.$(".help-search");
  await search.waitForExist({ timeout: 10000 });
  const helpPage = await browser.$(".help-view");

  // Select-all + Backspace is what clears a controlled input in this WebView
  // (see feature26_help_search.mjs); typing then replaces the old query.
  async function searchFor(term) {
    await search.click();
    await browser.keys(["Control", "a"]);
    await browser.keys("Backspace");
    await browser.keys(term);
  }
  const faqEntries = () => browser.execute(() => [...document.querySelectorAll(".help-faq-entry")].map((e) => e.innerText));
  const tourText = () => browser.execute(() => document.querySelector(".tour-list")?.innerText ?? "");
  const accumulationEntry = async () => (await faqEntries()).find((t) => /accumulation/i.test(t.split("\n")[0]));

  // ---- the feature's own name -------------------------------------------------------------
  await searchFor("accumulation");
  await browser.waitUntil(async () => (await accumulationEntry()) !== undefined, {
    timeout: 10000,
    timeoutMsg: 'searching "accumulation" should show an FAQ entry about the accumulation & projection section',
  });
  const page = await helpPage.getText();
  if (page.includes("Getting started") || page.includes("Is my data private?")) fail(`"accumulation" should narrow the page to the matching items, got:\n${page}`);
  const tour = await tourText();
  if (!/Investments/.test(tour) || !/Accumulation & projection/.test(tour)) {
    fail(`the tour of the tabs should describe the Investments tab's "Accumulation & projection" card, got:\n${tour}`);
  }
  console.log("searching by the feature's name finds its tour bullet and FAQ entry");

  // ---- the answer says what the section does ---------------------------------------------------
  const answer = (await accumulationEntry()).toLowerCase();
  const mentions = {
    "cash invested": "cash invested",
    "worth now": "worth now",
    growth: "growth",
    "the monthly amount": "monthly",
    "its default (average of the last 6 months)": "6 complete months",
    "the annual return": "return",
    "the withdraw month": "withdraw month",
    "spreading withdrawals over years": "spread",
    "today's dollars": "today's dollars",
    inflation: "inflation",
    "an estimate rather than a promise": "estimate",
  };
  const missing = Object.entries(mentions).filter(([, needle]) => !answer.includes(needle)).map(([label]) => label);
  if (missing.length) fail(`the FAQ answer should explain: ${missing.join("; ")}\n\nGot:\n${answer}`);
  console.log("the FAQ answer covers the numbers, the plan settings and the caveat");

  // Its paragraphs are set apart, not run together as one dense block.
  const gap = await browser.execute(() => {
    const entry = [...document.querySelectorAll(".help-faq-entry")].find((e) => /accumulation/i.test(e.querySelector("h3")?.textContent ?? ""));
    const paragraphs = [...entry.querySelectorAll("p")];
    return { count: paragraphs.length, marginTop: paragraphs.length > 1 ? parseFloat(getComputedStyle(paragraphs[1]).marginTop) : 0 };
  });
  if (gap.count < 2 || !(gap.marginTop > 0)) fail(`the FAQ entry's paragraphs should be spaced apart, got ${JSON.stringify(gap)}`);

  // ---- the words people actually type ---------------------------------------------------------
  for (const term of ["roth", "529", "inflation", "withdraw"]) {
    await searchFor(term);
    await browser.waitUntil(async () => (await accumulationEntry()) !== undefined, {
      timeout: 10000,
      timeoutMsg: `searching "${term}" should reach the accumulation & projection FAQ entry`,
    });
  }
  console.log('"roth", "529", "inflation" and "withdraw" all reach the FAQ entry');

  console.log("FEATURE 96 E2E TEST PASSED");
} finally {
  await app.close();
}
