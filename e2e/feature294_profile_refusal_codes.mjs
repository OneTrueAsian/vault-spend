// Real native refusals for switching/adding profiles carry stable codes, not wording the UI must guess.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { launchApp } from "./harness.mjs";

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
  const missingFile = path.join(os.tmpdir(), "f294-does-not-exist.db");
  const seen = await b.executeAsync((missingFile, done) => {
    (async () => {
      const call = window.VaultProfileApi.invokeProfile;
      const refusal = async (promise) => {
        try {
          await promise;
          return { code: "none" };
        } catch (error) {
          return { code: error.code, message: error.message };
        }
      };
      const generation = await call("get_current_generation");
      const profiles = await call("list_profiles");
      const active = profiles.find((profile) => profile.is_active);
      done({
        listed: profiles.length > 0 && Boolean(active),
        unknownSwitch: await refusal(call("switch_profile", { id: "f294-no-such-profile" })),
        staleAdd: await refusal(
          call("add_existing_profile", { name: "F294", dbPath: missingFile, password: null, expectedGeneration: generation + 100 }),
        ),
        missingAdd: await refusal(
          call("add_existing_profile", { name: "F294", dbPath: missingFile, password: null, expectedGeneration: generation }),
        ),
        duplicateRename: await refusal(call("create_profile", { name: active.name })),
        background: await call("get_background_settings"),
      });
    })().catch((error) => done({ fatal: String(error) }));
  }, missingFile);
  assert.equal(seen.fatal, undefined);
  assert.equal(seen.listed, true);
  assert.equal(seen.unknownSwitch.code, "profile_not_found");
  assert.equal(seen.staleAdd.code, "profile_changed");
  assert.equal(seen.missingAdd.code, "file_not_found");
  assert.equal(seen.duplicateRename.code, "duplicate_profile_name");
  assert.equal(typeof seen.background.tray_enabled, "boolean");
} finally {
  await app.close();
}
console.log("FEATURE 294 PROFILE REFUSAL CODES PASSED");
