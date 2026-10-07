// Task 11: a friendlier empty Goals page, as in the UI mockup (UAT s9.1). In a profile with no goals,
// Goals shows one centred card with a target icon, "Save toward something", "Create a goal" and three
// starting points (name over a description), in every style and width; a starting point fills in the
// new goal's name, and saving it creates that goal and brings back the usual goal grid.
// UAT s9.2: with a linked account, "Progress follows this account's balance" is a normal-sized
// checkbox beside its label, not a field-sized box.
//
// Run with: npm run e2e -- --spec=275
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, chooseStyle, chooseMenuOption, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const shots = process.env.VS_T11_SHOTS ?? makeTempDir("vault-task11-shots-");
fs.mkdirSync(shots, { recursive: true });

// One account and no goals, so the new-goal form can link an account (s9.2).
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Rainy Day Savings', 'savings', '2500.00')")
`);
const app = await launchApp({ dbDir });
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
              const texts = [...block.querySelectorAll("button")].map((x) => x.querySelector("b")?.textContent.trim() ?? x.textContent.trim());
              const looksRight =
                !!block.querySelector(".goals-empty-icon svg") &&
                block.querySelector("h2")?.textContent === "Save toward something" &&
                block.textContent.includes("Or start from one of these:") &&
                block.querySelectorAll(".goals-empty-starter span").length === 3;
              const buttonsInside = [...block.querySelectorAll("button")].every((x) => {
                const r = x.getBoundingClientRect();
                return r.left >= b.left - 1 && r.right <= b.right + 1;
              });
              return (
                centred &&
                buttonsInside &&
                looksRight &&
                ["Create a goal", "Emergency fund", "Holiday", "Once-a-year bill"].every((t) => texts.includes(t)) &&
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

  // A starting point fills in the name; saving creates that goal and brings back the goal grid.
  await (await browser.$(".goals-empty-starter*=Emergency fund")).click();
  const nameInput = await browser.$(".goals-empty .bucket-new-form input");
  await nameInput.waitForExist({ timeout: 5000 });
  await waitUntilOrDiagnose(browser, async () => (await nameInput.getValue()) === "Emergency fund", {
    timeoutMsg: "clicking Emergency fund should fill in the new goal's name",
  });
  await browser.saveScreenshot(path.join(shots, "retro-dark-goals-form.png"));

  // s9.2: linking an account shows the follow-balance checkbox at a checkbox's size, beside its label.
  await chooseMenuOption(await browser.$('.bucket-new-form button[aria-label^="Linked account"]'), { label: "Rainy Day Savings" });
  let toggle = null;
  await waitUntilOrDiagnose(
    browser,
    async () =>
      (toggle = await browser.execute(() => {
        const label = document.querySelector(".bucket-track-toggle");
        const box = label?.querySelector("input[type=checkbox]");
        if (!label || !box) return null;
        const b = box.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(label.lastChild);
        const text = range.getBoundingClientRect();
        return { width: b.width, height: b.height, gap: text.left - b.right, sameLine: Math.abs((b.top + b.bottom) / 2 - (text.top + text.bottom) / 2) <= 4 };
      })) !== null,
    { timeoutMsg: "linking an account should show the Progress follows this account's balance checkbox", extra: () => toggle },
  );
  await browser.saveScreenshot(path.join(shots, "retro-dark-goals-form-linked.png"));
  if (toggle.width > 24 || toggle.height > 24 || toggle.gap < 0 || toggle.gap > 16 || !toggle.sameLine) {
    throw new Error(`the follow-balance checkbox should be checkbox-sized and sit just before its label: ${JSON.stringify(toggle)}`);
  }
  console.log(`follow-balance checkbox ${toggle.width}x${toggle.height}px, ${toggle.gap.toFixed(1)}px before its label`);
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
