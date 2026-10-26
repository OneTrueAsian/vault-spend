// Compiled dialog: six palette/mode combinations, narrow geometry, keyboard and WCAG checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launchApp, reclaimWindowFocus } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
const output = process.env.VS_HOLDING_SHOTS || makeTempDir("holding-import-shots-");
fs.mkdirSync(output, { recursive: true });
const dbDir = await seedFixture(`cur.execute("INSERT INTO accounts (name,account_type,starting_balance) VALUES ('Retirement','investment','1000')")`);
const app = await launchApp({ dbDir });
const b = app.browser;
async function click(text) { await (await (await b.$("[role='dialog']")).$(`button=${text}`)).click(); }
async function axe() {
  const violations = await b.executeAsync(done => window.axe.run(document.querySelector('[role="dialog"]'), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }).then(r => done(r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))));
  assert.deepEqual(violations, []);
}
async function geometry() {
  const bounds = await b.execute(() => {
    const panel = document.querySelector('[role="dialog"]').getBoundingClientRect();
    const footer = document.querySelector('.modal-footer').getBoundingClientRect();
    return { fits: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight, footer: footer.bottom <= innerHeight, native: !!document.querySelector('[data-holding-import] select, [data-holding-import] input[type=file]') };
  });
  assert.equal(bounds.fits, true); assert.equal(bounds.footer, true); assert.equal(bounds.native, false);
}
try {
  await (await b.$("button*=Investments")).click();
  await (await b.$("button*=Import holdings")).waitForExist({ timeout: 10000 });
  await (await b.$("button*=Import holdings")).click();
  await b.execute(fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8"));
  await axe(); await geometry();
  await click("Browse files…"); await b.$("[data-holding-file-browser]").waitForExist({ timeout: 5000 });
  await axe(); await b.saveScreenshot(path.join(output, "file-browser.png"));
  await click("Close file browser"); await click("Paste rows");
  await b.$("[data-holding-import] textarea").setValue("Symbol,Name,Shares,Price,Cost Basis,Asset Class\nVTI,Total market fund,10.5,250.00,2400.00,Stocks\nBND,Bond fund,20,75.00,1400.00,Bonds\nBAD,Missing cost,2,100,,Stocks\n");
  await click("Match columns");
  await (await (await b.$("[role='dialog']")).$("button=Review holdings")).waitForEnabled({ timeout: 5000 });
  await axe(); await b.saveScreenshot(path.join(output, "column-matching.png")); await click("Review holdings");
  await b.$("[data-holding-import-row]").waitForExist({ timeout: 5000 });
  const original = await b.execute(() => ({ palette: document.documentElement.dataset.palette, theme: document.documentElement.dataset.theme }));
  for (const palette of ["transparent", "futuristic", "retro"]) for (const theme of ["light", "dark"]) {
    await b.execute((palette, theme) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = theme; }, palette, theme);
    await b.executeAsync(done => document.fonts.ready.then(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))).then(() => requestAnimationFrame(() => done(true))));
    console.log("Checking", palette, theme);
    await geometry(); await b.saveScreenshot(path.join(output, `review-${palette}-${theme}.png`)); await axe();
  }
  await b.setWindowSize(800, 600); await geometry(); await axe(); await b.saveScreenshot(path.join(output, "review-narrow.png"));
  await reclaimWindowFocus(b);
  await b.$("[aria-label='Include row 2']").click();
  await b.keys("Tab");
  assert.equal(await b.execute(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true);
  await b.keys("Escape"); await b.$("[data-holding-import]").waitForExist({ reverse: true, timeout: 5000 });
  await b.execute(original => { document.documentElement.dataset.palette = original.palette; document.documentElement.dataset.theme = original.theme; }, original);
  console.log("PASS import styling: six theme variants, source/browser/mapping/review Axe, narrow pinned footer, keyboard focus and Escape");
} finally { await app.close(); }
