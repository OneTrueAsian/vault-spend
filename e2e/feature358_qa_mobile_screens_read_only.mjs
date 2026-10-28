// UAT-225 the phone viewer's five screens are read-only views of the saved snapshot (MobileViewer.tsx: Overview, Accounts, Budget, Reports, Calculators, plus Settings).
// A real Edge session (the matched standalone driver, MSEDGEDRIVER) loads the production mobile assets through the loopback proxy of feature172, pairs with the compiled app, downloads the snapshot,
// and visits every screen: each shows the fixture's own figures, offers no control that adds, edits or deletes data, and only the Calculators screen takes typed numbers (which change nothing).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { remote } from "webdriverio";
import { launchApp } from "./harness.mjs";
import { ipc, client } from "./mobileHttpsHarness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth, monthFromNow } from "./lib/dates.mjs";
import { isolatedTempEnv, makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Mobile checking', 'checking', '1000.00')")
a = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,fingerprint) VALUES (?, '${dateInMonth(-1, 4)}','Private merchant','-125.00','Groceries','mobile-check')", (a,))
cur.execute("INSERT INTO budgets (category,period,monthly_amount,budget_group) VALUES ('Groceries','${monthFromNow(-1)}','400.00','flexible')")
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES ('${monthFromNow(-1)}')")
`);
const app = await launchApp({ dbDir });
let browser, driver, server, cookie = "";
try {
  const [listener, certificate] = await ipc(app, "debug_start_mobile_asset_server");
  const request = client(listener.origin, certificate.pem), root = path.resolve("dist-mobile");
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff": "font/woff", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".png": "image/png" };
  server = createServer(async (req, res) => {
    try {
      const route = new URL(req.url, "http://localhost").pathname;
      if (route.startsWith("/api/")) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
        const response = await request(route, { method: req.method, body, cookie, headers: req.headers["x-vault-csrf"] ? { "X-Vault-CSRF": req.headers["x-vault-csrf"] } : {} });
        if (response.headers["set-cookie"]) { const value = response.headers["set-cookie"][0]; cookie = value.includes("Max-Age=0") ? "" : value.split(";")[0]; }
        res.writeHead(response.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(response.body); return;
      }
      const file = path.resolve(root, "." + route); assert.ok(file.startsWith(root + path.sep));
      const content = await readFile(file);
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }); res.end(content);
    } catch { res.writeHead(503); res.end("{}"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/mobile/index.html`;
  let port;
  driver = spawn(process.env.MSEDGEDRIVER ?? path.join(os.homedir(), ".cargo/bin/msedgedriver.exe"), ["--port=0"], { windowsHide: true, env: { ...process.env, ...isolatedTempEnv(makeTempDir("vaultspend-edgedriver-")) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Edge driver startup timeout")), 15000); driver.once("error", reject); driver.stdout.on("data", bytes => { const m = String(bytes).match(/port (\d+)/); if (m && Number(m[1])) { port = Number(m[1]); clearTimeout(timer); resolve(); } }); });
  browser = await remote({ hostname: "127.0.0.1", port, path: "/", logLevel: "error", capabilities: { browserName: "MicrosoftEdge", "ms:edgeOptions": { args: ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${makeTempDir("vault-mobile-screens-edge-")}`, "--window-size=480,1200"] } } });

  // Pair and download the snapshot.
  const code = await ipc(app, "mobile_begin_pairing");
  await browser.url(`${url}#pair=${code}`);
  await browser.$("input[aria-label='One-time pairing code']").waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => await browser.$("button*=Request desktop approval").isEnabled(), { timeout: 10000 });
  await (await browser.$("button*=Request desktop approval")).click();
  await app.browser.waitUntil(async () => (await ipc(app, "mobile_pending_pairings")).length === 1, { timeout: 8000 });
  await app.browser.waitUntil(async () => app.browser.execute(() => document.querySelectorAll(".modal-overlay input[type=checkbox]").length >= 1), { timeout: 8000 });
  await app.browser.execute(() => { for (const input of document.querySelectorAll(".modal-overlay input[type=checkbox]")) input.click(); [...document.querySelectorAll("button")].find(b => b.textContent === "Approve phone").click(); });
  await browser.$("button[aria-label^='Profile:']").waitForExist({ timeout: 20000 });
  await browser.execute(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("Download selected snapshot")); if (b) b.click(); });
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector(".mobile-sync") || document.body.textContent.includes("Ready offline")), { timeout: 20000, timeoutMsg: "the snapshot downloads" });
  const text = () => browser.execute(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  // Capture before any view/calculator interaction, not twice after the work being checked.
  const before = await ipc(app, "debug_mobile_database_digest");
  const controls = () => browser.execute(() => {
    const main = document.querySelector("main") ?? document.body;
    return { buttons: [...main.querySelectorAll("button")].map(x => (x.getAttribute("aria-label") || x.textContent).trim()).filter(Boolean), inputs: [...main.querySelectorAll("input:not([type=checkbox]):not([type=radio]), textarea")].length, forms: main.querySelectorAll("form").length };
  });
  const WRITES = /^(add|edit|delete|remove|save|new|import|reconcile|categor|rename|create|set budget)/i;
  const visit = async label => {
    await (await browser.$(`button[aria-label='${label}']`)).click();
    await browser.waitUntil(async () => (await browser.$(`button[aria-label='${label}']`).getAttribute("aria-current")) === "page", { timeout: 5000 });
    await browser.pause(400);
    const c = await controls();
    assert.deepEqual(c.buttons.filter(b => WRITES.test(b)), [], `${label}: no control that adds, edits or deletes data: ` + JSON.stringify(c.buttons));
    return { t: await text(), c };
  };
  const overview = await visit("Overview");
  assert.ok(overview.t.includes("Your money at a glance"), overview.t.slice(0, 200));
  assert.ok(overview.t.includes("$875.00"), "net worth = 1000 - 125: " + overview.t.slice(0, 400));
  const accounts = await visit("Accounts");
  assert.ok(accounts.t.includes("Mobile checking") && accounts.t.includes("$875.00"), accounts.t.slice(0, 400));
  const budget = await visit("Budget");
  assert.ok(budget.t.includes("Groceries") && budget.t.includes("$400.00"), budget.t.slice(0, 500));
  const reports = await visit("Reports");
  assert.ok(reports.t.includes("The bigger picture") && reports.t.includes("Total spending") && reports.t.includes("$125.00"), "Reports show the month's spending: " + reports.t.slice(0, 300));
  console.log("REPORTS: " + reports.t.slice(0, 300).replace(/\n/g, " | "));
  const calc = await visit("Calculators");
  assert.ok(calc.t.includes("Plan your next step") && calc.t.includes("They never change your desktop data."), calc.t.slice(0, 300));
  const projection = () => browser.execute(() => [...document.querySelectorAll(".mobile-line")].find(el => el.textContent.includes("Projected balance"))?.textContent ?? "");
  await browser.waitUntil(async () => (await projection()).includes("$13,000.00"), { timeout: 5000, timeoutMsg: "zero return: 1000 + 100 per month for 120 months = 13000" });
  await browser.$('//label[span[normalize-space()="Monthly contribution"]]/input').setValue("200");
  await browser.waitUntil(async () => (await projection()).includes("$25,000.00"), { timeout: 5000, timeoutMsg: "edited contribution changes output: 1000 + 200 x 120 = 25000" });
  for (const t of [overview, accounts, budget, reports]) assert.equal(t.c.inputs, 0, "no typed-in fields outside Calculators");
  // The saved copy says when it was saved (Settings), so the person can tell how old it is away from the desktop.
  await (await browser.$("button[aria-label='Settings']")).click();
  await browser.$(".mobile-sync").waitForExist({ timeout: 10000 });
  const sync = await browser.$(".mobile-sync").getText();
  assert.ok(/Snapshot as of [A-Z][a-z]{2} \d{1,2}/.test(sync) && /Saved [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/.test(sync), "the saved copy says when it was saved: " + sync);
  assert.equal(await ipc(app, "debug_mobile_database_digest"), before, "using the viewer changed nothing on the desktop");
  console.log("FEATURE 358 PASSED: Overview, Accounts, Budget, Reports and Calculators show the snapshot and offer no way to change data.");
} finally {
  await browser?.deleteSession().catch(() => {}); driver?.kill(); server?.close(); await app.close();
}
