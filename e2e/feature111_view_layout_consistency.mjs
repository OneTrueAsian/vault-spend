import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";

const dbDir = freshTestDbDir();
await seedDemoDatabase(dbDir);
console.log("Layout fixture ready; launching app");
const app = await launchApp({ dbDir });
console.log("Layout app ready");
const b = app.browser;
async function nav(name) {
  for (const button of await b.$$("nav button")) {
    if ((await button.getText()).trim() === name) { await button.click(); break; }
  }
  await b.waitUntil(async () => await b.execute((name) => document.querySelector(".view-title")?.textContent === name, name), { timeout: 10000 });
}
try {
  const names = [];
  for (const button of await b.$$("nav button")) names.push((await button.getText()).trim());
  for (const width of [1280, 960, 800]) {
    await b.setWindowSize(width, 900);
    for (const name of names) {
      await nav(name);
      const overflow = await b.execute(() => {
        const main = document.querySelector(".main");
        return main.scrollWidth - main.clientWidth;
      });
      assert.ok(overflow <= 1, `${name} at ${width}px must not scroll the entire page horizontally (${overflow}px overflow)`);
    }
    console.log(`All views fit at ${width}px`);
  }
  await nav("Settings");
  await b.execute(() => { document.querySelector(".main").scrollTop = 450; });
  assert.ok(await b.execute(() => document.querySelector(".main").scrollTop > 0));
  await nav("Help");
  assert.equal(await b.execute(() => document.querySelector(".main").scrollTop), 0, "opening another view should start at its heading");
} finally { await app.close(); }
console.log("FEATURE 111 E2E TEST PASSED");
