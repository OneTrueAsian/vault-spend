// E2E test for 1.2.8 — Settings' Categorization rules stays usable as the list grows.
//
// Every merchant correction adds a rule, so the list only grows; it used to be one long table that
// made the whole Settings page longer and could only be searched by text. Now, with 80 rules:
//   - the list scrolls inside its own region (bounded height) instead of lengthening the page;
//   - the column headings stay in view while the list scrolls;
//   - the region can be reached and scrolled from the keyboard;
//   - the columns sort (aria-sort says which way) and a category dropdown narrows the list;
//   - nothing runs off the side at half-window width.
//
// Run with: node e2e/feature98_rules_list_scroll.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cats = ["Groceries", "Dining Out", "Shopping", "Utilities", "Transportation"]
for i in range(80):
    cur.execute("INSERT INTO rules (pattern, category) VALUES (?, ?)", (f"merchant {i + 1:02d}", cats[i % 5]))
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const rowCategories = () =>
  browser.execute(() => [...document.querySelectorAll("#categorization-rules tbody tr")].map((tr) => tr.children[1]?.textContent ?? ""));
const rowPatterns = () =>
  browser.execute(() => [...document.querySelectorAll("#categorization-rules tbody tr")].map((tr) => tr.children[0]?.textContent ?? ""));

try {
  await browser.setWindowSize(1440, 1000);
  await nav("Settings");
  const card = await browser.$("#categorization-rules");
  await card.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await rowPatterns()).length === 80, { timeout: 10000, timeoutMsg: "all 80 rules should be listed" });
  await card.scrollIntoView();

  // 1. The list scrolls inside a bounded region; the card doesn't grow with the rules.
  const region = await card.$("[data-rules-scroll]");
  const metrics = await browser.execute(() => {
    const r = document.querySelector("#categorization-rules [data-rules-scroll]");
    const c = document.querySelector("#categorization-rules");
    return { client: r.clientHeight, scroll: r.scrollHeight, card: c.getBoundingClientRect().height };
  });
  console.log("region:", JSON.stringify(metrics));
  if (metrics.client > 445) throw new Error(`the rules region should stay compact, it is ${metrics.client}px tall`);
  if (metrics.scroll <= metrics.client) throw new Error("80 rules should scroll inside their region");
  if (metrics.card > 740) throw new Error(`the card should not grow with the list, it is ${metrics.card}px tall`);

  // 2. Headings stay in view while scrolled to the bottom.
  await browser.execute(() => {
    const r = document.querySelector("#categorization-rules [data-rules-scroll]");
    r.scrollTop = r.scrollHeight;
  });
  const headingOffset = await browser.execute(() => {
    const r = document.querySelector("#categorization-rules [data-rules-scroll]");
    const th = document.querySelector("#categorization-rules thead th");
    return th.getBoundingClientRect().top - r.getBoundingClientRect().top;
  });
  if (headingOffset < -1 || headingOffset > 3) throw new Error(`the headings should stay pinned to the top of the region, offset ${headingOffset}px`);

  // 3. The region is reachable and scrollable from the keyboard.
  await browser.execute(() => {
    const r = document.querySelector("#categorization-rules [data-rules-scroll]");
    r.scrollTop = 0;
    r.focus();
  });
  if (!(await browser.execute(() => document.activeElement?.hasAttribute("data-rules-scroll")))) throw new Error("the rules region should take keyboard focus");
  await browser.keys(["PageDown"]);
  await browser.waitUntil(async () => (await browser.execute(() => document.querySelector("#categorization-rules [data-rules-scroll]").scrollTop)) > 0, {
    timeout: 5000,
    timeoutMsg: "Page Down should scroll the focused rules region",
  });

  // 4. Sorting: the default is by text; the Category heading sorts and flips.
  let sortedTh = await browser.execute(() => document.querySelector("#categorization-rules th[aria-sort]")?.textContent ?? "");
  if (!sortedTh.includes("When the description contains")) throw new Error(`the list should start sorted by its text, got "${sortedTh}"`);
  const categoryHeading = await card.$("//th[contains(.,'Category')]//button");
  await categoryHeading.click();
  let cats = await rowCategories();
  if (cats[0] !== "Dining Out" || cats[cats.length - 1] !== "Utilities") throw new Error(`sorted by category ascending, expected Dining Out first and Utilities last, got ${cats[0]} … ${cats[cats.length - 1]}`);
  if ((await card.$("//th[contains(.,'Category')]").getAttribute("aria-sort")) !== "ascending") throw new Error("aria-sort should say ascending");
  await categoryHeading.click();
  cats = await rowCategories();
  if (cats[0] !== "Utilities") throw new Error(`sorted by category descending, expected Utilities first, got ${cats[0]}`);
  if ((await card.$("//th[contains(.,'Category')]").getAttribute("aria-sort")) !== "descending") throw new Error("aria-sort should say descending");

  // 5. The category dropdown narrows the list and says how much is showing.
  const filter = await card.$("select[data-rules-category-filter]");
  await filter.selectByVisibleText("Shopping");
  await browser.waitUntil(async () => (await rowPatterns()).length === 16, { timeout: 5000, timeoutMsg: "16 of the 80 rules use Shopping" });
  if (!(await rowCategories()).every((c) => c === "Shopping")) throw new Error("only Shopping rules should be listed");
  const status = await card.$(".rules-count").getText();
  if (status !== "Showing 16 of 80 rules") throw new Error(`expected "Showing 16 of 80 rules", got "${status}"`);
  await filter.selectByVisibleText("All categories");
  await browser.waitUntil(async () => (await rowPatterns()).length === 80, { timeout: 5000 });

  // 6. Half-window: nothing runs off the side.
  await browser.setWindowSize(960, 900);
  await card.scrollIntoView();
  const overflow = await browser.execute(() => {
    const r = document.querySelector("#categorization-rules [data-rules-scroll]");
    const c = document.querySelector("#categorization-rules");
    return { region: r.scrollWidth - r.clientWidth, card: c.scrollWidth - c.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  console.log("overflow at 960px:", JSON.stringify(overflow));
  if (overflow.region > 1 || overflow.card > 1 || overflow.page > 1) throw new Error(`the rules list should fit a half-width window, overflow: ${JSON.stringify(overflow)}`);

  console.log("FEATURE 98 E2E TEST PASSED");
} finally {
  await app.close();
}
