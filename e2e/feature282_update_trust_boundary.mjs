// Compiled updater containment while production signing integration is pending.
// Only disposable data and a non-existent installer path; no download or executable launch.
import assert from "node:assert/strict";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const dbDir = freshTestDbDir();
const app = await launchApp({ dbDir });
try {
  const invokeResult = async (command, args) => app.browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then(
      () => done({ allowed: true }),
      (error) => done({ allowed: false, error: String(error) }),
    );
  }, command, args);

  const download = await invokeResult("download_update_asset", {
    url: "http://127.0.0.1:1/inert", filename: "inert-update.exe",
  });
  assert.equal(download.allowed, false, "the legacy download command is unavailable");
  assert.match(download.error, /not found/i, "the command was removed, not merely failing its request");

  const open = await invokeResult("plugin:opener|open_path", {
    path: path.join(dbDir, "nonexistent-update-installer.exe"),
  });
  assert.equal(open.allowed, false, "renderer cannot open an installer path");
  assert.match(open.error, /not allowed|denied|permission|scope|forbidden/i, "the permission boundary rejects opening");
  console.log("FEATURE 282 UPDATE TRUST BOUNDARY PASSED");
} finally {
  await app.close();
}
