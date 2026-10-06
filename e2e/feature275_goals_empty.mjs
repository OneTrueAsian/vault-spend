// Task 11: a friendlier empty Goals page. In a fresh profile, Goals shows one centred block with
// "Create a goal" and three example names, in every style and width; an example fills in the new
// goal's name, and saving it creates that goal and brings back the usual goal grid.
//
// Run with: npm run e2e -- --spec=275
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, chooseStyle, waitUntilOrDiagnose } from "./harness.mjs";

const shots = process.env.VS_T11_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "vault-task11-shots-"));
fs.mkdirSync(shots, { recursive: true });

const app = await launchApp();
const browser = app.browser;

async function openGoals() {
  await (await browser.$(".nav-item[data-tab=buckets]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => !!document.querySelector(".goals-empty")), {
    timeoutMsg: "a fresh profile's Goals page should show the empty block",
  });
}

try {
  for (const [name, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await browser.setWindowSize(1280, 800);
    await chooseStyle(browser, name, palette);
    for (const theme of ["Light", "Dark"]) {
      await browser.execute((t) => [...document.querySelectorAll(".theme-toggle button")].find((b) => b.textContent === t).click(), theme);
      await openGoals();
      for (const width of [1440, 1280, 800]) {
        await browser.setWindowSize(width, 800);
        await waitUntilOrDiagnose(browser, () => browser.execute((w) => innerWidth <= w && innerWidth >= w - 40, width), {
          timeoutMsg: `the ${width}px window size should apply`,
        });
        await waitUntilOrDiagnose(
          browser,
          () =>
            browser.execute(() => {
              const block = document.querySelector(".goals-empty");
              const page = document.querySelector(".page");
              if (!block || !page) return false;
              const b = block.getBoundingClientRect();
              const p = page.getBoundingClientRect();
              const centred = Math.abs(b.left + b.width / 2 - (p.left + p.width / 2)) <= 40;
              const texts = [...block.querySelectorAll("button")].map((x) => x.textContent.trim());
              const buttonsInside = [...block.querySelectorAll("button")].every((x) => {
                const r = x.getBoundingClientRect();
                return r.left >= b.left - 1 && r.right <= b.right + 1;
              });
              return (
                centred &&
                buttonsInside &&
                ["Create a goal", "Emergency fund", "Holiday", "New car"].every((t) => texts.includes(t)) &&
                !document.querySelector(".add-tile") &&
                document.documentElement.scrollWidth <= innerWidth + 1
              );
            }),
          { timeoutMsg: `${palette}/${theme}/${width}: the empty block is centred, complete and fits without sideways scroll` },
        );
      }
      await browser.setWindowSize(1280, 800);
      await browser.saveScreenshot(path.join(shots, `${palette}-${theme.toLowerCase()}-goals-empty.png`));
    }
  }

  // An example fills in the name; saving creates that goal and brings back the goal grid.
  await (await browser.$("button=Emergency fund")).click();
  const nameInput = await browser.$(".goals-empty .bucket-new-form input");
  await nameInput.waitForExist({ timeout: 5000 });
  await waitUntilOrDiagnose(browser, async () => (await nameInput.getValue()) === "Emergency fund", {
    timeoutMsg: "clicking Emergency fund should fill in the new goal's name",
  });
  await browser.saveScreenshot(path.join(shots, "retro-dark-goals-form.png"));
  await (await (await browser.$(".bucket-new-form")).$("button=Create")).click();
  await waitUntilOrDiagnose(
    browser,
    () =>
      browser.execute(() => {
        const names = [...document.querySelectorAll(".bucket-card h2")].map((h) => h.textContent.trim());
        return names.length === 1 && names[0] === "Emergency fund" && !document.querySelector(".goals-empty") && !!document.querySelector(".add-tile");
      }),
    { timeoutMsg: "saving should create one goal named Emergency fund, hide the empty block and bring back the New goal tile" },
  );
  console.log(`feature275: empty Goals page OK; screenshots in ${shots}`);
} finally {
  await app.close();
}
