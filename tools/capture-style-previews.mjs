// Captures the six style pictures shown in Settings > Appearance (one per style, in light and dark):
// src/assets/style-previews/{transparent,futuristic,retro}-{light,dark}.webp.
//
// It opens the REAL compiled app on the household demo data (the same data `npm run demo:household`
// builds, in a throwaway folder), shows the Dashboard at 1280x800 in each style, and turns each
// screenshot into a 480x300 WebP of at most 60 KB. The conversion runs on a canvas inside the app's
// own WebView (no image library is installed), from the screenshot's bytes, not a URL.
//
// Run after `npx tauri build --debug --no-bundle`, from the repository root:
//   node tools/capture-style-previews.mjs
// It uses VAULTSPEND_EXE like the e2e suite, when set.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dismissFirstLaunchDialogs, dismissStatusMessages, launchApp, waitForDataLoaded } from "../e2e/harness.mjs";
import { seedHouseholdDatabase } from "../e2e/household-demo.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(repoRoot, "src", "assets", "style-previews");
const MAX_BYTES = 60 * 1024;
const STYLES = ["transparent", "futuristic", "retro"];
const THEMES = ["light", "dark"];

fs.mkdirSync(OUT_DIR, { recursive: true });
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-style-previews-"));
await seedHouseholdDatabase(dbDir);

const app = await launchApp({ dbDir });
const { browser } = app;
try {
  await browser.setWindowSize(1280, 800);
  for (const style of STYLES) {
    for (const theme of THEMES) {
      await browser.execute(
        (s, t) => {
          localStorage.setItem("meadow-theme-style", s);
          localStorage.setItem("meadow-theme", t);
          localStorage.setItem("meadow-reduce-motion", "on");
          location.reload();
        },
        style,
        theme,
      );
      await (await browser.$(".nav-item")).waitForExist({ timeout: 20000 });
      await waitForDataLoaded(browser);
      await browser.waitUntil(
        () => browser.execute((s, t) => document.documentElement.dataset.palette === s && document.documentElement.dataset.theme === t, style, theme),
        { timeout: 10000, timeoutMsg: `${style} ${theme} should apply` },
      );
      await dismissFirstLaunchDialogs(browser);
      await browser.execute(() => [...document.querySelectorAll(".nav-item")].find((b) => b.dataset.tab === "dashboard")?.click());
      await browser.waitUntil(() => browser.execute(() => document.querySelector(".view-title")?.textContent.trim() === "Dashboard"), {
        timeout: 10000,
        timeoutMsg: "the Dashboard should show",
      });
      await dismissStatusMessages(browser);
      await browser.executeAsync((done) => document.fonts.ready.then(() => setTimeout(done, 800))); // charts and fonts settle

      const png = await browser.takeScreenshot(); // base64
      const result = await browser.executeAsync(
        (base64, maxBytes, done) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          createImageBitmap(new Blob([bytes], { type: "image/png" })).then((bitmap) => {
            // Cover-crop the top-left 1280x800 (16:10) region of the screenshot, whatever its pixel ratio.
            const srcW = Math.min(bitmap.width, Math.round(bitmap.height * 1.6));
            const srcH = Math.round(srcW / 1.6);
            const canvas = document.createElement("canvas");
            canvas.width = 480;
            canvas.height = 300;
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(bitmap, 0, 0, srcW, srcH, 0, 0, 480, 300);
            for (let quality = 0.82; quality >= 0.3; quality -= 0.08) {
              const url = canvas.toDataURL("image/webp", quality);
              const data = url.slice(url.indexOf(",") + 1);
              if (!url.startsWith("data:image/webp")) return done({ error: "this WebView cannot write WebP" });
              if ((data.length * 3) / 4 <= maxBytes) return done({ data, quality });
            }
            done({ error: "could not get the picture under the size limit" });
          });
        },
        png,
        MAX_BYTES,
      );
      if (result.error) throw new Error(`${style}-${theme}: ${result.error}`);
      const file = path.join(OUT_DIR, `${style}-${theme}.webp`);
      fs.writeFileSync(file, Buffer.from(result.data, "base64"));
      console.log(`${path.relative(repoRoot, file)}: ${fs.statSync(file).size} bytes (quality ${result.quality.toFixed(2)})`);
    }
  }
} finally {
  await app.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
}
