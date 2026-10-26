// Actual native replies and event delivery; malformed events must not mount financial UI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const bundle = await build({
  entryPoints: ["src/profileIpc.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "VaultProfileApi",
  platform: "browser",
});
const app = await launchApp();
const b = app.browser;
try {
  await b.execute(bundle.outputFiles[0].text + "\nwindow.VaultProfileApi=VaultProfileApi;");
  const replies = await b.executeAsync((done) => {
    (async () => {
      const call = window.VaultProfileApi.invokeProfile;
      const state = await call("get_startup_state");
      const generation = await window.__TAURI_INTERNALS__.invoke("get_current_generation");
      const challenge = await call("begin_protection_setup", {
        password: "inert-f293-password",
        expectedGeneration: generation,
      });
      await call("cancel_protection_setup", { token: challenge.token });
      // Return shape observations only; do not export/log the ephemeral recovery key or token.
      done({
        status: state.status,
        groups: challenge.recovery_display.split("-").length,
        indices: challenge.challenge_group_indices,
        cancelled: true,
      });
    })().catch((error) => done({ error: String(error) }));
  });
  assert.equal(replies.error, undefined);
  assert.equal(replies.status, "open");
  assert.equal(replies.groups, 7);
  assert.equal(replies.cancelled, true);
  assert.equal(replies.indices.length, 2);
  assert.notEqual(replies.indices[0], replies.indices[1]);

  const emit = (payload) =>
    b.executeAsync((payload, done) => {
      window.__TAURI_INTERNALS__
        .invoke("plugin:event|emit", { event: "profile-lock-state-changed", payload })
        .then(() => done({ emitted: true }))
        .catch((error) => done({ error: String(error) }));
    }, payload);
  for (const bad of [
    { status: "unexpected", privateValue: "must-not-render" },
    { status: "locked", profile_id: "a", profile_name: null },
  ]) {
    assert.deepEqual(await emit(bad), { emitted: true });
    await b.$('[data-launch-error-kind="startup_failed"]').waitForExist({ timeout: 10000 });
    assert.equal(await b.$(".brand-word").isExisting(), false);
    assert.equal(await b.$("[data-auto-lock-session]").isExisting(), false);
    assert.equal((await b.$("body").getText()).includes("must-not-render"), false);
    const fresh = await b.executeAsync((done) => {
      window.VaultProfileApi.invokeProfile("get_startup_state")
        .then(done)
        .catch((e) => done({ error: String(e) }));
    });
    assert.equal(fresh.status, "open", "event validation does not claim to lock the native session");
    assert.deepEqual(await emit(fresh), { emitted: true });
    await b.$(".brand-word").waitForExist({ timeout: 10000 });
    await b.$('[data-widget-id="stat_net_worth"] .stat-value').waitForExist({ timeout: 10000 });
  }
} finally {
  await app.close();
}

// A genuinely unreadable conversion journal exercises Rust's previously omitted enum variant.
const dbDir = await seedFixture("# intact disposable database");
const journal = path.join(dbDir, "protection-journal.json");
fs.writeFileSync(journal, "inert malformed journal");
const original = fs.readFileSync(path.join(dbDir, "vaultspend.db"));
const broken = await launchApp({ dbDir, ready: '[data-launch-error-kind="protection_journal_unreadable"]' });
try {
  const page = broken.browser;
  assert.match(await page.$("h1").getText(), /protection change/i);
  assert.equal(await page.$(".brand-word").isExisting(), false);
  assert.equal(await page.$('[data-launch-action="locate"]').isExisting(), false);
  assert.equal(await page.$('[data-launch-action="new-file"]').isExisting(), false);
  assert.equal(await page.$('[data-launch-action="new-list"]').isExisting(), false);
  assert.equal(fs.readFileSync(journal, "utf8"), "inert malformed journal");
  assert.deepEqual(fs.readFileSync(path.join(dbDir, "vaultspend.db")), original);
} finally {
  await broken.close();
}
console.log("FEATURE 293 PROFILE IPC CONTRACTS PASSED");
