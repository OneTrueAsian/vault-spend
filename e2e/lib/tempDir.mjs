// Throwaway folders for E2E specs and tools, deleted again when the process exits.
//
// A full run launches the app a few hundred times. Each launch used to leave a WebView2 profile behind
// (msedgedriver's scoped_dir*, tens of megabytes each), and every failed spec kept its database folder,
// so the temp folder grew to hundreds of gigabytes. Everything made here is deleted on exit whether the
// spec passed or failed. To keep the files for debugging a failure, run with VAULTSPEND_KEEP_E2E_TEMP=1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tracked = new Set();

export function keepTempFiles() {
  return process.env.VAULTSPEND_KEEP_E2E_TEMP === "1";
}

// Retries cover files an app or driver that has just been killed still holds open for a moment.
export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* best effort — never fail the run over cleanup */
  }
}

// Deletes every folder made by makeTempDir so far (unless VAULTSPEND_KEEP_E2E_TEMP=1). Runs on exit.
export function cleanupTempDirs() {
  if (keepTempFiles()) return;
  for (const dir of tracked) {
    removeDir(dir);
    tracked.delete(dir);
  }
}

let exitHookInstalled = false;
export function makeTempDir(prefix, { base = os.tmpdir() } = {}) {
  const dir = fs.mkdtempSync(path.join(base, prefix));
  tracked.add(dir);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on("exit", cleanupTempDirs);
  }
  return dir;
}

// Deletes a folder made by makeTempDir now rather than at exit, e.g. as soon as the app that used it has
// closed — unless VAULTSPEND_KEEP_E2E_TEMP=1, when it stays for debugging like everything else.
export function releaseTempDir(dir) {
  if (keepTempFiles()) return;
  removeDir(dir);
  tracked.delete(dir);
}

// The environment that sends a child process's temp files (msedgedriver's WebView2 profiles included)
// into `dir` rather than the shared temp folder, so deleting `dir` deletes them too.
export function isolatedTempEnv(dir) {
  return { TEMP: dir, TMP: dir };
}

// Deletes folders under `root` last changed more than `maxAgeMs` ago: what an earlier run left behind
// when it was itself killed before it could clean up. A run still in progress is recent, so it stays.
export function removeStaleDirs(root, maxAgeMs) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) removeDir(dir);
    } catch {
      /* gone already */
    }
  }
}
