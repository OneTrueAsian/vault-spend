// Keep a copy of every screenshot a spec saves, in VAULTSPEND_SHOTS_DIR, so a run's screenshots can be reviewed after it ends
// (run-all.mjs --keep-screens, npm run e2e:review). Specs and their own screenshot folders are untouched; unset, nothing changes.
import fs from "node:fs";
import path from "node:path";

export function keptCopyPath(dir, fileName) {
  const ext = path.extname(fileName), stem = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem}-${n}${ext}`);
  return candidate;
}

export function keepScreenshot(sourcePath, env = process.env) {
  const dir = env.VAULTSPEND_SHOTS_DIR;
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const copy = keptCopyPath(dir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, copy);
  return copy;
}

// One folder per kept run, named by its UTC start time (sorts by age); only the newest `keep` runs are kept, the new one included.
export function startKeptRun(root, now = new Date(), keep = 3) {
  const run = path.join(root, now.toISOString().slice(0, 19).replace(/:/g, "-"));
  fs.mkdirSync(run, { recursive: true });
  const runs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - keep))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  return run;
}

export function countKept(runDir) {
  if (!fs.existsSync(runDir)) return 0;
  return fs.readdirSync(runDir, { recursive: true }).filter((f) => String(f).toLowerCase().endsWith(".png")).length;
}

// Per spec that ran: how many screenshots were kept. A spec that saves screenshots only when its own variable is set keeps none.
export function keptBySpec(runDir, specNames) {
  return specNames.map((spec) => ({ spec, count: countKept(path.join(runDir, path.basename(spec, ".mjs"))) }));
}

export function wrapSaveScreenshot(browser, env = process.env) {
  if (!env.VAULTSPEND_SHOTS_DIR) return;
  // WebdriverIO session commands are read-only; overwriteCommand is its supported way to wrap one.
  browser.overwriteCommand("saveScreenshot", async (original, filePath, ...rest) => {
    const result = await original(filePath, ...rest);
    // Keeping is an aid for reviewing the run; a failed copy must never fail the spec.
    try { keepScreenshot(filePath, env); } catch (error) { console.error(`[keep-screens] could not keep ${filePath}: ${error.message}`); }
    return result;
  });
}
