// Where the security screens' specs (114, 417, 418) put their screenshots. Saved through saveScreenshot, so
// `npm run e2e -- --spec=<n> --keep-screens` keeps them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SECURITY_SHOTS = process.env.VAULTSPEND_E2E_SHOTS ?? path.join(os.tmpdir(), "vaultspend-e2e-security-shots");

export async function saveSecurityShot(browser, fileName) {
  fs.mkdirSync(SECURITY_SHOTS, { recursive: true });
  await browser.saveScreenshot(path.join(SECURITY_SHOTS, fileName));
}
