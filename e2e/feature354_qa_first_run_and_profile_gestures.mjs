// UAT-003 the first run (README "Installing" step 3: it starts completely empty, no sample data) and UAT-008 renaming a profile and changing its icon (Settings > Profiles).
//   First run: the legal notice comes first, then an empty app with one profile and a prompt for the first account; a second profile is created from Settings and starts empty.
//   Rename: Enter saves, Escape throws the edit away, clicking away saves, an empty name changes nothing; a profile that is not the current one can be renamed too.
//   Icon: the swatch opens a picker, choosing one changes the icon in the Profiles row and in the sidebar chooser and is stored.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture("");
const app = await launchApp({ dbDir, ready: "[data-legal-notice]", showLegalNotice: true });
const { browser: b } = app;
async function invoke(command, args = {}) {
  const r = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then(ok => done({ ok }), e => done({ error: String(e?.message ?? e) })), command, args);
  if (r.error) throw new Error(`${command} failed: ${r.error}`);
  return r.ok;
}
const profiles = () => invoke("list_profiles");
const row = name => b.$(`//tr[td[contains(normalize-space(.), "${name}")]]`);
const rowNames = () => b.execute(() => [...document.querySelectorAll(".card table tr")].map(r => r.cells[1]?.textContent.trim()).filter(Boolean));
const sidebarName = () => b.$(".profile-switcher-name").getText();
try {
  await b.setWindowSize(1280, 1100);
  // --- UAT-003 ---------------------------------------------------------------------------------------------------------------------------------------------------
  await b.$("[data-legal-notice]").waitForExist({ timeout: 10000, timeoutMsg: "a first launch shows the legal notice first" });
  assert.equal(await b.$(".brand-word").isExisting(), false, "the app is not showing behind the notice");
  await (await b.$("[data-legal-notice-ok]")).click();
  await b.$(".brand-word").waitForExist({ timeout: 15000, timeoutMsg: "the app opens once the notice is acknowledged" });
  // A first run also greets the person once, and says where to find the tour again.
  await waitUntilOrDiagnose(b, async () => (await b.execute(() => document.querySelector("[role='dialog']")?.innerText ?? "")).includes("Welcome to Vault Spend"), { timeout: 15000, timeoutMsg: "the first run greets the person", extra: () => b.execute(() => document.body.innerText.slice(0, 300)) });
  const welcome = await b.execute(() => document.querySelector("[role='dialog']").innerText);
  assert.ok(welcome.includes("would you like a quick tour") && welcome.includes("You can always come back to this from the Help tab in the sidebar."), welcome);
  await (await b.$("//div[@role='dialog']//button[normalize-space()='Just get started']")).click();
  // Shown once per version, on a first install too (App.tsx): what this version brought. It closes with Escape.
  await waitUntilOrDiagnose(b, async () => (await b.execute(() => document.querySelector("[role='dialog']")?.innerText ?? "")).startsWith("What's new in"), { timeout: 15000, timeoutMsg: "the version's notes follow the greeting", extra: () => b.execute(() => document.body.innerText.slice(0, 200)) });
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => !(await b.$("[role='dialog']").isExisting()), { timeout: 10000, timeoutMsg: "the notes close" });
  assert.deepEqual([(await invoke("list_accounts")).length, (await invoke("list_transactions")).length], [0, 0], "no sample data");
  const first = await profiles();
  assert.equal(first.length, 1, "one profile exists from the start: " + JSON.stringify(first.map(p => p.name)));
  assert.equal(first[0].is_active, true);
  assert.equal(first[0].is_password_protected, false, "nothing is protected unless the person turns it on");
  const dashboard = await b.execute(() => document.querySelector(".main")?.innerText ?? document.body.innerText);
  assert.ok(/Add an account/i.test(dashboard), "the empty dashboard points to the first step: " + dashboard.slice(0, 400));
  const firstName = first[0].name;

  // --- a second profile from Settings ---------------------------------------------------------------------------------------------------------------------------------
  for (const x of await b.$$("nav button")) if ((await x.getText()).trim() === "Settings") { await x.click(); break; }
  await b.$(".profile-create-form input").waitForExist({ timeout: 10000 });
  await waitUntilOrDiagnose(b, async () => { try { await (await b.$(".profile-create-form input")).setValue("Second Profile"); return (await (await b.$(".profile-create-form input")).getValue()) === "Second Profile"; } catch { return false; } }, { timeout: 10000, timeoutMsg: "the new-profile name can be typed" });
  await b.$('.profile-create-form button[type="submit"]').click();
  await waitUntilOrDiagnose(b, async () => (await sidebarName()) === "Second Profile", { timeout: 15000, timeoutMsg: "creating a profile switches to it" });
  assert.equal((await invoke("list_accounts")).length, 0, "a new profile starts empty");
  for (const x of await b.$$("nav button")) if ((await x.getText()).trim() === "Settings") { await x.click(); break; }

  // --- UAT-008 rename ---------------------------------------------------------------------------------------------------------------------------------------------------------
  // The profile list re-renders right after a click on Rename (the name field is re-created), so the field is looked up again on every try.
  const retry = async (what, fn) => { let last; await waitUntilOrDiagnose(b, async () => { try { await fn(); return true; } catch (e) { last = e; return false; } }, { timeout: 10000, timeoutMsg: what, extra: () => String(last) }); };
  const rename = async (name, typed, key) => {
    await retry(`Rename opens the field for ${name}`, async () => { await (await (await row(name)).$("button=Rename")).click(); await b.$(".row-edit-input").waitForExist({ timeout: 2000 }); });
    assert.equal(await (await b.$(".row-edit-input")).getValue(), name, "the field starts with the current name");
    // As a person edits: select everything and type over it (or delete it), without WebDriver's clear(), which would blur the field.
    await b.keys(["Control", "a"]);
    if (typed === null) await b.keys(["Backspace"]); else await b.keys([...typed]);
    assert.equal(await (await b.$(".row-edit-input")).getValue(), typed ?? "");
    if (key === "away") await (await b.$("h1, .page-title, .page-top")).click(); else await b.keys(key);
    await waitUntilOrDiagnose(b, async () => !(await b.$(".row-edit-input").isExisting()), { timeout: 5000, timeoutMsg: "the field closes" });
  };
  await rename("Second Profile", "Renamed With Enter", "Enter");
  await waitUntilOrDiagnose(b, async () => (await sidebarName()) === "Renamed With Enter", { timeout: 10000, timeoutMsg: "Enter saves, and the sidebar chooser follows" });
  assert.ok((await rowNames()).some(n => n.startsWith("Renamed With Enter")));
  await rename("Renamed With Enter", "Thrown Away", "Escape");
  await b.pause(600);
  assert.equal(await sidebarName(), "Renamed With Enter", "Escape throws the edit away");
  assert.ok(!(await rowNames()).some(n => n.includes("Thrown Away")), "and the row keeps its name");
  assert.ok((await profiles()).every(p => p.name !== "Thrown Away"), "nothing was stored");
  await rename("Renamed With Enter", null, "Enter");
  await b.pause(600);
  assert.equal(await sidebarName(), "Renamed With Enter", "an empty name changes nothing");
  await rename("Renamed With Enter", "Renamed By Clicking Away", "away");
  await waitUntilOrDiagnose(b, async () => (await sidebarName()) === "Renamed By Clicking Away", { timeout: 10000, timeoutMsg: "clicking away saves, like Enter" });
  // A profile that is not the current one.
  await (await (await row(firstName)).$("button=Switch")).click();
  await waitUntilOrDiagnose(b, async () => (await sidebarName()) === firstName, { timeout: 15000, timeoutMsg: "switching to the first profile" });
  for (const x of await b.$$("nav button")) if ((await x.getText()).trim() === "Settings") { await x.click(); break; }
  await rename("Renamed By Clicking Away", "Other Profile Renamed", "Enter");
  await waitUntilOrDiagnose(b, async () => (await profiles()).some(p => p.name === "Other Profile Renamed" && !p.is_active), { timeout: 10000, timeoutMsg: "a profile that is not current can be renamed" });
  assert.equal(await sidebarName(), firstName, "the current profile is untouched");

  // --- UAT-008 icon ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  const swatch = () => b.$(`button[aria-label="Change ${firstName}'s icon"]`);
  const pickerOpen = () => b.execute(() => !!document.querySelector(".icon-picker"));
  const before = (await profiles()).find(p => p.name === firstName).icon_key ?? null;
  await (await swatch()).click();
  await waitUntilOrDiagnose(b, pickerOpen, { timeout: 5000, timeoutMsg: "the swatch opens the picker" });
  const offered = await b.execute(() => [...document.querySelectorAll('.icon-picker button[aria-label^="Use the "]')].map(x => x.getAttribute("aria-label")));
  assert.ok(offered.length > 3, "the picker offers several icons: " + offered.length);
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => !(await pickerOpen()), { timeout: 5000, timeoutMsg: "Escape closes the picker without choosing" });
  assert.equal(await b.execute(() => document.activeElement?.getAttribute("aria-label")), `Change ${firstName}'s icon`, "focus returns to the swatch");
  assert.equal((await profiles()).find(p => p.name === firstName).icon_key ?? null, before, "closing the picker changed nothing");
  await (await swatch()).click();
  await waitUntilOrDiagnose(b, pickerOpen, { timeout: 5000, timeoutMsg: "the swatch opens the picker again" });
  const choice = offered.find(label => label !== `Use the ${before} icon`);
  await (await b.$(`.icon-picker button[aria-label="${choice}"]`)).click();
  const wanted = choice.replace(/^Use the /, "").replace(/ icon$/, "");
  await waitUntilOrDiagnose(b, async () => ((await profiles()).find(p => p.name === firstName).icon_key ?? null) === wanted, { timeout: 10000, timeoutMsg: `choosing an icon stores it (${wanted})`, extra: async () => (await profiles()).map(p => [p.name, p.icon_key]) });
  assert.equal(await pickerOpen(), false, "choosing an icon closes the picker");
  const icons = await b.execute(() => ({ row: document.querySelector("tbody .icon-picker-swatch svg, tbody .icon-picker-swatch img")?.outerHTML.length ?? 0, side: document.querySelector(".profile-switcher-icon")?.outerHTML.length ?? 0 }));
  assert.ok(icons.row > 0 && icons.side > 0, "the icon shows in the row and the chooser: " + JSON.stringify(icons));
  console.log("FEATURE 354 PASSED: first run (notice, empty app, one profile), a second profile, rename by Enter / Escape / clicking away / empty / a profile that is not current, and the icon picker (" + before + " -> " + wanted + ").");
} finally { await app.close(); }
