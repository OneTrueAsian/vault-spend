// VS-6: cleanup of the external Cargo build-dir (CARGO_BUILD_BUILD_DIR / [build] build-dir). It holds only regenerable
// intermediates; finished executables stay in target\debug, so nothing here touches them. The cleanup takes the same exclusive
// access as builds and desktop runs, skips (never waits, never stops a process) when someone holds it, and deletes only inside
// a folder whose top level looks like Cargo's own.
import fs from "node:fs";
import path from "node:path";
import { AccessHeldError, acquireAccess } from "./exclusiveAccess.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const CARGO_TOP_LEVEL = new Set(["debug", "release", ".rustc_info.json", "CACHEDIR.TAG", ".cargo-lock"]);

const inside = (parent, child) => { const rel = path.relative(parent, child); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };

function validate(buildDir, repoRoot) {
  if (!buildDir || !path.isAbsolute(buildDir)) throw new Error("Refusing to clean: the build cache path must be absolute.");
  const dir = path.resolve(buildDir), repo = path.resolve(repoRoot);
  if (dir === path.parse(dir).root) throw new Error("Refusing to clean a drive root.");
  if (dir === repo || inside(dir, repo) || inside(repo, dir)) throw new Error("Refusing to clean a folder that is, contains or sits inside the repository (the finished executables live in target\).");
  return dir;
}

function sizeAndNewest(entry) {
  let bytes = 0, newest = 0;
  const stack = [entry];
  while (stack.length) {
    const current = stack.pop();
    let stat; try { stat = fs.lstatSync(current); } catch { continue; }
    newest = Math.max(newest, stat.mtimeMs);
    if (stat.isDirectory()) { for (const name of fs.readdirSync(current)) stack.push(path.join(current, name)); } else bytes += stat.size;
  }
  return { bytes, newest };
}

/** Clean the build-dir. Resolves { action: "none" | "aged" | "purged" | "skipped-busy", bytes, dryRun? }. */
export async function trimBuildCache({ buildDir, repoRoot, lockDir, limitBytes = 10 * 1024 ** 3, maxAgeDays = 14, dryRun = false, now = Date.now() }) {
  const dir = validate(buildDir, repoRoot);
  if (!fs.existsSync(dir)) return { action: "none", bytes: 0 };
  const top = fs.readdirSync(dir);
  const foreign = top.filter(name => !CARGO_TOP_LEVEL.has(name));
  if (foreign.length) throw new Error(`Refusing to clean ${dir}: it holds entries Cargo did not create (${foreign.join(", ")}).`);

  let lock;
  try { lock = await acquireAccess({ dir: lockDir, operation: "trim-build-cache" }); } catch (error) {
    if (error instanceof AccessHeldError) return { action: "skipped-busy", bytes: 0, reason: error.message };
    throw error;
  }
  try {
    const total = top.reduce((sum, name) => sum + sizeAndNewest(path.join(dir, name)).bytes, 0);
    if (total > limitBytes) {
      if (!dryRun) for (const name of top) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      return { action: "purged", bytes: total, ...(dryRun ? { dryRun } : {}) };
    }
    const stale = [];
    for (const profile of top.filter(name => name === "debug" || name === "release")) {
      const incremental = path.join(dir, profile, "incremental");
      if (!fs.existsSync(incremental)) continue;
      for (const name of fs.readdirSync(incremental)) {
        const session = path.join(incremental, name);
        if (now - sizeAndNewest(session).newest > maxAgeDays * DAY_MS) stale.push(session);
      }
    }
    if (!stale.length) return { action: "none", bytes: total };
    if (!dryRun) for (const session of stale) fs.rmSync(session, { recursive: true, force: true });
    return { action: "aged", bytes: total, removed: stale.length, ...(dryRun ? { dryRun } : {}) };
  } finally { lock.release(); }
}
