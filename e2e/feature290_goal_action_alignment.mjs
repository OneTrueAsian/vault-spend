// Real equal-height goal rows must align their contribution actions despite
// different metadata/projection lengths. Linked goals keep no manual action.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
deadline = (today + datetime.timedelta(days=180)).isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Household savings for planned purchases and annual expenses', 'savings', '1000.00')")
account = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Household member with a longer display name')")
member = cur.lastrowid
cur.execute("INSERT INTO buckets (name) VALUES ('Someday')")
cur.execute("INSERT INTO buckets (name,target_amount,target_date,account_id,member_id,sinking_amount) VALUES ('Travel fund','2000.00',?,?,?,'25.00')", (deadline,account,member))
travel = cur.lastrowid
cur.execute("INSERT INTO bucket_contributions (bucket_id,date,amount) VALUES (?,?,?)", (travel,today.isoformat(),'200.00'))
cur.execute("INSERT INTO buckets (name,target_amount) VALUES ('Annual bill','500.00')")
cur.execute("INSERT INTO buckets (name,target_amount,account_id,tracks_account) VALUES ('Account reserve','5000.00',?,1)", (account,))
`);
const output = process.env.VAULTSPEND_GOAL_UI_OUTPUT;
const observations = [];
let comparedRows = 0;
const app = await launchApp({ dbDir });
const b = app.browser;
async function settled() {
  await b.executeAsync(done => document.fonts.ready.then(async () => {
    await Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished));
    requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
  }));
}
try {
  await b.$('button[aria-label="Goals"]').click();
  await b.$(".bucket-card").waitForExist({ timeout: 10000 });
  for (const width of [1280, 960, 800, 720]) {
    await b.setWindowSize(width, width === 720 ? 600 : 900);
    for (const palette of ["transparent", "retro", "futuristic"]) {
      for (const theme of ["light", "dark"]) {
        await b.execute((p, t) => {
          document.documentElement.dataset.palette = p;
          document.documentElement.dataset.theme = t;
        }, palette, theme);
        await settled();
        const metrics = await b.execute(() => {
          const rect = e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
          return [...document.querySelectorAll(".buckets-view .bucket-card")].map(card => ({
            name: card.querySelector("h2").textContent.trim(),
            card: rect(card),
            action: card.querySelector(".bucket-contribute button") ? rect(card.querySelector(".bucket-contribute button")) : null,
            scrollWidth: card.scrollWidth, clientWidth: card.clientWidth,
          }));
        });
        observations.push({ width, palette, theme, cards: metrics });
        if (output) {
          fs.mkdirSync(output, { recursive: true });
          fs.writeFileSync(path.join(output, "geometry.json"), JSON.stringify(observations, null, 2));
          await b.saveScreenshot(path.join(output, `${width}-${palette}-${theme}.png`));
        }
        assert.equal(metrics.find(c => c.name === "Account reserve").action, null, "tracking goal has no manual contribution control");
        for (const c of metrics) {
          assert.ok(c.scrollWidth <= c.clientWidth + 1, `${width}/${palette}/${theme}/${c.name}: no horizontal clipping`);
          if (c.action) assert.ok(c.action.bottom <= c.card.bottom && c.action.left >= c.card.left && c.action.right <= c.card.right, "action stays inside its card");
        }
        for (let i = 0; i < metrics.length; i++) for (let j = i + 1; j < metrics.length; j++) {
          const a = metrics[i], c = metrics[j];
          if (a.action && c.action && Math.abs(a.card.top - c.card.top) <= 2 && Math.abs(a.card.height - c.card.height) <= 2) {
            comparedRows++;
            assert.ok(Math.abs(a.action.top - c.action.top) <= 2, `${width}/${palette}/${theme}: ${a.name} and ${c.name} action tops differ by ${Math.abs(a.action.top - c.action.top)}px`);
          }
        }
        const add = await b.$(".bucket-card .bucket-contribute button");
        await add.scrollIntoView({ block: "center" });
        await add.click();
        await b.$(".bucket-contribute-panel").waitForDisplayed({ timeout: 5000 });
        const popover = await b.execute(() => {
          const r = document.querySelector(".bucket-contribute-panel").getBoundingClientRect();
          const anchor = document.querySelector(".bucket-contribute button").getBoundingClientRect();
          const main = document.querySelector(".main");
          return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, anchorTop:anchor.top, width:innerWidth, height:innerHeight, pageOverflow:main.scrollWidth-main.clientWidth };
        });
        observations.at(-1).popover = popover;
        if (output) {
          fs.writeFileSync(path.join(output, "geometry.json"), JSON.stringify(observations, null, 2));
          if ((width === 1280 || width === 720) && theme === "light") await b.saveScreenshot(path.join(output, `${width}-${palette}-${theme}-popover.png`));
        }
        assert.ok(popover.bottom <= popover.anchorTop + 1, "contribution popover still opens upward");
        assert.ok(popover.left >= 0 && popover.right <= popover.width + 1 && popover.top >= 0 && popover.bottom <= popover.height + 1, "popover fits the viewport");
        assert.ok(popover.pageOverflow <= 1, `${width}/${palette}/${theme}: popover must not create horizontal page scrolling (${popover.pageOverflow}px)`);
        await (await b.$(".bucket-contribute-panel")).$("button=Cancel").click();
      }
    }
  }
  assert.ok(comparedRows > 0, "fixture exercises actual equal-height contributable rows");
  await b.$(".buckets-grid button.add-tile").click();
  await b.$(".buckets-grid > .bucket-new-form").waitForDisplayed({ timeout: 5000 });
  const formFits = await b.execute(() => [...document.querySelectorAll(".buckets-grid > .bucket-new-form input, .buckets-grid > .bucket-new-form button")].every(e => { const r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1; }));
  assert.ok(formFits, "new-goal controls fit the 720x600 window horizontally");
  if (output) await b.saveScreenshot(path.join(output, "720-new-goal-form.png"));
  console.log(`FEATURE 290 PASSED: 24 theme/width states, ${comparedRows} equal-row comparisons, upward popovers, linked semantics and narrow form`);
} finally {
  await app.close();
}
