// E2E test for Phase B of password protection: when Vault Spend can't open a profile at launch it
// shows a launch error screen (instead of exiting, showing a blank window, or quietly opening some
// other file), and the person can recover without a password.
//   - a damaged data file: the file is left exactly as it was; Try again says so while it is still
//     broken and opens the app once the file is put back;
//   - a damaged profile list: "Use the previous profile list" puts the earlier list back;
//   - a data file that has moved: the message names it, nothing blank is created in its place, and
//     another profile whose file exists can be opened instead;
//   - locating a data file (the picker is native and can't be driven, so the command behind it is
//     called directly): a text file is refused, a real data file opens;
//   - starting over: a new data file (after a confirmation that can be cancelled) leaves the damaged
//     old file byte for byte as it was, and a new profile list sets the damaged one aside.
//
// Run with: node e2e/feature99_launch_error_screen.mjs

import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const SEED = `cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")`;
const ERROR = "[data-launch-error]";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (e) => done({ error: String(e) }));
  }, command, args);
}
const action = (browser, name) => browser.$(`[data-launch-action='${name}']`);

async function expectKind(browser, kind) {
  const screen = await browser.$(ERROR);
  await screen.waitForExist({ timeout: 10000, timeoutMsg: `the launch error screen should be showing (${kind})` });
  const shown = await screen.getAttribute("data-launch-error-kind");
  if (shown !== kind) throw new Error(`expected the error kind ${kind}, the screen says ${shown}`);
  if (await browser.$(".brand-word").isExisting()) throw new Error("the app must not be showing behind the error screen");
}

async function expectAppOpens(browser, why) {
  await browser.$(".brand-word").waitForExist({ timeout: 15000, timeoutMsg: why });
  if (await browser.$(ERROR).isExisting()) throw new Error("the error screen should be gone once the app opens");
}

async function scenario(name, dbDir, body) {
  const app = await launchApp({ dbDir, ready: ERROR });
  try {
    await body(app.browser);
    console.log(`  ok: ${name}`);
  } finally {
    await app.close();
  }
}

// 1. A damaged data file.
{
  const dbDir = await seedFixture(SEED);
  const dbFile = path.join(dbDir, "vaultspend.db");
  const good = path.join(dbDir, "good-copy.db");
  fs.copyFileSync(dbFile, good);
  fs.writeFileSync(dbFile, "this is not a database");
  await scenario("a damaged data file", dbDir, async (browser) => {
    await expectKind(browser, "data_file_unreadable");
    if (!(await action(browser, "quit").isExisting())) throw new Error("Quit must be offered");
    if (!(await action(browser, "locate").isExisting())) throw new Error("Find the data file must be offered for a file problem");
    if (await action(browser, "restore-registry").isExisting()) throw new Error("the previous-list action belongs to a damaged profile list only");
    if (fs.readFileSync(dbFile, "utf8") !== "this is not a database") throw new Error("the damaged file must be left exactly as it was");

    await action(browser, "retry").click();
    await browser.waitUntil(async () => (await browser.$("[data-launch-error-problem]").getText()).trim().length > 0, {
      timeout: 10000,
      timeoutMsg: "Try again while it is still broken should say so",
    });
    await expectKind(browser, "data_file_unreadable");

    fs.copyFileSync(good, dbFile);
    await action(browser, "retry").click();
    await expectAppOpens(browser, "after the file is put back, Try again should open the app");
  });
}

// 2. A damaged profile list with an earlier copy.
{
  const dbDir = await seedFixture(SEED);
  const dbFile = path.join(dbDir, "vaultspend.db");
  const earlier = JSON.stringify({ profiles: [{ id: "default", name: "Default", db_path: dbFile, icon_key: null }] });
  fs.writeFileSync(path.join(dbDir, "profiles.json.bak"), earlier);
  fs.writeFileSync(path.join(dbDir, "profiles.json"), "{ not json");
  await scenario("a damaged profile list", dbDir, async (browser) => {
    await expectKind(browser, "registry_unreadable");
    if (await action(browser, "locate").isExisting()) throw new Error("finding a data file does not fix a damaged profile list");
    await action(browser, "restore-registry").click();
    await expectAppOpens(browser, "using the previous profile list should open the app");
    const restored = JSON.parse(fs.readFileSync(path.join(dbDir, "profiles.json"), "utf8"));
    if (restored.profiles.length !== 1 || restored.profiles[0].id !== "default") throw new Error("the earlier list should be back");
    if (fs.readFileSync(path.join(dbDir, "profiles.json.damaged"), "utf8") !== "{ not json") throw new Error("the damaged list should be kept, not destroyed");
  });
}

// 3. A data file that has moved, with another profile to open instead.
{
  const dbDir = await seedFixture(SEED);
  const dbFile = path.join(dbDir, "vaultspend.db");
  const secondDir = path.join(dbDir, "profiles", "second");
  fs.mkdirSync(secondDir, { recursive: true });
  const secondDb = path.join(secondDir, "vaultspend.db");
  fs.copyFileSync(dbFile, secondDb);
  const registry = {
    profiles: [
      { id: "default", name: "Default", db_path: dbFile, icon_key: null },
      { id: "second", name: "Second", db_path: secondDb, icon_key: null },
    ],
  };
  fs.writeFileSync(path.join(dbDir, "profiles.json"), JSON.stringify(registry));
  fs.writeFileSync(path.join(dbDir, "config.json"), JSON.stringify({ db_path: dbFile }));
  fs.renameSync(dbFile, `${dbFile}.moved`);
  await scenario("a data file that has moved", dbDir, async (browser) => {
    await expectKind(browser, "data_file_missing");
    const message = await browser.$("[data-launch-error-message]").getText();
    if (!message.includes(dbFile)) throw new Error(`the message should name the missing file, got: ${message}`);
    if (fs.existsSync(dbFile)) throw new Error("no blank database may appear where the file used to be");
    if (await browser.$("[data-launch-profile='default']").isExisting()) throw new Error("the profile whose file is missing must not be offered");

    await (await browser.$("[data-launch-profile='second']")).click();
    await expectAppOpens(browser, "opening the other profile should open the app");
    const where = (await invoke(browser, "get_data_file_location")).ok;
    if (path.resolve(where) !== path.resolve(secondDb)) throw new Error(`the app should be on the second profile's file, is on ${where}`);
    const config = JSON.parse(fs.readFileSync(path.join(dbDir, "config.json"), "utf8"));
    if (path.resolve(config.db_path) !== path.resolve(secondDb)) throw new Error("config.json should now point at the profile that was opened");
  });
}

// 4. Locating the data file.
{
  const dbDir = await seedFixture(SEED);
  const dbFile = path.join(dbDir, "vaultspend.db");
  const foundDir = path.join(dbDir, "found");
  fs.mkdirSync(foundDir);
  const found = path.join(foundDir, "vaultspend.db");
  fs.copyFileSync(dbFile, found);
  fs.renameSync(dbFile, `${dbFile}.moved`);
  const notes = path.join(dbDir, "notes.txt");
  fs.writeFileSync(notes, "just some notes");
  fs.writeFileSync(path.join(dbDir, "config.json"), JSON.stringify({ db_path: path.join(dbDir, "unplugged", "vaultspend.db") }));
  await scenario("locating the data file", dbDir, async (browser) => {
    await expectKind(browser, "data_file_missing");
    const refused = await invoke(browser, "locate_data_file", { path: notes });
    if (!refused.error) throw new Error(`a text file is not a data file and must be refused, got ${JSON.stringify(refused)}`);
    if (!(await browser.$(ERROR).isExisting())) throw new Error("a refused pick must leave the error screen up");

    const located = await invoke(browser, "locate_data_file", { path: found });
    if (located.ok?.status !== "open") throw new Error(`a real data file should open, got ${JSON.stringify(located)}`);
    // The page was not told; Try again asks the backend, which answers that a profile is open.
    await action(browser, "retry").click();
    await expectAppOpens(browser, "after locating the file, the app should open");
    const config = JSON.parse(fs.readFileSync(path.join(dbDir, "config.json"), "utf8"));
    if (path.resolve(config.db_path) !== path.resolve(found)) throw new Error("config.json should remember the located file");

    // Once a profile is open, the launch-recovery commands refuse: a page bug must not be able to swap it.
    const again = await invoke(browser, "locate_data_file", { path: found });
    if (!again.error || !/already open/i.test(again.error)) throw new Error(`launch recovery must refuse once a profile is open, got ${JSON.stringify(again)}`);
  });
}

// 5. Starting with a new data file (a damaged default file, no other profile).
{
  const dbDir = await seedFixture(SEED);
  const dbFile = path.join(dbDir, "vaultspend.db");
  fs.writeFileSync(dbFile, "this is not a database");
  await scenario("starting with a new data file", dbDir, async (browser) => {
    await expectKind(browser, "data_file_unreadable");
    await action(browser, "start-new-file").click();
    await browser.$("[data-launch-confirm]").waitForExist({ timeout: 10000, timeoutMsg: "starting over should ask first" });
    await (await browser.$("[data-launch-confirm-cancel]")).click();
    if (await browser.$("[data-launch-confirm]").isExisting()) throw new Error("Cancel should close the question");
    if (await browser.$(".brand-word").isExisting()) throw new Error("Cancel must not open anything");

    await action(browser, "start-new-file").click();
    await (await browser.$("[data-launch-confirm-yes]")).click();
    await expectAppOpens(browser, "confirming should open the app on a new data file");
    const where = (await invoke(browser, "get_data_file_location")).ok;
    const folder = path.dirname(where);
    if (path.basename(path.dirname(folder)) !== "profiles" || !path.basename(folder).startsWith("started-")) {
      throw new Error(`the new file should live in its own folder under profiles/, is at ${where}`);
    }
    if (fs.readFileSync(dbFile, "utf8") !== "this is not a database") throw new Error("the old file must be left exactly as it was");
    const config = JSON.parse(fs.readFileSync(path.join(dbDir, "config.json"), "utf8"));
    if (path.resolve(config.db_path) !== path.resolve(where)) throw new Error("config.json should point at the new file");
  });
}

// 6. Starting with a new profile list (damaged, with no earlier copy).
{
  const dbDir = await seedFixture(SEED);
  fs.writeFileSync(path.join(dbDir, "profiles.json"), "{ not json");
  await scenario("starting with a new profile list", dbDir, async (browser) => {
    await expectKind(browser, "registry_unreadable");
    if (await action(browser, "restore-registry").isExisting()) throw new Error("with no earlier copy, restoring must not be offered");
    await action(browser, "start-new-list").click();
    await (await browser.$("[data-launch-confirm-yes]")).click();
    await expectAppOpens(browser, "confirming should open the app without the damaged list");
    if (fs.readFileSync(path.join(dbDir, "profiles.json.damaged"), "utf8") !== "{ not json") throw new Error("the damaged list should be kept, not destroyed");
    if (fs.existsSync(path.join(dbDir, "profiles.json"))) throw new Error("there is no profile list until one is created");
  });
}

console.log("FEATURE 99 E2E TEST PASSED");
