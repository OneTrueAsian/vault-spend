import assert from "node:assert/strict";
import { dismissStatusMessages, launchApp } from "./harness.mjs";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

// Bug (21 October 2026): scrolling past the end of Reports or Investments scrolled the whole app window up and left an empty band under it. The window must never scroll:
// only the page (`.main`) and the frames inside it do, and the page must end where its content ends. Checked in every style, because Futuristic and Retro
// lay the page out differently from Default. Evidence: real mouse-wheel scrolling in the compiled app, measured on the window, the shell and the page.
const STYLES = ["transparent", "futuristic", "retro"];
const VIEWS = ["Dashboard", "Transactions", "Investments", "Household", "Reports", "Settings"];
const SLACK = 24; // the page's own bottom padding (64px) is inside .page; the Default style adds a 14px shell inset

const dbDir = freshTestDbDir();
await seedDemoDatabase(dbDir);
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await browser.setWindowSize(1280, 700);
  const failures = [];
  for (const style of STYLES) {
    await browser.execute((s) => {
      localStorage.setItem("meadow-theme-style", s);
      localStorage.setItem("meadow-theme", "light");
      localStorage.setItem("meadow-reduce-motion", "on");
      location.reload();
    }, style);
    await (await browser.$(".nav-item")).waitForExist({ timeout: 20000 });
    await browser.waitUntil(() => browser.execute((s) => document.documentElement.dataset.palette === s, style), { timeout: 5000 });
    for (const view of VIEWS) {
      await dismissStatusMessages(browser);
      await browser.execute((v) => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === v).click(), view);
      await browser.waitUntil(() => browser.execute((v) => document.querySelector(".view-title")?.textContent.trim().toLowerCase() === v.toLowerCase(), view), { timeout: 10000, timeoutMsg: `${view} never showed` });
      await browser.pause(700); // charts and lazy sections settle
      const label = `${style} ${view}`;
      const before = await browser.execute(() => {
        const doc = document.scrollingElement;
        return { windowCanScroll: doc.scrollHeight > doc.clientHeight + 1, viewport: window.innerHeight };
      });
      if (before.windowCanScroll) failures.push(`${label}: the window itself is scrollable (a hidden element lengthens it)`);
      // Real wheel scrolling from beside the page, well past its end, then the same over the page.
      for (const x of [330, 700]) for (let i = 0; i < 12; i++) await browser.action("wheel").scroll({ x, y: 400, deltaX: 0, deltaY: 4000, origin: "viewport" }).perform();
      await browser.pause(250);
      const after = await browser.execute(() => {
        const main = document.querySelector(".main"), page = main.querySelector(".page"), doc = document.scrollingElement;
        const shell = document.querySelector(".app-shell").getBoundingClientRect(), m = main.getBoundingClientRect(), p = page.getBoundingClientRect();
        return { windowTop: Math.round(doc.scrollTop), shellBottom: Math.round(shell.bottom), viewport: window.innerHeight,
          gapBelowPage: Math.round(m.bottom - p.bottom), pageTallerThanView: p.height > m.height, mainTop: Math.round(main.scrollTop), mainMax: main.scrollHeight - main.clientHeight };
      });
      if (after.windowTop !== 0) failures.push(`${label}: the window scrolled by ${after.windowTop}px`);
      if (after.shellBottom !== after.viewport) failures.push(`${label}: the app ends at ${after.shellBottom}px, not at the window's bottom (${after.viewport}px)`);
      if (after.pageTallerThanView && after.gapBelowPage > SLACK) failures.push(`${label}: at the end of the page ${after.gapBelowPage}px of empty space shows under it`);
      await browser.execute(() => { document.scrollingElement.scrollTo(0, 0); document.querySelector(".main").scrollTo(0, 0); });
    }
  }
  assert.deepEqual(failures, [], `page scrolling escaped the page:\n${failures.join("\n")}`);
  console.log("FEATURE 311 E2E TEST PASSED");
} finally {
  await app.close();
}
