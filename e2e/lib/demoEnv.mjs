import path from "node:path";

/** Environment for launching the app on demo data: the database and WebView2 storage (localStorage etc.)
 * both live in the demo folder, so a demo never reads or changes the installed app's settings. */
export function demoEnv(dataDir) {
  return { ...process.env, VAULTSPEND_DB_DIR: dataDir, WEBVIEW2_USER_DATA_FOLDER: path.join(dataDir, "webview") };
}
